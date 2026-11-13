import { randomUUID } from 'node:crypto';
import type { Store } from '../db/index.js';
import type { Actor } from '../shared/contracts.js';
import * as c from '../shared/dependency-assessments.js';
import type { z } from 'zod';
import type { StreamService } from './streams.js';
import { assertNode, flowDependencies } from './flow.js';
import { lineage } from './coverage.js';
import { hash } from './auth.js';
import { ensure } from './errors.js';
const MAX_REVIEW = 1000;
type Item = { id: string; kind: string; title: string; streamId: string | null; material: unknown };
type Inventory = {
  items: Item[];
  total: number;
  fingerprint: string;
  scopeStreamId: string | null;
  scopeTitle: string;
};
export type AssessmentCache = Map<string, Inventory>;
type Row = {
  id: string;
  targetId: string;
  targetKind: c.AssessmentTarget['kind'];
  scopeStreamId: string | null;
  scopeFingerprint: string;
  planFingerprint: string;
  reviewedIds: string;
  coverage: 'complete' | 'partial';
  start: string;
  deliver: string;
  actorName: string;
  reportedAt: number;
};
function material(store: Store, id: string, kind: string) {
  const db = store.raw;
  if (kind === 'stream')
    return {
      ...(db
        .prepare(
          'SELECT id,title,outcome,constraints,parentId,state,scopeRevision,planRevision,outcomeRevision FROM streams WHERE id=?',
        )
        .get(id) as object),
      ancestors: streamContext(store, id),
    };
  if (kind === 'human_action')
    return db
      .prepare(
        'SELECT id,streamId,title,description,doneWhen,state,revision FROM human_actions WHERE id=?',
      )
      .get(id);
  if (kind === 'question')
    return db
      .prepare('SELECT id,streamId,body,state,revision FROM stream_context WHERE id=?')
      .get(id);
  return {
    work: db
      .prepare(
        'SELECT w.id,w.title,w.objective,w.acceptanceCriteria,w.lifecycle,m.streamId,m.expectedOutput,m.areas,m.resources,m.baseRef,m.planRevision FROM work w JOIN change_meta m ON m.workId=w.id WHERE w.id=?',
      )
      .get(id),
    ancestors: streamContext(
      store,
      (
        db.prepare('SELECT streamId FROM change_meta WHERE workId=?').get(id) as {
          streamId: string | null;
        }
      ).streamId,
    ),
    outputs: db
      .prepare(
        'SELECT id,revision,state,codeRevision FROM change_outputs WHERE workId=? ORDER BY id',
      )
      .all(id),
    references: db
      .prepare('SELECT system,url FROM source_refs WHERE workId=? ORDER BY system,url')
      .all(id),
  };
}
function ownStream(store: Store, target: c.AssessmentTarget) {
  assertNode(store, target);
  return target.kind === 'stream'
    ? target.id
    : (
        store.raw.prepare('SELECT streamId FROM change_meta WHERE workId=?').get(target.id) as {
          streamId: string | null;
        }
      ).streamId;
}
function inventory(
  store: Store,
  target: c.AssessmentTarget,
  requested: string | null | undefined,
  cache?: AssessmentCache,
): Inventory {
  const own = ownStream(store, target),
    scope = requested === undefined ? own : requested;
  ensure(
    own === null
      ? scope === null
      : scope !== null && lineage(store, own).some((s) => s.id === scope),
    400,
    'Review scope must be the selected stream or an ancestor. Use null only for ungrouped work.',
  );
  const refs = (
    store.raw
      .prepare(
        'SELECT sourceId id FROM flow_dependencies WHERE targetId=? UNION SELECT targetId id FROM flow_dependencies WHERE sourceId=?',
      )
      .all(target.id, target.id) as { id: string }[]
  )
    .map((x) => x.id)
    .sort();
  const key = JSON.stringify([scope, refs]);
  const cached = cache?.get(key);
  if (cached && cached.total <= MAX_REVIEW) return cached;
  const rows = store.raw
    .prepare(
      `WITH RECURSIVE tree(id) AS (SELECT id FROM streams WHERE id=? UNION SELECT s.id FROM streams s JOIN tree t ON s.parentId=t.id),
 all_items AS (
 SELECT id,'stream' kind,title,id streamId FROM streams
 UNION ALL SELECT w.id,'change',w.title,m.streamId FROM work w JOIN change_meta m ON m.workId=w.id
 UNION ALL SELECT id,'human_action',title,streamId FROM human_actions
 UNION ALL SELECT id,'question',substr(body,1,180),streamId FROM stream_context WHERE kind='question' AND needsHuman=1
 ), chosen AS (SELECT * FROM all_items WHERE streamId IN (SELECT id FROM tree) OR (? IS NULL AND streamId IS NULL AND kind='change') OR id=? OR id IN (SELECT sourceId FROM flow_dependencies WHERE targetId=? UNION SELECT targetId FROM flow_dependencies WHERE sourceId=?))
 SELECT *,(SELECT count(*) FROM chosen) total FROM chosen ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,id LIMIT ?`,
    )
    .all(scope, scope, target.id, target.id, target.id, target.id, MAX_REVIEW + 1) as (Omit<
    Item,
    'material'
  > & { total: number })[];
  const items = rows.map(({ total, ...r }) => ({ ...r, material: material(store, r.id, r.kind) }));
  const total = rows[0]?.total ?? 0;
  const scopeTitle = scope
    ? (store.raw.prepare('SELECT title FROM streams WHERE id=?').get(scope) as { title: string })
        .title
    : 'Ungrouped work';
  const value = {
    items,
    total,
    scopeStreamId: scope,
    scopeTitle,
    fingerprint: hash(
      JSON.stringify({
        scope,
        total,
        items: [...items]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((x) => [x.id, x.kind, x.material]),
      }),
    ),
  };
  // A scope cache is only valid for one read projection. Include target-specific
  // edges in the key; never cache across mutations.
  cache?.set(key, value);
  return value;
}
function planFingerprint(store: Store, target: c.AssessmentTarget) {
  return hash(
    JSON.stringify({
      target: material(store, target.id, target.kind),
      ancestors: (ownStream(store, target) ? lineage(store, ownStream(store, target)!) : []).map(
        (s) => ({ id: s.id, parentId: s.parentId, state: s.state, scopeRevision: s.scopeRevision }),
      ),
      edges: flowDependencies(store, target.id).map(({ source, stage, condition, reason }) => ({
        source,
        stage,
        condition,
        reason,
        material: material(store, source.id, source.kind),
      })),
    }),
  );
}
function latest(store: Store, id: string, reportId?: string) {
  return store.raw
    .prepare(
      `SELECT r.*,a.name actorName FROM dependency_assessments r JOIN actors a ON a.id=r.reportedBy WHERE ${reportId ? 'r.id=?' : 'r.targetId=?'} ORDER BY r.rowid DESC LIMIT 1`,
    )
    .get(reportId ?? id) as Row | undefined;
}
export function readDependencyAssessment(
  store: Store,
  target: c.AssessmentTarget,
  cache?: AssessmentCache,
  reportId?: string,
): c.DependencyAssessment {
  const r = latest(store, target.id, reportId);
  const detail =
    '/api/dependency-assessment?' + new URLSearchParams({ id: target.id, kind: target.kind });
  if (!r) {
    const table = target.kind === 'stream' ? 'streams' : 'change_meta',
      column = target.kind === 'stream' ? 'id' : 'workId';
    const old = store.raw
      .prepare(`SELECT assessment FROM ${table} WHERE ${column}=?`)
      .get(target.id) as { assessment: string | null } | undefined;
    return {
      state: old?.assessment ? 'legacy' : 'unassessed',
      id: null,
      scopeStreamId: null,
      scopeTitle: '',
      start: null,
      deliver: null,
      coverage: null,
      actorName: null,
      reportedAt: null,
      detail,
    };
  }
  const own = ownStream(store, target);
  const validScope =
    own === null
      ? r.scopeStreamId === null
      : r.scopeStreamId !== null && lineage(store, own).some((s) => s.id === r.scopeStreamId);
  const i = validScope ? inventory(store, target, r.scopeStreamId, cache) : null;
  const start = JSON.parse(r.start) as c.StageAssessment,
    deliver = JSON.parse(r.deliver) as c.StageAssessment;
  const stale =
    !i ||
    i.fingerprint !== r.scopeFingerprint ||
    planFingerprint(store, target) !== r.planFingerprint;
  return {
    state: stale
      ? 'stale'
      : r.coverage === 'partial' || start.result === 'uncertain' || deliver.result === 'uncertain'
        ? 'uncertain'
        : 'current',
    id: r.id,
    scopeStreamId: r.scopeStreamId,
    scopeTitle: i?.scopeTitle ?? 'Earlier scope',
    start,
    deliver,
    coverage: r.coverage,
    actorName: r.actorName,
    reportedAt: r.reportedAt,
    detail,
  };
}
export function assertImplementationReady(store: Store, target: c.AssessmentTarget) {
  const a = readDependencyAssessment(store, target);
  ensure(
    a.state === 'current',
    409,
    'Dependency assessment is incomplete, uncertain or stale. Use review_dependencies, record explicit start/delivery results and rationale with assess_dependencies, then retry.',
  );
  ensure(
    !flowDependencies(store, target.id).some((d) => d.stage === 'start' && !d.satisfied),
    409,
    'A recorded start prerequisite is still unmet. Retrieve the selected work and its prerequisite evidence before retrying.',
  );
  const stream = ownStream(store, target);
  for (const parent of stream ? lineage(store, stream) : [])
    ensure(
      !flowDependencies(store, parent.id).some((d) => d.stage === 'start' && !d.satisfied),
      409,
      'An ancestor stream has an unmet start prerequisite. Read the stream context before retrying.',
    );
  return a;
}
export class DependencyAssessmentService {
  constructor(public streams: StreamService) {}
  get store() {
    return this.streams.work.store;
  }
  review(a: Actor, input: z.input<typeof c.assessmentReviewSchema>) {
    this.streams.allow(a);
    const p = c.assessmentReviewSchema.parse(input);
    return this.store.raw
      .transaction(() => {
        const i = inventory(this.store, p.target, p.scopeStreamId);
        const response = {
          target: p.target,
          revision: this.revision(p.target),
          scopeStreamId: i.scopeStreamId,
          scopeTitle: i.scopeTitle,
          scopeFingerprint: i.fingerprint,
          planFingerprint: planFingerprint(this.store, p.target),
          total: i.total,
          canComplete: i.total <= MAX_REVIEW,
          items: i.items
            .slice(0, MAX_REVIEW)
            .slice(p.offset, p.offset + p.limit)
            .map(({ material, ...r }) => ({
              ...r,
              summary: true,
              detail:
                r.kind === 'change'
                  ? `/api/work/${r.id}`
                  : r.kind === 'stream'
                    ? `/api/streams/${r.id}`
                    : r.kind === 'question'
                      ? `/api/context/${r.id}`
                      : `/api/human-actions/${r.id}`,
              purpose: purposeOf(material).slice(0, 400),
            })),
          nextOffset: null as number | null,
          assessment: readDependencyAssessment(this.store, p.target),
          provenance:
            'Review every relevant page/full record; record the IDs reviewed. Scope includes recorded direct cross-stream links. Current assessment is attributed judgment, not permission or guaranteed safe concurrency.',
        };
        while (Buffer.byteLength(JSON.stringify(response)) > 48000 && response.items.length > 1)
          response.items.pop();
        const next = p.offset + response.items.length;
        response.nextOffset = next < Math.min(i.total, MAX_REVIEW) ? next : null;
        return response;
      })
      .deferred();
  }
  read(a: Actor, target: c.AssessmentTarget) {
    this.streams.allow(a);
    assertNode(this.store, target);
    return readDependencyAssessment(this.store, target);
  }
  revision(t: c.AssessmentTarget) {
    assertNode(this.store, t);
    return (
      this.store.raw
        .prepare(
          t.kind === 'stream'
            ? 'SELECT revision FROM streams WHERE id=?'
            : 'SELECT revision FROM change_meta WHERE workId=?',
        )
        .get(t.id) as { revision: number }
    ).revision;
  }
  report(a: Actor, input: z.input<typeof c.assessmentReportSchema>) {
    this.streams.allow(a);
    const p = c.assessmentReportSchema.parse(input);
    return this.streams.work.tx(() =>
      this.streams.retry(
        a,
        'dependency-assessment:' + p.target.id,
        p.idempotencyKey,
        p,
        () => {
          ensure(
            this.revision(p.target) === p.revision,
            409,
            'Work changed. Read review_dependencies again and reconcile the current revision.',
          );
          const i = inventory(this.store, p.target, p.scopeStreamId);
          ensure(
            i.fingerprint === p.scopeFingerprint &&
              planFingerprint(this.store, p.target) === p.planFingerprint,
            409,
            'Reviewed work or scope changed. Fetch review_dependencies again and reassess; do not reuse the old fingerprints.',
          );
          const reviewed = new Set(p.reviewedIds),
            ids = new Set(i.items.slice(0, MAX_REVIEW).map((x) => x.id));
          ensure(
            reviewed.size === p.reviewedIds.length &&
              reviewed.has(p.target.id) &&
              p.reviewedIds.every((id) => ids.has(id)),
            400,
            'Reviewed IDs must be unique IDs from this scope, including the selected target.',
          );
          ensure(
            p.coverage !== 'complete' || (i.total <= MAX_REVIEW && reviewed.size === i.total),
            400,
            'Complete assessment requires every item in the reviewed scope. Fetch remaining pages, focus a smaller scope, or report partial/uncertain coverage.',
          );
          const deps = flowDependencies(this.store, p.target.id);
          for (const stage of ['start', 'deliver'] as const) {
            const r = p[stage],
              has = deps.some((d) => d.stage === stage);
            ensure(
              r.result === 'uncertain' || (r.result === 'linked') === has,
              400,
              `The ${stage} result contradicts the recorded prerequisite set. Save prerequisites first, then review and reassess.`,
            );
          }
          const id = randomUUID();
          this.store.raw
            .prepare('INSERT INTO dependency_assessments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(
              id,
              p.target.id,
              p.target.kind,
              p.scopeStreamId,
              p.scopeFingerprint,
              p.planFingerprint,
              JSON.stringify([...reviewed].sort()),
              p.coverage,
              JSON.stringify(p.start),
              JSON.stringify(p.deliver),
              a.id,
              this.streams.now(),
            );
          this.store.raw
            .prepare(
              p.target.kind === 'stream'
                ? 'UPDATE streams SET revision=revision+1 WHERE id=?'
                : 'UPDATE change_meta SET revision=revision+1 WHERE workId=?',
            )
            .run(p.target.id);
          if (p.target.kind === 'stream')
            this.streams.event(
              a,
              p.target.id,
              'dependency_assessed',
              'Reported explicit prerequisite assessment.',
              { reportId: id, ...p },
            );
          else
            this.streams.work.event(
              p.target.id,
              a,
              'dependency_assessed',
              'Reported explicit prerequisite assessment.',
              [],
              { reportId: id, ...p },
            );
          return id;
        },
        (id) => ({
          ...readDependencyAssessment(this.store, p.target, undefined, id),
          revision: this.revision(p.target),
        }),
      ),
    );
  }
}

function purposeOf(m: unknown) {
  const r = m as {
    work?: { objective?: string };
    outcome?: string;
    description?: string;
    doneWhen?: string;
    body?: string;
  };
  return r.work?.objective || r.outcome || r.description || r.body || r.doneWhen || '';
}

function streamContext(store: Store, id: string | null): unknown[] {
  if (!id) return [];
  return store.raw
    .prepare(
      `WITH RECURSIVE chain AS (SELECT id,parentId,state,scopeRevision,planRevision FROM streams WHERE id=? UNION SELECT s.id,s.parentId,s.state,s.scopeRevision,s.planRevision FROM streams s JOIN chain c ON s.id=c.parentId) SELECT * FROM chain ORDER BY id`,
    )
    .all(id);
}
