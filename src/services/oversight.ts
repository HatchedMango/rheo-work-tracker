import { randomUUID } from 'node:crypto';
import type { Actor } from '../shared/contracts.js';
import type { Node, HumanAction, AttentionItem } from '../shared/oversight.js';
import * as c from '../shared/oversight.js';
import { outputSchema } from '../shared/streams.js';
import type { z } from 'zod';
import type { StreamService } from './streams.js';
import { ensure } from './errors.js';
import {
  lineage,
  routineCoverage,
  effectiveCoverage,
  recordedCoverage,
  subtreeIds,
  revokeInactiveClaims,
} from './coverage.js';
import {
  assertNode,
  replaceEdges,
  flowDependencies,
  flowFingerprint,
  impact,
  impactIndex,
} from './flow.js';
import { readTracking } from './stream-data.js';
import { allowFeedback } from './feedback.js';
import type { FeedbackOrigin } from '../shared/sync.js';
import { SyncService } from './sync.js';
export class OversightService {
  constructor(public streams: StreamService) {}
  get work() {
    return this.streams.work;
  }
  get raw() {
    return this.streams.raw;
  }
  get store() {
    return this.work.store;
  }
  now() {
    return this.streams.now();
  }
  action(a: Actor, id: string): HumanAction {
    this.streams.allow(a);
    const row = this.raw
      .prepare(
        'SELECT h.*,a.name actorName FROM human_actions h JOIN actors a ON a.id=h.createdBy WHERE h.id=?',
      )
      .get(id) as HumanAction | undefined;
    ensure(row, 404, 'Human action not found.');
    return Object.assign(row, impact(this.store, id));
  }
  actions(a: Actor, streamId: string, limit = 30, offset = 0) {
    this.streams.get(a, streamId);
    return {
      items: (
        this.raw
          .prepare(
            'SELECT id FROM human_actions WHERE streamId=? ORDER BY updatedAt DESC,id LIMIT ? OFFSET ?',
          )
          .all(streamId, limit, offset) as { id: string }[]
      ).map((x) => this.action(a, x.id)),
      total: (
        this.raw.prepare('SELECT count(*) n FROM human_actions WHERE streamId=?').get(streamId) as {
          n: number;
        }
      ).n,
    };
  }
  createAction(a: Actor, input: z.input<typeof c.humanActionSchema>) {
    this.streams.allow(a);
    const p = c.humanActionSchema.parse(input);
    return this.work.tx(() => {
      this.streams.get(a, p.streamId);
      return this.streams.retry(
        a,
        'human_action',
        p.idempotencyKey,
        p,
        () => {
          const id = randomUUID();
          this.raw
            .prepare(
              'INSERT INTO human_actions(id,streamId,createdBy,title,description,doneWhen,ownerId,waitingOn,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
            )
            .run(
              id,
              p.streamId,
              a.id,
              p.title,
              p.description,
              p.doneWhen,
              'owner',
              p.waitingOn,
              this.now(),
              this.now(),
            );
          this.streams.event(a, p.streamId, 'human_action_requested', p.title, {
            id,
            doneWhen: p.doneWhen,
          });
          return id;
        },
        (id) => this.action(a, id),
      );
    });
  }
  respond(
    a: Actor,
    id: string,
    input: z.input<typeof c.humanResponseSchema>,
    source?: FeedbackOrigin,
  ) {
    this.streams.allow(a);
    if (source) allowFeedback(this.store, a, source);
    const p = c.humanResponseSchema.parse(input);
    return this.work.tx(() =>
      this.streams.retry(
        a,
        'human_response:' + id,
        p.idempotencyKey,
        p,
        () => {
          const h = this.action(a, id);
          ensure(
            a.scope === 'owner' || !!source || (h.createdBy === a.id && p.state === 'cancelled'),
            403,
            'Only the owner can report human action progress or completion.',
          );
          ensure(
            a.scope === 'owner' || ['open', 'in_progress'].includes(h.state),
            409,
            'Only the owner can change a completed or cancelled request.',
          );
          ensure(h.revision === p.revision, 409, 'Human action changed. Reload and reconcile.');
          this.raw
            .prepare(
              'UPDATE human_actions SET state=?,response=?,respondedBy=?,revision=revision+1,updatedAt=?,responseSource=? WHERE id=?',
            )
            .run(p.state, p.response, a.id, this.now(), source ? JSON.stringify(source) : null, id);
          this.streams.event(a, h.streamId, 'human_action_response', p.response, {
            id,
            state: p.state,
            ...(source ? { source } : {}),
          });
          return id;
        },
        (id) => this.action(a, id),
      ),
    );
  }
  answer(a: Actor, id: string, input: z.input<typeof c.answerSchema>, source?: FeedbackOrigin) {
    allowFeedback(this.store, a, source);
    const p = c.answerSchema.parse(input);
    return this.work.tx(() =>
      this.streams.retry(
        a,
        'answer:' + id,
        p.idempotencyKey,
        p,
        () => {
          const e = this.streams.entry(a, id);
          ensure(e.kind === 'question', 400, 'Only questions accept answers.');
          ensure(
            e.revision === p.revision && e.state === 'open',
            409,
            'Question changed. Reload and reconcile.',
          );
          this.raw
            .prepare(
              "UPDATE stream_context SET answer=?,answeredBy=?,answeredAt=?,state='resolved',revision=revision+1,updatedAt=?,answerSource=? WHERE id=?",
            )
            .run(
              p.answer,
              a.id,
              this.now(),
              this.now(),
              source ? JSON.stringify(source) : null,
              id,
            );
          this.streams.event(a, e.streamId, 'question_answered', p.answer, {
            id,
            question: e.body,
            ...(source ? { source } : {}),
          });
          return id;
        },
        (id) => this.streams.entry(a, id),
      ),
    );
  }
  dependencies(a: Actor, input: z.input<typeof c.setDependenciesSchema>) {
    this.streams.allow(a);
    const p = c.setDependenciesSchema.parse(input);
    return this.work.tx(() => {
      assertNode(this.store, p.target);
      ensure(p.target.kind !== 'human_action', 400, 'Human actions cannot have prerequisites.');
      const stream = p.target.kind === 'stream' ? this.streams.get(a, p.target.id) : null;
      const change =
        p.target.kind === 'change' ? readTracking(this.store, p.target.id, this.now()) : null;
      ensure(
        (stream?.revision ?? change?.revision) === p.revision,
        409,
        'Plan changed. Reload and reconcile.',
      );
      ensure(change?.claim?.state !== 'active', 409, 'Release the claim before changing the plan.');
      const canonical = (deps: typeof p.dependencies) =>
        JSON.stringify(
          deps
            .map(({ source, stage, condition, reason }) => ({ source, stage, condition, reason }))
            .sort(
              (x, y) => x.source.id.localeCompare(y.source.id) || x.stage.localeCompare(y.stage),
            ),
        );
      const before = flowDependencies(this.store, p.target.id);
      if (canonical(before) === canonical(p.dependencies))
        return p.target.kind === 'stream' ? stream : this.work.get(a, p.target.id);
      replaceEdges(this.store, p.target, p.dependencies);
      this.raw
        .prepare(
          p.target.kind === 'stream'
            ? 'UPDATE streams SET revision=revision+1,planRevision=planRevision+1,updatedAt=? WHERE id=?'
            : 'UPDATE change_meta SET revision=revision+1,planRevision=planRevision+1,reportedAt=? WHERE workId=?',
        )
        .run(this.now(), p.target.id);
      if (stream)
        this.streams.event(a, stream.id, 'prerequisites_updated', 'Updated prerequisites.', {
          before,
          after: p.dependencies,
        });
      else
        this.work.event(p.target.id, a, 'prerequisites_updated', 'Updated prerequisites.', [], {
          before,
          after: p.dependencies,
        });
      return stream ? this.streams.get(a, stream.id) : this.work.get(a, p.target.id);
    });
  }
  report(a: Actor, id: string, input: z.input<typeof c.streamReportSchema>) {
    this.streams.allow(a);
    const p = c.streamReportSchema.parse(input);
    return this.work.tx(() => {
      const s = this.streams.get(a, id);
      ensure(s.revision === p.streamRevision, 409, 'Stream changed. Reload and reconcile.');
      ensure(s.state === 'active' || s.state === 'paused', 409, 'Stream is not open.');
      if (p.assessDependencies)
        ensure(
          p.assessmentFingerprint === s.assessmentFingerprint,
          409,
          'Assessment context changed. Reload and reassess.',
        );
      const available =
        p.outcomeAvailable === undefined
          ? s.outcomeAvailableAt
          : p.outcomeAvailable
            ? (s.outcomeAvailableAt ?? this.now())
            : null;
      const changed = available !== s.outcomeAvailableAt;
      this.raw
        .prepare(
          'UPDATE streams SET phase=?,progressSummary=?,reportedBy=?,reportedAt=?,outcomeAvailableAt=?,outcomeRevision=outcomeRevision+?,reviewRequested=?,revision=revision+1,updatedAt=? WHERE id=?',
        )
        .run(
          p.phase ?? s.phase,
          p.summary ?? s.progressSummary,
          a.id,
          this.now(),
          available,
          changed ? 1 : 0,
          p.reviewRequested === undefined ? s.reviewRequested : p.reviewRequested ? 1 : 0,
          this.now(),
          id,
        );
      if (p.assessDependencies !== undefined)
        this.raw
          .prepare('UPDATE streams SET assessment=?,assessedBy=?,assessedAt=? WHERE id=?')
          .run(
            p.assessDependencies ? p.assessmentFingerprint : null,
            p.assessDependencies ? a.id : null,
            p.assessDependencies ? this.now() : null,
            id,
          );
      this.streams.event(a, id, 'progress_reported', p.summary ?? 'Updated stream report.', p);
      return this.streams.get(a, id);
    });
  }
  move(a: Actor, id: string, input: z.input<typeof c.moveStreamSchema>) {
    this.streams.allow(a);
    const p = c.moveStreamSchema.parse(input);
    return this.work.tx(() => {
      const s = this.streams.get(a, id);
      ensure(s.revision === p.streamRevision, 409, 'Stream changed. Reload and reconcile.');
      if (p.parentId) this.streams.get(a, p.parentId);
      ensure(
        !p.parentId || !subtreeIds(this.store, id).includes(p.parentId),
        400,
        'A stream cannot contain itself or an ancestor.',
      );
      if (p.parentId === s.parentId) return s;
      const oldRoot = lineage(this.store, id).at(-1)?.id,
        newRoot = p.parentId ? lineage(this.store, p.parentId).at(-1)?.id : id;
      ensure(
        a.scope === 'owner' ||
          (oldRoot === newRoot &&
            routineCoverage(this.store, p.parentId)?.approvalId ===
              (s.coverageApprovalId ?? s.approvalId)),
        403,
        'Moving streams across approval boundaries requires the owner.',
      );
      this.raw
        .prepare(
          'UPDATE streams SET parentId=?,planRevision=planRevision+1,revision=revision+1,updatedAt=? WHERE id=?',
        )
        .run(p.parentId, this.now(), id);
      revokeInactiveClaims(this.store, this.now());
      this.streams.event(a, id, 'stream_moved', p.reason, { from: s.parentId, to: p.parentId });
      return this.streams.get(a, id);
    });
  }
  cover(a: Actor, id: string, input: z.input<typeof c.coverageSchema>) {
    this.streams.allow(a, ['owner']);
    const p = c.coverageSchema.parse(input);
    return this.work.tx(() => {
      const root = this.streams.get(a, id);
      ensure(root.revision === p.streamRevision, 409, 'Stream changed. Reload and reconcile.');
      const grant = routineCoverage(this.store, id);
      ensure(grant, 409, 'Enable coverage for this stream first.');
      const descendants = subtreeIds(this.store, id);
      for (const sid of [...new Set(p.streamIds)]) {
        const s = this.streams.get(a, sid);
        ensure(
          sid !== id &&
            descendants.includes(sid) &&
            !s.approvalId &&
            ['proposed', 'active'].includes(s.state),
          409,
          'Only open descendants can be covered.',
        );
        this.raw
          .prepare(
            "UPDATE streams SET coverageApprovalId=?,approvalId=NULL,state='active',revision=revision+1,updatedAt=? WHERE id=?",
          )
          .run(grant.approvalId, this.now(), sid);
        this.streams.event(
          a,
          sid,
          'coverage_decision',
          'Owner included this stream in approved scope.',
          { approvalId: grant.approvalId },
        );
      }
      for (const wid of [...new Set(p.changeIds)]) {
        const w = this.work.get(a, wid);
        ensure(
          ['proposed', 'covered'].includes(w.assignment?.state ?? '') &&
            w.tracking.streamId &&
            descendants.includes(w.tracking.streamId) &&
            w.lifecycle === 'open',
          409,
          'Only open changes in this stream can be covered.',
        );
        ensure(
          w.tracking.claim?.state !== 'active',
          409,
          'Release the active claim before changing coverage.',
        );
        ensure(
          effectiveCoverage(this.store, w.tracking.streamId, grant.approvalId),
          409,
          'Resolve ancestor coverage first.',
        );
        this.raw
          .prepare(
            'UPDATE change_meta SET coverageApprovalId=?,revision=revision+1,planRevision=planRevision+1 WHERE workId=?',
          )
          .run(grant.approvalId, wid);
        this.raw
          .prepare("UPDATE assignments SET state='covered',decidedAt=NULL WHERE workId=?")
          .run(wid);
        this.work.resolve(wid, 'assignment');
        this.work.event(
          wid,
          a,
          'coverage_decision',
          'Owner included this change in approved stream scope.',
          [],
          { approvalId: grant.approvalId },
        );
      }
      this.raw
        .prepare('UPDATE streams SET revision=revision+1,updatedAt=? WHERE id=?')
        .run(this.now(), id);
      revokeInactiveClaims(this.store, this.now());
      return this.streams.get(a, id);
    });
  }
  outputs(a: Actor, id: string, limit = 30, offset = 0) {
    this.streams.get(a, id);
    return {
      items: this.raw
        .prepare(
          'SELECT o.*,a.name actorName FROM stream_outputs o JOIN actors a ON a.id=o.reportedBy WHERE streamId=? ORDER BY reportedAt DESC,id LIMIT ? OFFSET ?',
        )
        .all(id, limit, offset),
      total: (
        this.raw.prepare('SELECT count(*) n FROM stream_outputs WHERE streamId=?').get(id) as {
          n: number;
        }
      ).n,
    };
  }
  output(a: Actor, id: string, input: z.input<typeof outputSchema>) {
    this.streams.allow(a);
    const p = outputSchema.parse(input);
    return this.work.tx(() => {
      this.streams.get(a, id);
      return this.streams.retry(
        a,
        'stream_output:' + id,
        p.idempotencyKey,
        p,
        () => {
          const old = this.raw
            .prepare(
              'SELECT id,revision FROM stream_outputs WHERE streamId=? AND url=? AND reportedBy=?',
            )
            .get(id, p.url, a.id) as { id: string; revision: number } | undefined;
          ensure(
            old ? p.revision === old.revision : p.revision === undefined,
            409,
            'Output changed. Reload and reconcile.',
          );
          const oid = old?.id ?? randomUUID();
          this.raw
            .prepare(
              'INSERT INTO stream_outputs(id,streamId,kind,url,label,codeRevision,state,reportedBy,reportedAt) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(streamId,url,reportedBy) DO UPDATE SET kind=excluded.kind,label=excluded.label,codeRevision=excluded.codeRevision,state=excluded.state,reportedAt=excluded.reportedAt,revision=stream_outputs.revision+1',
            )
            .run(oid, id, p.kind, p.url, p.label, p.codeRevision, p.state, a.id, this.now());
          this.streams.event(a, id, 'output_reported', p.label, p);
          return oid;
        },
        (oid) =>
          this.raw
            .prepare(
              'SELECT o.*,a.name actorName FROM stream_outputs o JOIN actors a ON a.id=o.reportedBy WHERE o.id=?',
            )
            .get(oid),
      );
    });
  }
  attention(a: Actor, limit = 30, offset = 0, streamId?: string) {
    this.streams.allow(a);
    return this.work.tx(() => {
      const items: AttentionItem[] = [];
      const getImpact = impactIndex(this.store);
      const impactNodes = new Map<string, string>();
      const coverageCache = new Map<string, boolean>();
      const hasCoverage = (sid: string | null, aid: string | null) => {
        const key = sid + ':' + aid;
        if (!coverageCache.has(key))
          coverageCache.set(key, !!recordedCoverage(this.store, sid, aid));
        return coverageCache.get(key);
      };
      const names = new Map(
        (
          this.raw.prepare('SELECT id,title FROM streams').all() as { id: string; title: string }[]
        ).map((s) => [s.id, s.title]),
      );
      const add = (
        x: Omit<AttentionItem, 'streamTitle' | 'direct' | 'affectedStreams'>,
        nodeId?: string,
      ) => {
        if (nodeId) impactNodes.set(x.id, nodeId);
        items.push({
          ...x,
          streamTitle: x.streamId ? (names.get(x.streamId) ?? null) : null,
          direct: [],
          affectedStreams: [],
        });
      };
      for (const s of this.raw
        .prepare(
          "SELECT id,title,state,pendingScope,createdAt,reviewRequested FROM streams WHERE state='proposed' OR pendingScope IS NOT NULL OR (reviewRequested=1 AND state IN ('active','paused'))",
        )
        .all() as {
        id: string;
        title: string;
        state: string;
        pendingScope: string | null;
        createdAt: number;
        reviewRequested: number;
      }[]) {
        if (s.state === 'proposed')
          add(
            {
              id: 'stream:' + s.id,
              kind: 'stream_approval',
              entityId: s.id,
              title: s.title,
              body: 'Review this direction and its scope.',
              streamId: s.id,
              createdAt: s.createdAt,
            },
            s.id,
          );
        if (s.pendingScope)
          add(
            {
              id: 'scope:' + s.id,
              kind: 'scope',
              entityId: s.id,
              title: s.title,
              body: 'Review the proposed scope change.',
              streamId: s.id,
              createdAt: s.createdAt,
            },
            s.id,
          );
        if (s.reviewRequested && s.state !== 'proposed')
          add(
            {
              id: 'review:' + s.id,
              kind: 'review',
              entityId: s.id,
              title: s.title,
              body: 'Stream review requested.',
              streamId: s.id,
              createdAt: s.createdAt,
            },
            s.id,
          );
      }
      for (const h of this.raw
        .prepare("SELECT * FROM human_actions WHERE state IN ('open','in_progress')")
        .all() as HumanAction[])
        add(
          {
            id: 'action:' + h.id,
            kind: 'action',
            entityId: h.id,
            title: h.title,
            body: h.doneWhen,
            streamId: h.streamId,
            createdAt: h.createdAt,
          },
          h.id,
        );
      for (const q of this.raw
        .prepare(
          "SELECT * FROM stream_context WHERE kind='question' AND needsHuman=1 AND state='open'",
        )
        .all() as { id: string; streamId: string; body: string; createdAt: number }[])
        add({
          id: 'question:' + q.id,
          kind: 'question',
          entityId: q.id,
          title: q.body,
          body: 'Your answer is needed.',
          streamId: q.streamId,
          createdAt: q.createdAt,
        });
      const invalid = new Map<string, string[]>();
      for (const w of this.raw
        .prepare(
          `SELECT w.id,w.title,w.createdAt,m.streamId,m.coverageApprovalId,m.reviewRequested,a.state FROM work w JOIN change_meta m ON m.workId=w.id LEFT JOIN assignments a ON a.workId=w.id WHERE w.lifecycle='open'`,
        )
        .all() as {
        id: string;
        title: string;
        createdAt: number;
        streamId: string | null;
        coverageApprovalId: string | null;
        reviewRequested: number;
        state: string;
      }[]) {
        if (w.state === 'proposed')
          add(
            {
              id: 'work:' + w.id,
              kind: 'work_approval',
              entityId: w.id,
              workId: w.id,
              title: w.title,
              body: 'Review this proposed change.',
              streamId: w.streamId,
              createdAt: w.createdAt,
            },
            w.id,
          );
        else if (
          w.state === 'covered' &&
          !hasCoverage(w.streamId, w.coverageApprovalId) &&
          w.streamId
        )
          invalid.set(w.streamId, [...(invalid.get(w.streamId) ?? []), w.id]);
        if (w.reviewRequested)
          add(
            {
              id: 'review:' + w.id,
              kind: 'review',
              entityId: w.id,
              workId: w.id,
              title: w.title,
              body: 'Change review requested.',
              streamId: w.streamId,
              createdAt: w.createdAt,
            },
            w.id,
          );
      }
      for (const [sid, ids] of invalid)
        add(
          {
            id: 'coverage:' + sid,
            kind: 'coverage',
            entityId: sid,
            title: names.get(sid) ?? 'Stream coverage',
            body: `${ids.length} change${ids.length === 1 ? '' : 's'} need renewed scope coverage.`,
            streamId: sid,
            createdAt: 0,
          },
          sid,
        );
      for (const t of this.raw
        .prepare(
          `SELECT t.id,t.workId,t.kind,t.createdAt,w.title,m.streamId FROM attention t JOIN work w ON w.id=t.workId JOIN change_meta m ON m.workId=w.id WHERE t.resolvedAt IS NULL AND t.kind!='assignment'`,
        )
        .all() as {
        id: string;
        workId: string;
        kind: string;
        createdAt: number;
        title: string;
        streamId: string | null;
      }[])
        add(
          {
            id: 'legacy:' + t.id,
            kind: 'legacy',
            entityId: t.workId,
            workId: t.workId,
            title: t.title,
            body: t.kind.replaceAll('_', ' '),
            streamId: t.streamId,
            createdAt: t.createdAt,
          },
          t.workId,
        );
      for (const s of this.raw
        .prepare(
          "SELECT id,coverageApprovalId FROM streams WHERE coverageApprovalId IS NOT NULL AND state IN ('active','paused')",
        )
        .all() as { id: string; coverageApprovalId: string }[])
        if (!hasCoverage(s.id, s.coverageApprovalId) && !invalid.has(s.id))
          add(
            {
              id: 'coverage:' + s.id,
              kind: 'coverage',
              entityId: s.id,
              title: names.get(s.id) ?? 'Stream coverage',
              body: 'This branch needs renewed scope coverage.',
              streamId: s.id,
              createdAt: 0,
            },
            s.id,
          );
      if (streamId) {
        this.streams.get(a, streamId);
        const ids = new Set(subtreeIds(this.store, streamId));
        const filtered = items.filter(
          (i) =>
            (i.streamId && ids.has(i.streamId)) ||
            (impactNodes.has(i.id)
              ? getImpact(impactNodes.get(i.id)!)
              : { affectedStreams: [] }
            ).affectedStreams.some((s) => ids.has(s.id)),
        );
        items.splice(0, items.length, ...filtered);
      }
      items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return {
        items: items.slice(offset, offset + limit).map((i) => ({
          ...i,
          ...(impactNodes.has(i.id) ? getImpact(impactNodes.get(i.id)!) : {}),
        })),
        total: items.length,
        nextOffset: offset + limit < items.length ? offset + limit : null,
      };
    });
  }
  overview(a: Actor, view = 'active', limit = 30, offset = 0) {
    this.streams.allow(a);
    return this.work.tx(() => {
      const all = this.raw
        .prepare(
          `SELECT s.id,s.parentId,s.title,s.outcome,s.state,s.phase,s.progressSummary,s.reportedAt,s.outcomeAvailableAt,s.reviewRequested,s.revision,a.name reporterName FROM streams s LEFT JOIN actors a ON a.id=s.reportedBy ORDER BY s.updatedAt DESC,s.id`,
        )
        .all() as {
        id: string;
        parentId: string | null;
        title: string;
        outcome: string;
        state: string;
        phase: string;
        progressSummary: string;
        reportedAt: number | null;
        outcomeAvailableAt: number | null;
        reviewRequested: number;
        reporterName: string | null;
        revision: number;
      }[];
      const roots = all.filter(
        (s) =>
          s.parentId === null &&
          (view === 'all' ||
            (view === 'history'
              ? ['closed', 'declined'].includes(s.state)
              : !['closed', 'declined'].includes(s.state))),
      );
      const changes = this.raw
        .prepare(
          'SELECT w.id,w.lifecycle,m.streamId,m.progress,m.deliveredAt FROM work w JOIN change_meta m ON m.workId=w.id',
        )
        .all() as {
        id: string;
        lifecycle: string;
        streamId: string | null;
        progress: string;
        deliveredAt: number | null;
      }[];
      const blocked = new Set(
        (
          this.raw
            .prepare(
              `SELECT DISTINCT d.targetId FROM flow_dependencies d LEFT JOIN human_actions h ON h.id=d.sourceId LEFT JOIN streams s ON s.id=d.sourceId WHERE CASE d.condition WHEN 'done' THEN coalesce(h.state='done',0) WHEN 'outcome_available' THEN s.outcomeAvailableAt IS NOT NULL WHEN 'outcome_accepted' THEN coalesce(s.state='closed',0) WHEN 'output_available' THEN EXISTS(SELECT 1 FROM change_outputs o WHERE o.workId=d.sourceId) WHEN 'integrated' THEN EXISTS(SELECT 1 FROM change_outputs o WHERE o.workId=d.sourceId AND o.state='integrated') END=0`,
            )
            .all() as { targetId: string }[]
        ).map((x) => x.targetId),
      );
      const parents = new Map(all.map((s) => [s.id, s.parentId]));
      const summaries = new Map(
        all.map((s) => [
          s.id,
          { changes: 0, delivered: 0, working: 0, blocked: 0, waitingStreams: 0 },
        ]),
      );
      const ancestors = (id: string, fn: (id: string) => void) => {
        const seen = new Set<string>();
        let current: string | null = id;
        while (current && !seen.has(current)) {
          seen.add(current);
          fn(current);
          current = parents.get(current) ?? null;
        }
      };
      for (const s of all)
        if (blocked.has(s.id))
          ancestors(s.id, (id) => {
            const sum = summaries.get(id);
            if (sum) sum.waitingStreams++;
          });
      for (const w of changes)
        if (w.streamId)
          ancestors(w.streamId, (id) => {
            const sum = summaries.get(id);
            if (!sum) return;
            sum.changes++;
            if (w.deliveredAt !== null || w.lifecycle === 'completed') sum.delivered++;
            else if (w.lifecycle === 'open') {
              if (blocked.has(w.id) || w.progress === 'blocked') sum.blocked++;
              else if (w.progress === 'working') sum.working++;
            }
          });
      const requests = this.attention(a, Number.MAX_SAFE_INTEGER).items,
        needs = new Map<string, number>();
      for (const request of requests) {
        const affected = new Set<string>();
        for (const sid of [request.streamId, ...request.affectedStreams.map((s) => s.id)])
          if (sid) ancestors(sid, (id) => affected.add(id));
        for (const id of affected) needs.set(id, (needs.get(id) ?? 0) + 1);
      }
      return {
        items: roots.slice(offset, offset + limit).map((s) => ({
          ...s,
          summary: summaries.get(s.id)!,
          needsYou: needs.get(s.id) ?? 0,
          childrenCount: all.filter((x) => x.parentId === s.id).length,
        })),
        total: roots.length,
        nextOffset: offset + limit < roots.length ? offset + limit : null,
        ungrouped: changes.filter((w) => w.streamId === null && w.lifecycle === 'open').length,
      };
    });
  }
  detail(a: Actor, id: string, limit = 30, offset = 0) {
    return this.work.tx(() => {
      const stream = this.streams.get(a, id);
      const childIds = this.raw
        .prepare(
          'SELECT id FROM streams WHERE parentId=? ORDER BY updatedAt DESC,id LIMIT ? OFFSET ?',
        )
        .all(id, limit, offset) as { id: string }[];
      const changes = this.work.list(a, {
        view: 'all',
        q: '',
        status: 'any',
        streamId: id,
        limit,
        offset,
      });
      const summary = this.raw
        .prepare(
          `WITH RECURSIVE tree(id) AS (SELECT id FROM streams WHERE id=? UNION SELECT s.id FROM streams s JOIN tree p ON s.parentId=p.id) SELECT count(*) changes,coalesce(sum(m.deliveredAt IS NOT NULL OR w.lifecycle='completed'),0) delivered FROM change_meta m JOIN work w ON w.id=m.workId WHERE m.streamId IN (SELECT id FROM tree)`,
        )
        .get(id) as { changes: number; delivered: number };
      return {
        stream,
        sync: new SyncService(this).list(a, id),
        summary,
        ancestors: lineage(this.store, id).slice(1),
        children: {
          items: childIds.map((x) => this.streams.get(a, x.id)),
          total: (
            this.raw.prepare('SELECT count(*) n FROM streams WHERE parentId=?').get(id) as {
              n: number;
            }
          ).n,
        },
        changes,
        actions: this.actions(a, id, limit, offset),
        entries: this.streams.contextEntries(a, id, limit, offset),
        outputs: this.outputs(a, id, limit, offset),
        impact: impact(this.store, id),
      };
    });
  }
}
