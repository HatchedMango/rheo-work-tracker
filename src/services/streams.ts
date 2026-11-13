import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../shared/contracts.js';
import { listSchema } from '../shared/contracts.js';
import * as c from '../shared/streams.js';
import type { WorkService } from './work.js';
import { ensure } from './errors.js';
import { hash } from './auth.js';
import {
  routineCoverage,
  effectiveCoverage,
  activeLineage,
  assertChangeMove,
  revokeInactiveClaims,
  lineage,
} from './coverage.js';
import { flowDependencies, flowFingerprint, syncLegacyEdges } from './flow.js';
import { readTracking } from './stream-data.js';
import { allowFeedback } from './feedback.js';
import type { FeedbackOrigin } from '../shared/sync.js';

// Budget the serialized string, including JSON escapes, without splitting code points.
const clip = (value: string, bytes: number) => {
  let used = 0,
    result = '';
  for (const character of value) {
    const size = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (used + size > bytes) break;
    used += size;
    result += character;
  }
  return result;
};
const canonicalDependencies = (
  dependencies: c.Dependency[] | z.infer<typeof c.dependencySchema>[],
) =>
  dependencies
    .map(({ requiresId, stage, condition, reason }) => ({ requiresId, stage, condition, reason }))
    .sort((a, b) => a.requiresId.localeCompare(b.requiresId) || a.stage.localeCompare(b.stage));

