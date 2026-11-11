import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Store } from '../db/index.js';
import * as s from '../db/schema.js';
import type {
  Actor,
  CreateWork,
  Content,
  Action,
  ListFilter,
  RunUpdate,
} from '../shared/contracts.js';
import { ensure } from './errors.js';
import { hash } from './auth.js';
import { createSchema } from '../shared/contracts.js';
const active = ['queued', 'claimed', 'running', 'awaiting_review'];
export class WorkService {
  constructor(
    public store: Store,
    public clock: () => number = Date.now,
    public allowSimulation = false,
  ) {}
  get db() {
    return this.store.db;
  }
  tx<T>(fn: () => T): T {
    return this.store.raw.transaction(fn).immediate();
  }
  allow(a: Actor, scopes: Actor['scope'][]) {
    ensure(scopes.includes(a.scope), 403, 'This credential cannot perform that action.');
  }
  event(
    workId: string,
    a: Actor,
    type: string,
    message: string,
    refs: Content['references'] = [],
    data: Record<string, unknown> = {},
  ) {
    this.db
      .insert(s.events)
      .values({
        id: randomUUID(),
        workId,
        actorId: a.id,
        type,
        message,
        data,
        references: refs,
        createdAt: this.clock(),
      })
      .run();
  }
  notify(workId: string, kind: string) {
    this.db
      .insert(s.attention)
      .values({ id: randomUUID(), workId, kind, createdAt: this.clock() })
      .onConflictDoNothing()
      .run();
  }
  resolve(workId: string, kind?: string) {
    this.db
      .update(s.attention)
      .set({ resolvedAt: this.clock() })
      .where(
        and(
          eq(s.attention.workId, workId),
          isNull(s.attention.resolvedAt),
          kind ? eq(s.attention.kind, kind) : undefined,
        ),
      )
      .run();
  }
  bump(w: s.Work, patch: Partial<s.Work> = {}) {
    this.db
      .update(s.work)
      .set({ ...patch, revision: w.revision + 1, updatedAt: this.clock() })
      .where(eq(s.work.id, w.id))
      .run();
  }
  row(a: Actor, id: string) {
    const w = this.db.select().from(s.work).where(eq(s.work.id, id)).get();
    ensure(w && w.workspaceId === 'local', 404, 'Work item not found.');
    // This installation has exactly one owner; other actors are locally issued delegates.
    ensure(a.ownerId === 'owner', 403, 'Wrong owner.');
    return w;
  }
  get(a: Actor, id: string): s.Detail {
    this.allow(a, ['owner', 'agent']);
    const w = this.row(a, id);
    const events = this.db
      .select({ event: s.events, actorName: s.actors.name })
      .from(s.events)
      .innerJoin(s.actors, eq(s.events.actorId, s.actors.id))
      .where(eq(s.events.workId, id))
      .orderBy(desc(s.events.createdAt), desc(sql`events.rowid`))
      .limit(300)
      .all();
    return {
      ...w,
      sourceName: this.db
        .select({ name: s.actors.name })
        .from(s.actors)
        .where(eq(s.actors.id, w.createdBy))
        .get()!.name,
      references: this.db.select().from(s.references).where(eq(s.references.workId, id)).all(),
      assignment:
        this.db.select().from(s.assignments).where(eq(s.assignments.workId, id)).get() ?? null,
      runs: this.db
        .select()
        .from(s.runs)
        .where(eq(s.runs.workId, id))
        .orderBy(desc(s.runs.createdAt), desc(sql`runs.rowid`))
        .limit(50)
        .all()
        .map((r) => ({ ...r, claimToken: null })),
      attention: this.db
        .select()
        .from(s.attention)
        .where(and(eq(s.attention.workId, id), isNull(s.attention.resolvedAt)))
        .all(),
      events: events.map((x) => ({ ...x.event, actorName: x.actorName })),
    };
  }
  list(a: Actor, f: ListFilter) {
    this.allow(a, ['owner', 'agent']);
    ensure(a.ownerId === 'owner', 403, 'Wrong owner.');
    const clauses = [eq(s.work.workspaceId, 'local')];
    if (f.q)
      clauses.push(
        sql`(instr(lower(${s.work.title}),lower(${f.q}))>0 or instr(lower(${s.work.objective}),lower(${f.q}))>0)`,
      );
    if (f.view === 'inbox')
      clauses.push(
        sql`exists(select 1 from attention where attention.workId=${s.work.id} and resolvedAt is null)`,
      );
    if (f.view === 'active') clauses.push(inArray(s.work.lifecycle, ['open', 'blocked']));
    if (f.view === 'history') clauses.push(inArray(s.work.lifecycle, ['completed', 'cancelled']));
    if (f.status !== 'any') {
      // Derive the current display status before counting/paginating. Only the latest
      // attempt counts, so an old queued/failed attempt cannot match a newer one.
      const currentStatus = sql<string>`case when ${s.work.lifecycle} != 'open' then ${s.work.lifecycle} else coalesce(
        (select case state when 'claimed' then 'running' when 'running' then 'running' when 'queued' then 'queued' when 'awaiting_review' then 'review' when 'failed' then 'failed' else null end
          from runs where runs.workId=${s.work.id} order by createdAt desc, rowid desc limit 1),
        (select case state when 'accepted' then 'accepted' when 'declined' then 'declined' else 'backlog' end from assignments where assignments.workId=${s.work.id}), 'backlog') end`;
      clauses.push(eq(currentStatus, f.status));
    }
    if (['completed', 'cancelled'].includes(f.view)) clauses.push(eq(s.work.lifecycle, f.view));
    if (['queued', 'running', 'review'].includes(f.view)) {
      const states =
        f.view === 'running'
          ? ['claimed', 'running']
          : f.view === 'review'
            ? ['awaiting_review']
            : ['queued'];
      clauses.push(
        sql`exists(select 1 from runs where runs.workId=${s.work.id} and runs.state in ${states})`,
      );
    }
    if (f.view === 'backlog')
      clauses.push(
        eq(s.work.lifecycle, 'open'),
        sql`not exists(select 1 from runs where runs.workId=${s.work.id} and runs.state in ('queued','claimed','running','awaiting_review'))`,
        sql`not exists(select 1 from attention where attention.workId=${s.work.id} and resolvedAt is null)`,
      );
    const where = and(...clauses);
    const total = this.db
      .select({ count: sql<number>`count(*)` })
      .from(s.work)
      .where(where)
      .get()!.count;
    const items = this.db
      .select({ work: s.work, sourceName: s.actors.name })
      .from(s.work)
      .innerJoin(s.actors, eq(s.work.createdBy, s.actors.id))
      .where(where)
      .orderBy(desc(s.work.updatedAt), s.work.id)
      .limit(f.limit)
      .offset(f.offset)
      .all()
      .map(({ work: w, sourceName }) => ({
        ...w,
        sourceName,
        assignment:
          this.db.select().from(s.assignments).where(eq(s.assignments.workId, w.id)).get() ?? null,
        run:
          this.db
            .select()
            .from(s.runs)
            .where(eq(s.runs.workId, w.id))
            .orderBy(desc(s.runs.createdAt), desc(sql`runs.rowid`))
            .get() ?? null,
        attention: this.db
          .select()
          .from(s.attention)
          .where(and(eq(s.attention.workId, w.id), isNull(s.attention.resolvedAt)))
          .all(),
      }))
      .map((w) => ({ ...w, run: w.run ? { ...w.run, claimToken: null } : null }));
    return { items, total };
  }
  create(a: Actor, input: CreateWork) {
    this.allow(a, ['agent']);
    ensure(a.ownerId === 'owner', 403, 'Wrong owner.');
    // Routing is product policy, even for direct service callers or older clients
    // that still send a destination. Only capture content enters the transaction.
    input = createSchema.parse(input);
    return this.tx(() => {
      const key = input.idempotencyKey ? `${a.id}:create:${input.idempotencyKey}` : null;
      const fingerprint = hash(JSON.stringify(input));
      const previous = key
        ? this.db.select().from(s.idempotency).where(eq(s.idempotency.key, key)).get()
        : null;
      if (previous) {
        // Before inbox-only intake, destination was part of the fingerprint.
        // Preserve retries from those clients without allowing routing overrides.
        const { idempotencyKey, ...content } = input;
        const legacyMatch = ['inbox', 'backlog'].some(
          (destination) =>
            previous.fingerprint ===
            hash(JSON.stringify({ ...content, destination, idempotencyKey })),
        );
        ensure(
          previous.fingerprint === fingerprint || legacyMatch,
          409,
          'Idempotency key was used with different content.',
        );
        return this.get(a, previous.resourceId);
      }
      const id = randomUUID();
      const now = this.clock();
      this.db
        .insert(s.work)
        .values({
          id,
          workspaceId: 'local',
          createdBy: a.id,
          title: input.title,
          objective: input.objective,
          acceptanceCriteria: input.acceptanceCriteria,
          priority: input.priority,
          lifecycle: 'open',
          revision: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const ref of input.references)
        this.db
          .insert(s.references)
          .values({ id: randomUUID(), workId: id, ...ref })
          .run();
      this.db
        .insert(s.assignments)
        .values({ id: randomUUID(), workId: id, recipientId: a.ownerId, state: 'proposed' })
        .run();
      this.notify(id, 'assignment');
      this.event(id, a, 'created', 'Created and sent to your inbox.', input.references);
      if (key) this.db.insert(s.idempotency).values({ key, fingerprint, resourceId: id }).run();
      return this.get(a, id);
    });
  }
  editable(a: Actor, id: string, revision: number) {
    this.allow(a, ['owner']);
    const w = this.row(a, id);
    ensure(w.revision === revision, 409, 'This item changed. Refresh and try again.');
    ensure(w.lifecycle === 'open', 409, 'This work is no longer open.');
    return w;
  }
  edit(a: Actor, id: string, revision: number, input: Content) {
    return this.tx(() => {
      const w = this.editable(a, id, revision);
      ensure(!this.liveRun(id), 409, 'Resolve or cancel the active run before editing.');
      const before = {
        title: w.title,
        objective: w.objective,
        acceptanceCriteria: w.acceptanceCriteria,
        priority: w.priority,
        references: this.db
          .select()
          .from(s.references)
          .where(eq(s.references.workId, id))
          .all()
          .map(({ system, url }) => ({ system, url })),
      };
      const { references, ...content } = input;
      this.bump(w, content);
      this.db.delete(s.references).where(eq(s.references.workId, id)).run();
      for (const ref of references)
        this.db
          .insert(s.references)
          .values({ id: randomUUID(), workId: id, ...ref })
          .run();
      this.event(
        id,
        a,
        'edited',
        `Updated work context (revision ${w.revision} → ${w.revision + 1}).`,
        [],
        { before, after: input },
      );
      return this.get(a, id);
    });
  }
  note(a: Actor, id: string, message: string, refs: Content['references']) {
    this.allow(a, ['owner', 'agent']);
    return this.tx(() => {
      const w = this.row(a, id);
      this.event(id, a, 'note', message, refs);
      this.bump(w);
      return this.get(a, id);
    });
  }
  liveRun(id: string) {
    return this.db
      .select()
      .from(s.runs)
      .where(and(eq(s.runs.workId, id), inArray(s.runs.state, active)))
      .get();
  }
  action(a: Actor, id: string, input: Action) {
    return this.tx(() => {
      const w = this.editable(a, id, input.revision);
      const assignment = this.db
        .select()
        .from(s.assignments)
        .where(eq(s.assignments.workId, id))
        .get()!;
      const run = this.liveRun(id);
      let message = '';
      let type: string = input.action;
      switch (input.action) {
        case 'accept':
        case 'decline': {
          ensure(!run, 409, 'Resolve the active run first.');
          ensure(
            assignment.state === 'proposed' ||
              (input.action === 'accept' && assignment.state === 'declined'),
            409,
            'Assignment already decided.',
          );
          this.db
            .update(s.assignments)
            .set({
              state: input.action === 'accept' ? 'accepted' : 'declined',
              decidedAt: this.clock(),
            })
            .where(eq(s.assignments.id, assignment.id))
            .run();
          this.resolve(id, 'assignment');
          message =
            input.action === 'accept'
              ? 'You accepted responsibility. Execution still requires approval.'
              : 'Assignment declined; work remains in the backlog.';
          this.bump(w, { ownerId: input.action === 'accept' ? a.id : null });
          break;
        }
        case 'run': {
          ensure(this.allowSimulation, 409, 'No execution worker connected.');
          ensure(
            assignment.state === 'accepted' && w.ownerId === a.id,
            409,
            'Accept responsibility before approving execution.',
          );
          ensure(!run, 409, 'There is already an active run.');
          const approvalId = randomUUID();
          const runId = randomUUID();
          const snapshot: Content = {
            title: w.title,
            objective: w.objective,
            acceptanceCriteria: w.acceptanceCriteria,
            priority: w.priority as Content['priority'],
            references: this.db
              .select()
              .from(s.references)
              .where(eq(s.references.workId, id))
              .all()
              .map(({ system, url }) => ({ system, url })),
          };
          this.db
            .insert(s.approvals)
            .values({
              id: approvalId,
              workId: id,
              approverId: a.id,
              adapter: 'stub',
              revision: w.revision,
              snapshot,
              createdAt: this.clock(),
            })
            .run();
          this.db
            .insert(s.runs)
            .values({
              id: runId,
              workId: id,
              approvalId,
              ownerId: a.id,
              state: 'queued',
              createdAt: this.clock(),
              updatedAt: this.clock(),
            })
            .run();
          this.resolve(id, 'failure');
          this.bump(w);
          message = 'Approved one simulated execution; queued for your stub worker.';
          break;
        }
        case 'complete':
          ensure(
            assignment.state === 'accepted' && w.ownerId === a.id,
            409,
            'Accept the work first.',
          );
          ensure(!run, 409, 'Resolve the active run first.');
          this.bump(w, { lifecycle: 'completed' });
          this.resolve(id);
          message = 'Marked complete manually.';
          break;
        case 'cancel':
          if (run)
            this.db
              .update(s.runs)
              .set({ state: 'cancelled', leaseExpiresAt: null, updatedAt: this.clock() })
              .where(eq(s.runs.id, run.id))
              .run();
          this.db
            .update(s.assignments)
            .set({ state: 'withdrawn', decidedAt: this.clock() })
            .where(eq(s.assignments.id, assignment.id))
            .run();
          this.bump(w, { lifecycle: 'cancelled' });
          this.resolve(id);
          message = 'Work cancelled.';
          break;
        case 'approve':
        case 'changes':
          ensure(
            run?.state === 'awaiting_review' && w.ownerId === a.id,
            409,
            'No result is awaiting your review.',
          );
          if (input.action === 'changes')
            ensure(input.message.trim(), 400, 'Describe the changes needed.');
          this.db
            .update(s.runs)
            .set({
              state: input.action === 'approve' ? 'succeeded' : 'changes_requested',
              updatedAt: this.clock(),
            })
            .where(eq(s.runs.id, run.id))
            .run();
          this.resolve(id, 'review');
          this.bump(w, input.action === 'approve' ? { lifecycle: 'completed' } : {});
          message =
            input.action === 'approve'
              ? 'Approved the simulated result and marked work complete.'
              : `Changes requested: ${input.message}`;
          break;
        case 'dismiss_failure':
          ensure(
            this.db
              .select()
              .from(s.attention)
              .where(
                and(
                  eq(s.attention.workId, id),
                  eq(s.attention.kind, 'failure'),
                  isNull(s.attention.resolvedAt),
                ),
              )
              .get(),
            409,
            'No failure needs attention.',
          );
          this.resolve(id, 'failure');
          this.bump(w);
          message = 'Failure acknowledged. Work remains open; another attempt needs approval.';
          break;
      }
      this.event(id, a, type, message);
      return this.get(a, id);
    });
  }
  reconcile() {
    return this.tx(() => {
      const expired = this.db
        .select()
        .from(s.runs)
        .where(
          and(
            inArray(s.runs.state, ['claimed', 'running']),
            sql`${s.runs.leaseExpiresAt} <= ${this.clock()}`,
          ),
        )
        .all();
      for (const r of expired) {
        this.db
          .update(s.runs)
          .set({
            state: 'failed',
            failure: 'Worker lease expired. No automatic retry was started.',
            leaseExpiresAt: null,
            updatedAt: this.clock(),
          })
          .where(eq(s.runs.id, r.id))
          .run();
        this.notify(r.workId, 'failure');
        this.bump(this.row({ id: 'owner', scope: 'owner', ownerId: 'owner' }, r.workId));
        this.event(
          r.workId,
          { id: 'system', scope: 'owner', ownerId: 'owner' },
          'lease_expired',
          'Worker connection was lost; the attempt failed. Approve a new attempt when ready.',
        );
      }
      return expired.length;
    });
  }
  claim(a: Actor) {
    this.allow(a, ['worker']);
    ensure(this.allowSimulation, 409, 'No execution worker connected.');
    this.reconcile();
    return this.tx(() => {
      this.db.update(s.actors).set({ lastSeen: this.clock() }).where(eq(s.actors.id, a.id)).run();
      ensure(
        !this.db
          .select()
          .from(s.runs)
          .where(and(eq(s.runs.workerId, a.id), inArray(s.runs.state, ['claimed', 'running'])))
          .get(),
        409,
        'This worker already has an active attempt.',
      );
      const found = this.db
        .select({ run: s.runs })
        .from(s.runs)
        .innerJoin(s.work, eq(s.runs.workId, s.work.id))
        .where(
          and(
            eq(s.runs.state, 'queued'),
            eq(s.runs.ownerId, a.ownerId),
            eq(s.work.lifecycle, 'open'),
          ),
        )
        .orderBy(
          sql`case ${s.work.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
          s.runs.createdAt,
          s.runs.id,
        )
        .get();
      if (!found) return null;
      const token = randomUUID();
      const r = found.run;
      this.db
        .update(s.runs)
        .set({
          state: 'claimed',
          workerId: a.id,
          claimToken: token,
          leaseExpiresAt: this.clock() + 60000,
          updatedAt: this.clock(),
        })
        .where(eq(s.runs.id, r.id))
        .run();
      this.event(r.workId, a, 'claimed', 'Stub worker claimed the approved attempt.');
      const approval = this.db
        .select()
        .from(s.approvals)
        .where(eq(s.approvals.id, r.approvalId))
        .get()!;
      return {
        id: r.id,
        claimToken: token,
        adapter: approval.adapter,
        snapshot: approval.snapshot,
      };
    });
  }
  runUpdate(a: Actor, id: string, input: RunUpdate) {
    this.allow(a, ['worker']);
    ensure(this.allowSimulation, 409, 'No execution worker connected.');
    this.reconcile();
    return this.tx(() => {
      const r = this.db.select().from(s.runs).where(eq(s.runs.id, id)).get();
      ensure(
        r && r.ownerId === a.ownerId && r.workerId === a.id && r.claimToken === input.claimToken,
        403,
        'Worker does not own this claim.',
      );
      const key = input.type === 'heartbeat' ? null : `${a.id}:run:${id}:${input.messageId}`;
      const fingerprint = hash(JSON.stringify(input));
      const prev = key
        ? this.db.select().from(s.idempotency).where(eq(s.idempotency.key, key)).get()
        : null;
      if (prev) {
        ensure(prev.fingerprint === fingerprint, 409, 'Message ID reused with different content.');
        return { ok: true };
      }
      ensure(
        ['claimed', 'running'].includes(r.state) && r.leaseExpiresAt! > this.clock(),
        409,
        'Attempt is no longer active. Do not replay it.',
      );
      this.db.update(s.actors).set({ lastSeen: this.clock() }).where(eq(s.actors.id, a.id)).run();
      const patch: Partial<s.Run> = {
        state: 'running',
        leaseExpiresAt: this.clock() + 60000,
        updatedAt: this.clock(),
      };
      if (input.type === 'progress') this.event(r.workId, a, 'progress', input.message);
      if (input.type === 'result') {
        Object.assign(patch, {
          state: 'awaiting_review',
          leaseExpiresAt: null,
          summary: input.summary,
          artifact: input.artifact,
        });
        this.event(r.workId, a, 'result', input.summary);
        this.notify(r.workId, 'review');
        this.bump(this.row(a, r.workId));
      }
      this.db.update(s.runs).set(patch).where(eq(s.runs.id, id)).run();
      if (key) this.db.insert(s.idempotency).values({ key, fingerprint, resourceId: id }).run();
      return { ok: true };
    });
  }
  status(a: Actor) {
    this.allow(a, ['owner', 'agent']);
    return {
      identity: 'You',
      adapter: this.allowSimulation ? 'stub' : null,
      executionAvailable: false,
      inboxCount: this.db
        .select({ count: sql<number>`count(distinct ${s.attention.workId})` })
        .from(s.attention)
        .where(isNull(s.attention.resolvedAt))
        .get()!.count,
      workers: !this.allowSimulation
        ? []
        : this.db
            .select({ id: s.actors.id, name: s.actors.name, lastSeen: s.actors.lastSeen })
            .from(s.actors)
            .where(
              and(
                eq(s.actors.kind, 'worker'),
                sql`exists(select 1 from credentials where credentials.actorId=${s.actors.id} and credentials.scope='worker' and revokedAt is null)`,
              ),
            )
            .all()
            .map((w) => ({
              ...w,
              online: w.lastSeen !== null && w.lastSeen > this.clock() - 15000,
            })),
    };
  }
}
export type WorkList = ReturnType<WorkService['list']>;
export type Status = ReturnType<WorkService['status']>;