export class StreamService {
  constructor(public work: WorkService) {}
  get raw() {
    return this.work.store.raw;
  }
  now() {
    return this.work.clock();
  }
  allow(a: Actor, scopes: Actor['scope'][] = ['owner', 'agent']) {
    this.work.allow(a, scopes);
    ensure(a.ownerId === 'owner', 403, 'Wrong owner.');
  }
  tx<T>(fn: () => T) {
    return this.work.tx(fn);
  }
  event(a: Actor, id: string, type: string, message: string, data: unknown = {}) {
    this.raw
      .prepare('INSERT INTO stream_events VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), id, a.id, type, message, JSON.stringify(data), this.now());
  }
  retry<T>(
    a: Actor,
    operation: string,
    key: string,
    input: unknown,
    fn: () => string,
    read: (id: string) => T,
  ): T {
    const k = `${a.id}:${operation}:${key}`,
      fingerprint = hash(JSON.stringify(input));
    const old = this.raw.prepare('SELECT * FROM idempotency WHERE key=?').get(k) as
      { fingerprint: string; resourceId: string } | undefined;
    if (old) {
      ensure(
        old.fingerprint === fingerprint,
        409,
        'Idempotency key was used with different content.',
      );
      return read(old.resourceId);
    }
    const id = fn();
    this.raw.prepare('INSERT INTO idempotency VALUES (?,?,?)').run(k, fingerprint, id);
    return read(id);
  }
  get(a: Actor, id: string): c.Stream {
    this.allow(a);
    const row = this.raw
      .prepare(
        `SELECT s.*,a.name sourceName,(SELECT count(*) FROM change_meta WHERE streamId=s.id) changes,(SELECT count(*) FROM change_outputs o JOIN change_meta m ON m.workId=o.workId WHERE m.streamId=s.id) outputs,(SELECT max(reportedAt) FROM change_meta WHERE streamId=s.id) lastReportAt,(SELECT count(*) FROM stream_context WHERE streamId=s.id AND kind='question' AND state='open' AND needsHuman=1) openQuestions FROM streams s JOIN actors a ON a.id=s.createdBy WHERE s.id=? AND s.workspaceId='local'`,
      )
      .get(id) as (Omit<c.Stream, 'pendingScope'> & { pendingScope: string | null }) | undefined;
    ensure(row, 404, 'Stream not found.');
    const assessment = (row as typeof row & { assessment: string | null }).assessment;
    const assessmentFingerprint = flowFingerprint(this.work.store, { id, kind: 'stream' });
    return {
      ...row,
      pendingScope: row.pendingScope ? JSON.parse(row.pendingScope) : null,
      coverage: row.coverageApprovalId
        ? effectiveCoverage(this.work.store, id, row.coverageApprovalId)
        : routineCoverage(this.work.store, id),
      dependencies: flowDependencies(this.work.store, id),
      assessmentFingerprint,
      assessmentState: !assessment
        ? 'unknown'
        : assessment === assessmentFingerprint
          ? 'current'
          : 'stale',
    };
  }
  list(a: Actor, input: z.input<typeof c.streamListSchema> = {}) {
    this.allow(a);
    const f = c.streamListSchema.parse(input);
    const where = `workspaceId='local' AND (?='all' OR (?='active' AND state IN ('active','paused','proposed')) OR (?='history' AND state IN ('closed','declined')) OR (?='inbox' AND (EXISTS(SELECT 1 FROM stream_context c WHERE c.streamId=streams.id AND c.kind='question' AND c.state='open' AND c.needsHuman=1) OR EXISTS(SELECT 1 FROM human_actions h WHERE h.streamId=streams.id AND h.state IN ('open','in_progress'))))) AND (instr(lower(title),lower(?))>0 OR instr(lower(outcome),lower(?))>0)`;
    const args = [f.view, f.view, f.view, f.view, f.q, f.q];
    const total = (
      this.raw.prepare(`SELECT count(*) n FROM streams WHERE ${where}`).get(...args) as {
        n: number;
      }
    ).n;
    const ids = this.raw
      .prepare(`SELECT id FROM streams WHERE ${where} ORDER BY updatedAt DESC,id LIMIT ? OFFSET ?`)
      .all(...args, f.limit, f.offset) as { id: string }[];
    return { items: ids.map((x) => this.get(a, x.id)), total };
  }
  submit(a: Actor, input: z.input<typeof c.submitStreamSchema>) {
    this.allow(a, ['agent']);
    const p = c.submitStreamSchema.parse(input);
    return this.tx(() =>
      this.retry(
        a,
        'stream',
        p.idempotencyKey,
        p,
        () => {
          const id = randomUUID(),
            now = this.now();
          if (p.parentId) this.get(a, p.parentId);
          const coverage =
            p.scopeIntent === 'within_scope'
              ? routineCoverage(this.work.store, p.parentId ?? null)
              : null;
          this.raw
            .prepare(
              `INSERT INTO streams(id,workspaceId,createdBy,title,outcome,constraints,context,state,createdAt,updatedAt,parentId,coverageApprovalId) VALUES (?,'local',?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              id,
              a.id,
              p.title,
              p.outcome,
              p.constraints,
              p.context,
              'active',
              now,
              now,
              p.parentId ?? null,
              coverage?.approvalId ?? null,
            );
          this.event(a, id, 'submitted', 'Stream tracked.', {
            coverage,
            title: p.title,
            outcome: p.outcome,
            constraints: p.constraints,
          });
          return id;
        },
        (id) => this.get(a, id),
      ),
    );
  }
  update(a: Actor, id: string, input: z.input<typeof c.streamUpdateSchema>) {
    this.allow(a);
    const p = c.streamUpdateSchema.parse(input);
    return this.tx(() => {
      const s = this.get(a, id);
      ensure(
        s.revision === p.revision,
        409,
        `Stream changed. Current revision: ${s.revision}. Reload and reconcile.`,
      );
      ensure(
        !['closed', 'declined'].includes(s.state),
        409,
        'Reopen the stream before updating it.',
      );
      if (p.scope) {
        ensure(!p.proposedScope, 400, 'Use scope or legacy proposedScope, not both.');
        this.raw
          .prepare(
            'UPDATE streams SET title=?,outcome=?,constraints=?,scopeRevision=scopeRevision+1 WHERE id=?',
          )
          .run(p.scope.title, p.scope.outcome, p.scope.constraints, id);
      }
      this.raw
        .prepare(
          `UPDATE streams SET context=?,pendingScope=?,revision=revision+1,updatedAt=? WHERE id=?`,
        )
        .run(
          p.context ?? s.context,
          p.proposedScope
            ? JSON.stringify(p.proposedScope)
            : s.pendingScope
              ? JSON.stringify(s.pendingScope)
              : null,
          this.now(),
          id,
        );
      this.event(
        a,
        id,
        p.scope ? 'scope_updated' : p.proposedScope ? 'scope_proposed' : 'context_updated',
        p.scope
          ? 'Updated stream goal and boundaries.'
          : p.proposedScope
            ? 'Legacy scope proposal recorded.'
            : 'Updated current context.',
        {
          before: {
            context: s.context,
            pendingScope: s.pendingScope,
            scope: { title: s.title, outcome: s.outcome, constraints: s.constraints },
          },
          after: p,
        },
      );
      return this.get(a, id);
    });
  }
  action(
    a: Actor,
    id: string,
    input: z.input<typeof c.streamActionSchema>,
    source?: FeedbackOrigin,
  ) {
    allowFeedback(this.work.store, a, source);
    const p = c.streamActionSchema.parse(input);
    if (source)
      ensure(
        [
          'accept',
          'decline',
          'accept_scope',
          'reject_scope',
          'enable_coverage',
          'keep_open',
        ].includes(p.action),
        403,
        'Chat feedback cannot perform this action.',
      );
    return this.tx(() => {
      const s = this.get(a, id);
      ensure(
        s.revision === p.revision,
        409,
        `Stream changed. Current revision: ${s.revision}. Reload and reconcile.`,
      );
      const transitions: Record<string, [string[], c.Stream['state']]> = {
        accept: [['proposed', 'active'], 'active'],
        decline: [['proposed'], 'declined'],
        pause: [['active', 'proposed'], 'paused'],
        resume: [['paused'], 'active'],
        close: [['active', 'paused', 'proposed'], 'closed'],
        reopen: [['closed', 'declined'], 'active'],
      };
      if (p.action === 'enable_coverage') {
        ensure(s.state === 'active', 409, 'Only an active stream can enable coverage.');
      } else if (p.action === 'keep_open') {
        this.raw.prepare('UPDATE streams SET reviewRequested=0 WHERE id=?').run(id);
      } else if (p.action === 'accept_scope' || p.action === 'reject_scope') {
        ensure(
          s.pendingScope && ['active', 'paused', 'proposed'].includes(s.state),
          409,
          'No pending scope revision.',
        );
        if (p.action === 'accept_scope')
          this.raw
            .prepare(
              'UPDATE streams SET title=?,outcome=?,constraints=?,scopeRevision=scopeRevision+1 WHERE id=?',
            )
            .run(s.pendingScope.title, s.pendingScope.outcome, s.pendingScope.constraints, id);
        this.raw.prepare('UPDATE streams SET pendingScope=NULL WHERE id=?').run(id);
      } else {
        const t = transitions[p.action];
        ensure(t && t[0].includes(s.state), 409, 'That action is not available for this stream.');
        this.raw
          .prepare(
            `UPDATE streams SET state=?,pendingScope=CASE WHEN ? IN ('closed','declined') THEN NULL ELSE pendingScope END WHERE id=?`,
          )
          .run(t[1], t[1], id);
      }
      if (
        p.action === 'accept' ||
        p.action === 'enable_coverage' ||
        (p.action === 'accept_scope' && s.approvalId)
      ) {
        const current = this.get(a, id),
          approval = randomUUID();
        this.raw.prepare('INSERT INTO stream_approvals VALUES (?,?,?,?,?,?)').run(
          approval,
          id,
          current.scopeRevision,
          a.id,
          JSON.stringify({
            title: current.title,
            outcome: current.outcome,
            constraints: current.constraints,
          }),
          this.now(),
        );
        this.raw
          .prepare('UPDATE streams SET approvalId=?,coverageApprovalId=NULL WHERE id=?')
          .run(approval, id);
      }
      revokeInactiveClaims(this.work.store, this.now());
      this.raw
        .prepare('UPDATE streams SET revision=revision+1,updatedAt=? WHERE id=?')
        .run(this.now(), id);
      this.event(
        a,
        id,
        source ? 'relayed_' + p.action : p.action,
        `${source ? 'Reported from ' + source.client : 'Human decision'}: ${p.action.replaceAll('_', ' ')}.`,
        {
          scope: s.pendingScope,
          ...(source ? { source } : {}),
        },
      );
      return this.get(a, id);
    });
  }
  contextEntries(a: Actor, id: string, limit = 30, offset = 0) {
    this.get(a, id);
    return {
      items: (
        this.raw
          .prepare(
            `SELECT c.*,a.name actorName FROM stream_context c JOIN actors a ON a.id=c.createdBy WHERE streamId=? ORDER BY CASE WHEN c.state='open' AND c.needsHuman=1 THEN 0 WHEN c.state='open' AND c.kind='question' THEN 1 WHEN c.state='open' THEN 2 ELSE 3 END,c.updatedAt DESC,c.rowid DESC LIMIT ? OFFSET ?`,
          )
          .all(id, Math.min(30, limit), offset) as c.ContextEntry[]
      ).map((e) => ({ ...e, needsHuman: !!e.needsHuman })),
      total: (
        this.raw.prepare('SELECT count(*) n FROM stream_context WHERE streamId=?').get(id) as {
          n: number;
        }
      ).n,
    };
  }
  recordContext(a: Actor, id: string, input: z.input<typeof c.contextEntrySchema>) {
    this.allow(a);
    const p = c.contextEntrySchema.parse(input);
    ensure(
      !p.needsHuman || p.kind === 'question',
      400,
      'Only questions can request a human decision.',
    );
    return this.tx(() => {
      this.get(a, id);
      return this.retry(
        a,
        `context:${id}`,
        p.idempotencyKey,
        p,
        () => {
          const entry = randomUUID(),
            now = this.now();
          this.raw
            .prepare(
              `INSERT INTO stream_context(id,streamId,kind,body,needsHuman,createdBy,createdAt,updatedAt,conversationUrl) VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              entry,
              id,
              p.kind,
              p.body,
              p.needsHuman ? 1 : 0,
              a.id,
              now,
              now,
              p.conversationUrl ?? null,
            );
          this.event(a, id, 'context_recorded', `Recorded ${p.kind}.`, {
            entryId: entry,
            body: p.body,
          });
          return entry;
        },
        (entry) => this.entry(a, entry),
      );
    });
  }
  entry(a: Actor, id: string) {
    this.allow(a);
    const e = this.raw
      .prepare(
        'SELECT c.*,a.name actorName FROM stream_context c JOIN actors a ON a.id=c.createdBy WHERE c.id=?',
      )
      .get(id) as c.ContextEntry | undefined;
    ensure(e, 404, 'Context entry not found.');
    return { ...e, needsHuman: !!e.needsHuman };
  }
  resolveContext(a: Actor, id: string, input: z.input<typeof c.resolveContextSchema>) {
    this.allow(a);
    const p = c.resolveContextSchema.parse(input);
    return this.tx(() => {
      const e = this.entry(a, id);
      ensure(e.revision === p.revision, 409, `Entry changed. Current revision: ${e.revision}.`);
      ensure(
        a.scope === 'owner' || e.createdBy === a.id,
        403,
        'Only the author or human owner can resolve this entry.',
      );
      ensure(
        !(e.kind === 'question' && e.needsHuman),
        409,
        'Save a human answer through the question response endpoint.',
      );
      this.raw
        .prepare('UPDATE stream_context SET state=?,revision=revision+1,updatedAt=? WHERE id=?')
        .run(p.state, this.now(), id);
      this.event(a, e.streamId, 'context_resolved', `${e.kind}: ${p.state}.`, { entryId: id });
      return this.entry(a, id);
    });
  }
  updateChange(a: Actor, id: string, input: z.input<typeof c.changeUpdateSchema>) {
    this.allow(a);
    const p = c.changeUpdateSchema.parse(input);
    return this.tx(() => {
      this.expireClaims();
      const w = this.work.row(a, id),
        m = readTracking(this.work.store, id, this.now());
      ensure(w.lifecycle === 'open', 409, 'This change is no longer open.');
      ensure(
        m.revision === p.revision,
        409,
        `Change metadata changed. Current revision: ${m.revision}. Reload and reconcile.`,
      );
      if (p.streamId) this.get(a, p.streamId);
      assertChangeMove(
        this.work.store,
        a.scope,
        m.streamId,
        p.streamId === undefined ? m.streamId : p.streamId,
        m.coverageApprovalId,
      );
      if (m.deliveredAt !== null && p.progress && p.progress !== 'delivered')
        ensure(p.progressNote?.trim(), 400, 'Explain why delivered work is reopening.');
      const planKeys = [
        'streamId',
        'expectedOutput',
        'areas',
        'resources',
        'baseRef',
        'dependencies',
      ] as const;
      const planChanged = planKeys.some(
        (k) =>
          p[k] !== undefined &&
          JSON.stringify(k === 'dependencies' ? canonicalDependencies(p.dependencies!) : p[k]) !==
            JSON.stringify(k === 'dependencies' ? canonicalDependencies(m.dependencies) : m[k]),
      );
      if (p.assessDependencies) {
        ensure(
          !planChanged,
          409,
          'Save plan changes first, then read the updated context before assessing dependencies.',
        );
        ensure(
          p.assessmentFingerprint === m.assessmentFingerprint,
          409,
          'Assessment context changed or its fingerprint is missing. Reload get_work or get_stream_context, reassess, and submit its assessmentFingerprint.',
        );
      }
      if (planChanged)
        ensure(
          m.claim?.state !== 'active',
          409,
          'Release the active claim before changing the plan.',
        );
      if (p.dependencies) {
        const seen = new Set<string>();
        for (const d of p.dependencies) {
          this.work.row(a, d.requiresId);
          ensure(d.requiresId !== id, 400, 'A change cannot depend on itself.');
          const key = `${d.requiresId}:${d.stage}`;
          ensure(!seen.has(key), 400, 'Duplicate dependency stage.');
          seen.add(key);
        }
        this.raw.prepare('DELETE FROM change_dependencies WHERE changeId=?').run(id);
        for (const d of p.dependencies)
          this.raw
            .prepare('INSERT INTO change_dependencies VALUES (?,?,?,?,?)')
            .run(id, d.requiresId, d.stage, d.condition, d.reason);
        this.validateGraph();
        syncLegacyEdges(this.work.store, id);
      }
      const reported = p.progress !== undefined || p.progressNote !== undefined;
      this.raw
        .prepare(
          `UPDATE change_meta SET streamId=?,expectedOutput=?,areas=?,resources=?,baseRef=?,progress=?,progressNote=?,reportedBy=?,reportedAt=?,revision=revision+1,planRevision=planRevision+? WHERE workId=?`,
        )
        .run(
          p.streamId === undefined ? m.streamId : p.streamId,
          p.expectedOutput ?? m.expectedOutput,
          JSON.stringify(p.areas ?? m.areas),
          JSON.stringify(p.resources ?? m.resources),
          p.baseRef ?? m.baseRef,
          (p.progress ?? m.progress) === 'delivered' ? 'review' : (p.progress ?? m.progress),
          p.progressNote ?? m.progressNote,
          reported ? a.id : m.reportedBy,
          reported ? this.now() : m.reportedAt,
          planChanged ? 1 : 0,
          id,
        );
      if (p.progress !== undefined)
        this.raw
          .prepare('UPDATE change_meta SET deliveredAt=?,deliveredBy=? WHERE workId=?')
          .run(
            p.progress === 'delivered' ? (m.deliveredAt ?? this.now()) : null,
            p.progress === 'delivered' ? a.id : null,
            id,
          );
      if (p.reviewRequested !== undefined)
        this.raw
          .prepare('UPDATE change_meta SET reviewRequested=? WHERE workId=?')
          .run(p.reviewRequested ? 1 : 0, id);
      revokeInactiveClaims(this.work.store, this.now());
      if (p.assessDependencies !== undefined)
        this.raw
          .prepare('UPDATE change_meta SET assessment=?,assessedBy=?,assessedAt=? WHERE workId=?')
          .run(
            p.assessDependencies ? p.assessmentFingerprint! : null,
            p.assessDependencies ? a.id : null,
            p.assessDependencies ? this.now() : null,
            id,
          );
      this.work.event(id, a, 'tracking_updated', 'Updated change tracking.', [], {
        before: m,
        after: p,
      });
      return this.work.get(a, id);
    });
  }
  validateGraph() {
    const edges = new Map<string, string[]>();
    const add = (x: string, y: string) => edges.set(x, [...(edges.get(x) || []), y]);
    const deps = this.raw.prepare('SELECT * FROM change_dependencies').all() as {
      changeId: string;
      requiresId: string;
      stage: string;
      condition: string;
    }[];
    for (const d of deps) {
      for (const id of [d.changeId, d.requiresId]) {
        if (!edges.has(`${id}:start`)) {
          add(`${id}:start`, `${id}:output_available`);
          add(`${id}:output_available`, `${id}:integrated`);
        }
      }
      add(
        `${d.requiresId}:${d.condition}`,
        `${d.changeId}:${d.stage === 'start' ? 'start' : 'integrated'}`,
      );
    }
    const done = new Set<string>(),
      visiting = new Set<string>();
    const visit = (n: string) => {
      ensure(!visiting.has(n), 400, 'These prerequisites create an impossible ordering cycle.');
      if (done.has(n)) return;
      visiting.add(n);
      for (const v of edges.get(n) || []) visit(v);
      visiting.delete(n);
      done.add(n);
    };
    for (const n of edges.keys()) visit(n);
  }
  outputs(a: Actor, id: string, limit = 30, offset = 0) {
    this.allow(a);
    this.work.row(a, id);
    const items = this.raw
      .prepare(
        'SELECT o.*,a.name actorName FROM change_outputs o JOIN actors a ON a.id=o.reportedBy WHERE workId=? ORDER BY reportedAt DESC,o.rowid DESC LIMIT ? OFFSET ?',
      )
      .all(id, limit, offset) as c.Output[];
    const total = (
      this.raw.prepare('SELECT count(*) n FROM change_outputs WHERE workId=?').get(id) as {
        n: number;
      }
    ).n;
    return {
      items,
      total,
      nextOffset: offset + items.length < total ? offset + items.length : null,
    };
  }
  recordOutput(a: Actor, id: string, input: z.input<typeof c.outputSchema>) {
    this.allow(a);
    const p = c.outputSchema.parse(input);
    return this.tx(() => {
      this.work.row(a, id);
      return this.retry(
        a,
        `output:${id}`,
        p.idempotencyKey,
        p,
        () => {
          const existing = this.raw
            .prepare(
              'SELECT id,revision FROM change_outputs WHERE workId=? AND url=? AND reportedBy=?',
            )
            .get(id, p.url, a.id) as { id: string; revision: number } | undefined;
          ensure(
            existing ? p.revision === existing.revision : p.revision === undefined,
            409,
            `Output report changed. Current revision: ${existing?.revision ?? 'new'}. Reload and reconcile.`,
          );
          const output = existing?.id ?? randomUUID();
          this.raw
            .prepare(
              `INSERT INTO change_outputs(id,workId,kind,url,label,codeRevision,state,reportedBy,reportedAt) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(workId,url,reportedBy) DO UPDATE SET kind=excluded.kind,label=excluded.label,codeRevision=excluded.codeRevision,state=excluded.state,reportedAt=excluded.reportedAt,revision=change_outputs.revision+1`,
            )
            .run(output, id, p.kind, p.url, p.label, p.codeRevision, p.state, a.id, this.now());
          this.work.event(
            id,
            a,
            'output_reported',
            `Reported output: ${p.label} (${p.state}).`,
            [],
            p,
          );
          return output;
        },
        (output) =>
          this.raw
            .prepare(
              'SELECT o.*,a.name actorName FROM change_outputs o JOIN actors a ON a.id=o.reportedBy WHERE o.id=?',
            )
            .get(output) as c.Output,
      );
    });
  }
  expireClaims() {
    revokeInactiveClaims(this.work.store, this.now());
    this.raw
      .prepare(
        `UPDATE collaboration_claims SET state='revoked',updatedAt=? WHERE state='active' AND (workId IN (SELECT id FROM work WHERE lifecycle!='open') OR workId IN (SELECT m.workId FROM change_meta m JOIN streams s ON s.id=m.streamId WHERE s.state!='active'))`,
      )
      .run(this.now());
    this.raw
      .prepare(
        `UPDATE collaboration_claims SET state='revoked',updatedAt=? WHERE state='active' AND credentialId IN (SELECT id FROM credentials WHERE revokedAt IS NOT NULL OR (expiresAt IS NOT NULL AND expiresAt<=?))`,
      )
      .run(this.now(), this.now());
    this.raw
      .prepare(
        `UPDATE collaboration_claims SET state='expired',updatedAt=? WHERE state='active' AND expiresAt<=?`,
      )
      .run(this.now(), this.now());
  }
  claim(a: Actor, id: string, input: z.input<typeof c.claimSchema>) {
    this.allow(a, ['agent']);
    const p = c.claimSchema.parse(input);
    ensure(a.credentialId, 403, 'A scoped agent credential is required.');
    return this.tx(() => {
      this.expireClaims();
      const w = this.work.get(a, id),
        m = w.tracking;
      ensure(
        w.lifecycle === 'open' &&
          m.progress !== 'delivered' &&
          !['declined', 'withdrawn'].includes(w.assignment?.state ?? ''),
        409,
        'Only open changes that are undelivered and not declined can be claimed.',
      );
      if (m.streamId)
        ensure(
          activeLineage(this.work.store, m.streamId),
          409,
          'The stream and its ancestors must be open and not paused.',
        );
      const previous = this.raw
        .prepare(
          `SELECT id,state FROM collaboration_claims WHERE workId=? AND actorId=? AND credentialId=? AND sessionId=? AND tokenHash=? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(id, a.id, a.credentialId, p.sessionId, hash(p.token)) as
        { id: string; state: string } | undefined;
      if (previous) {
        ensure(
          previous.state === 'active',
          409,
          'This claim attempt is no longer active. Start a new attempt with a new private token.',
        );
        return { claim: m.claim, token: p.token };
      }
      ensure(m.claim?.state !== 'active', 409, 'This change already has an active claim.');
      ensure(
        m.revision === p.revision,
        409,
        `Change metadata changed. Current revision: ${m.revision}.`,
      );
      const claims = this.raw
        .prepare(
          `SELECT c.workId,m.resources FROM collaboration_claims c JOIN change_meta m ON m.workId=c.workId WHERE c.state='active'`,
        )
        .all() as { workId: string; resources: string }[];
      ensure(
        !claims.some((c) => JSON.parse(c.resources).some((r: string) => m.resources.includes(r))),
        409,
        'An exclusive resource is already claimed.',
      );
      const claimId = randomUUID(),
        token = p.token,
        now = this.now();
      this.raw
        .prepare(`INSERT INTO collaboration_claims VALUES (?,?,?,?,?,?,?,'active',?,?,?)`)
        .run(
          claimId,
          id,
          a.id,
          a.credentialId,
          p.sessionId,
          hash(token),
          m.planRevision,
          now + p.leaseSeconds * 1000,
          now,
          now,
        );
      this.work.event(
        id,
        a,
        'collaboration_claimed',
        'Agent claimed this change for collaboration.',
        [],
        { claimId, sessionId: p.sessionId, planRevision: m.planRevision },
      );
      return { claim: readTracking(this.work.store, id, now).claim, token };
    });
  }
  renew(a: Actor, id: string, input: z.input<typeof c.renewClaimSchema>) {
    this.allow(a, ['agent']);
    const p = c.renewClaimSchema.parse(input);
    return this.tx(() => {
      this.expireClaims();
      const claim = this.raw.prepare('SELECT * FROM collaboration_claims WHERE id=?').get(id) as
        | {
            actorId: string;
            credentialId: string;
            sessionId: string;
            tokenHash: string;
            state: string;
            workId: string;
          }
        | undefined;
      ensure(claim, 404, 'Claim not found.');
      ensure(
        claim.actorId === a.id &&
          claim.credentialId === a.credentialId &&
          claim.sessionId === p.sessionId &&
          claim.tokenHash === hash(p.token),
        403,
        'Claim ownership does not match this credential/session.',
      );
      ensure(claim.state === 'active', 409, 'This claim is no longer active.');
      const w = this.work.row(a, claim.workId);
      ensure(
        p.release || w.lifecycle === 'open',
        409,
        'Release this claim; the change is no longer open.',
      );
      this.raw
        .prepare('UPDATE collaboration_claims SET state=?,expiresAt=?,updatedAt=? WHERE id=?')
        .run(p.release ? 'released' : 'active', this.now() + p.leaseSeconds * 1000, this.now(), id);
      if (p.release)
        this.work.event(
          claim.workId,
          a,
          'collaboration_released',
          'Agent released the collaboration claim.',
        );
      return { claim: readTracking(this.work.store, claim.workId, this.now()).claim };
    });
  }
  events(a: Actor, id: string, limit = 30, offset = 0) {
    this.get(a, id);
    return {
      items: this.raw
        .prepare(
          `SELECT e.*,a.name actorName FROM stream_events e JOIN actors a ON a.id=e.actorId WHERE streamId=? ORDER BY e.createdAt DESC,e.rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(id, Math.min(30, limit), offset),
      total: (
        this.raw.prepare('SELECT count(*) n FROM stream_events WHERE streamId=?').get(id) as {
          n: number;
        }
      ).n,
    };
  }
  context(a: Actor, input: z.input<typeof c.streamContextSchema> = {}, diagnostic = false) {
    return this.tx(() => {
      this.allow(a);
      const p = c.streamContextSchema.parse(input);
      const change = p.changeId ? this.work.get(a, p.changeId) : null;
      if (change && p.streamId)
        ensure(
          change.tracking.streamId === p.streamId,
          400,
          'The change does not belong to that stream.',
        );
      const streamId = p.streamId ?? change?.tracking.streamId;
      if (!streamId && !change) {
        const choices = this.list(a, { view: 'all', limit: p.limit, offset: p.offset });
        return {
          workflowVersion: c.WORKFLOW_VERSION,
          selectionRequired: true as const,
          project: p.project,
          streams: {
            items: choices.items.map(({ id, title, outcome, state, changes, outputs }) => ({
              id,
              title: clip(title, 180),
              outcome: clip(outcome, 600),
              state,
              changes,
              outputs,
            })),
            total: choices.total,
            nextOffset: p.offset + p.limit < choices.total ? p.offset + p.limit : null,
          },
          instruction: 'Choose a stream or change explicitly. No project binding was inferred.',
        };
      }
      const stream = streamId ? this.get(a, streamId) : null;
      const entryOffset = p.entryOffset ?? p.offset,
        changeOffset = p.changeOffset ?? p.offset;
      const entries = streamId
        ? this.contextEntries(a, streamId, p.limit, entryOffset)
        : { items: [], total: 0 };
      const allChanges = change
        ? { items: [change], total: 1 }
        : this.work.list(
            a,
            listSchema.parse({ view: 'all', streamId, limit: p.limit, offset: changeOffset }),
          );
      const changes = allChanges.items.map((w) => ({
        id: w.id,
        title: clip(w.title, 180),
        objective: clip(w.objective, 1000),
        lifecycle: w.lifecycle,
        revision: w.revision,
        assignment: w.assignment,
        tracking: {
          ...w.tracking,
          streamTitle: w.tracking.streamTitle === null ? null : clip(w.tracking.streamTitle, 180),
          reporterName:
            w.tracking.reporterName === null ? null : clip(w.tracking.reporterName, 120),
          claim: w.tracking.claim
            ? { ...w.tracking.claim, actorName: clip(w.tracking.claim.actorName, 120) }
            : null,
          expectedOutput: clip(w.tracking.expectedOutput, 1500),
          progressNote: clip(w.tracking.progressNote, 1500),
          areas: w.tracking.areas.slice(0, 5).map((x) => clip(x, 200)),
          resources: w.tracking.resources.slice(0, 5).map((x) => clip(x, 200)),
          baseRef: clip(w.tracking.baseRef, 500),
          prerequisites: w.tracking.prerequisites
            .slice(0, 4)
            .map((d) => ({ ...d, title: clip(d.title, 180), reason: clip(d.reason, 400) })),
          dependencies: w.tracking.dependencies
            .slice(0, 4)
            .map((d) => ({ ...d, title: clip(d.title, 180), reason: clip(d.reason, 600) })),
          outputs: w.tracking.outputs.slice(0, 2).map((o) => ({
            ...o,
            label: clip(o.label, 180),
            codeRevision: clip(o.codeRevision, 300),
            actorName: clip(o.actorName, 120),
          })),
        },
        detail: `/api/work/${w.id}`,
        summary: true,
        dependencyCount: w.tracking.prerequisites.length,
        // The full output list remains pageable via get_work(part: outputs).
        outputCount: (
          this.raw.prepare('SELECT count(*) n FROM change_outputs WHERE workId=?').get(w.id) as {
            n: number;
          }
        ).n,
      }));
      const streamSummary = stream
        ? {
            ...stream,
            dependencies: stream.dependencies
              .slice(0, 4)
              .map((d) => ({ ...d, title: clip(d.title, 180), reason: clip(d.reason, 400) })),
            dependencyCount: stream.dependencies.length,
            phase: clip(stream.phase, 120),
            progressSummary: clip(stream.progressSummary, 1500),
            title: clip(stream.title, 180),
            sourceName: clip(stream.sourceName, 120),
            outcome: clip(stream.outcome, 3000),
            constraints: clip(stream.constraints, 3000),
            context: clip(stream.context, 3000),
            pendingScope: stream.pendingScope
              ? {
                  title: clip(stream.pendingScope.title, 180),
                  outcome: clip(stream.pendingScope.outcome, 1500),
                  constraints: clip(stream.pendingScope.constraints, 1500),
                }
              : null,
            detail: `/api/streams/${stream.id}`,
            summary: true,
          }
        : null;
      const actionOffset = p.actionOffset ?? p.offset,
        childOffset = p.childOffset ?? p.offset;
      const actions = streamId
        ? (this.raw
            .prepare(
              `SELECT h.id,h.title,h.doneWhen,h.state,h.response,h.waitingOn,h.revision,h.respondedBy,h.updatedAt,h.conversationUrl FROM human_actions h WHERE h.streamId=? ORDER BY CASE WHEN h.state IN ('open','in_progress') THEN 0 ELSE 1 END,h.updatedAt DESC,h.id LIMIT ? OFFSET ?`,
            )
            .all(streamId, p.limit, actionOffset) as {
            id: string;
            title: string;
            doneWhen: string;
            state: string;
            response: string;
            waitingOn: string;
            conversationUrl: string | null;
            revision: number;
            respondedBy: string | null;
            updatedAt: number;
          }[])
        : [];
      const actionTotal = streamId
        ? (
            this.raw
              .prepare('SELECT count(*) n FROM human_actions WHERE streamId=?')
              .get(streamId) as { n: number }
          ).n
        : 0;
      const children = streamId
        ? (this.raw
            .prepare(
              'SELECT id,title,outcome,state FROM streams WHERE parentId=? ORDER BY updatedAt DESC,id LIMIT ? OFFSET ?',
            )
            .all(streamId, p.limit, childOffset) as {
            id: string;
            title: string;
            outcome: string;
            state: string;
          }[])
        : [];
      const childTotal = streamId
        ? (
            this.raw.prepare('SELECT count(*) n FROM streams WHERE parentId=?').get(streamId) as {
              n: number;
            }
          ).n
        : 0;
      const ancestors = streamId ? lineage(this.work.store, streamId).slice(1) : [];
      const response = {
        workflowVersion: c.WORKFLOW_VERSION,
        project: p.project,
        selectionRequired: false as const,
        stream: streamSummary,
        ancestors: {
          items: ancestors
            .slice(0, 8)
            .map(({ id, title, state, scopeRevision, approvalId, coverageApprovalId }) => ({
              id,
              title: clip(title, 180),
              state,
              scopeRevision,
              approvalId,
              coverageApprovalId,
            })),
          total: ancestors.length,
        },
        humanActions: {
          items: actions.map((h) => ({
            ...h,
            title: clip(h.title, 180),
            doneWhen: clip(h.doneWhen, 600),
            response: clip(h.response, 600),
            waitingOn: clip(h.waitingOn, 200),
            detail: `/api/human-actions/${h.id}`,
            summary: true,
          })),
          total: actionTotal,
          nextOffset: null as number | null,
        },
        children: {
          items: children.map((s) => ({
            ...s,
            title: clip(s.title, 180),
            outcome: clip(s.outcome, 600),
            detail: `/api/streams/${s.id}`,
            summary: true,
          })),
          total: childTotal,
          nextOffset: null as number | null,
        },
        entries: {
          ...entries,
          items: entries.items.map((e) => ({
            ...e,
            body: clip(e.body, 2000),
            answer: e.answer === null ? null : clip(e.answer, 1500),
            actorName: clip(e.actorName, 120),
            summary: true,
            detail: `/api/context/${e.id}`,
          })),
          nextOffset: null as number | null,
        },
        changes: { items: changes, total: allChanges.total, nextOffset: null as number | null },
        history: streamId ? `/api/streams/${streamId}/events` : null,
        provenance:
          'Summaries may shorten fields; retrieve full records by ID. Progress, output state, and prerequisite satisfaction are attributed reports, not independent observations or human acceptance.',
      };
      const cursors = () => {
        response.humanActions.nextOffset =
          actionOffset + response.humanActions.items.length < actionTotal
            ? actionOffset + response.humanActions.items.length
            : null;
        response.children.nextOffset =
          childOffset + response.children.items.length < childTotal
            ? childOffset + response.children.items.length
            : null;
        response.entries.nextOffset =
          entryOffset + response.entries.items.length < entries.total
            ? entryOffset + response.entries.items.length
            : null;
        response.changes.nextOffset =
          !change && changeOffset + response.changes.items.length < allChanges.total
            ? changeOffset + response.changes.items.length
            : null;
      };
      cursors();
      while (Buffer.byteLength(JSON.stringify(response)) > 48000) {
        if (response.changes.items.length > 1) response.changes.items.pop();
        // A single output URL can itself be large after JSON escaping. Preserve the
        // selected change, ownership and context; callers can fetch full outputs by ID.
        else if (response.changes.items[0]?.tracking.outputs.length)
          response.changes.items[0].tracking.outputs.pop();
        else if (response.children.items.length) response.children.items.pop();
        else if (response.entries.items.length) response.entries.items.pop();
        else if (response.humanActions.items.length) response.humanActions.items.pop();
        else if (response.changes.items[0]?.tracking.prerequisites.length)
          response.changes.items[0].tracking.prerequisites.pop();
        else if (response.changes.items[0]?.tracking.dependencies.length)
          response.changes.items[0].tracking.dependencies.pop();
        else throw new Error('Bounded context summary exceeded its fixed field budgets.');
        cursors();
      }
      if (a.credentialId && !diagnostic)
        this.raw
          .prepare(
            `INSERT INTO workflow_reads VALUES (?,?,?,?,?) ON CONFLICT(credentialId) DO UPDATE SET workflowVersion=excluded.workflowVersion,project=excluded.project,streamId=excluded.streamId,lastReadAt=excluded.lastReadAt`,
          )
          .run(a.credentialId, c.WORKFLOW_VERSION, p.project, streamId ?? null, this.now());
      return response;
    });
  }
}
