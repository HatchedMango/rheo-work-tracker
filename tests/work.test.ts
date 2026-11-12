import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore } from '../src/db/index.js';
import { Auth, hash } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { createSchema, listSchema, type Actor } from '../src/shared/contracts.js';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/db/schema.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let store: ReturnType<typeof openStore>, service: WorkService, auth: Auth, now: number;
let source: Actor;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
beforeEach(() => {
  now = 1_000_000;
  store = openStore(':memory:');
  service = new WorkService(store, () => now, true);
  auth = new Auth(store, () => now);
  source = auth.actor(auth.register('agent', 'External source').secret, 'bearer');
});
afterEach(() => store.close());
const create = (extra: Record<string, unknown> = {}) =>
  service.create(
    source,
    createSchema.parse({
      title: 'Investigate authentication',
      objective: 'Find the cause of the flaky test.',
      ...extra,
    }),
  );
function act(id: string, action: Parameters<WorkService['action']>[2]['action'], message = '') {
  return service.action(owner, id, { action, revision: service.get(owner, id).revision, message });
}
function worker(name = 'Worker') {
  const c = auth.register('worker', name);
  return auth.actor(c.secret, 'bearer');
}
function queued() {
  const w = create();
  act(w.id, 'accept');
  act(w.id, 'run');
  return w;
}
function result(a: Actor, run: NonNullable<ReturnType<WorkService['claim']>>, id = 'result') {
  return service.runUpdate(a, run.id, {
    type: 'result',
    claimToken: run.claimToken,
    messageId: id,
    summary: 'Simulated result, no actual work.',
    artifact: 'Simulation artifact.',
  });
}
describe('work lifecycle', () => {
  it('separates acceptance, execution approval, completion, and attention', () => {
    const w = create();
    expect(service.status(owner).inboxCount).toBe(1);
    expect(() => act(w.id, 'run')).toThrow('Accept responsibility');
    act(w.id, 'accept');
    expect(service.status(owner).inboxCount).toBe(0);
    expect(service.get(owner, w.id).runs).toHaveLength(0);
    act(w.id, 'run');
    const a = worker();
    const r = service.claim(a)!;
    expect(r.snapshot.objective).toContain('flaky');
    service.runUpdate(a, r.id, {
      type: 'progress',
      claimToken: r.claimToken,
      messageId: 'p1',
      message: 'Simulation started.',
    });
    result(a, r);
    expect(service.get(owner, w.id).lifecycle).toBe('open');
    expect(service.status(owner).inboxCount).toBe(1);
    act(w.id, 'approve');
    expect(service.get(owner, w.id).lifecycle).toBe('completed');
    expect(service.get(owner, w.id).runs[0].state).toBe('succeeded');
    expect(service.status(owner).inboxCount).toBe(0);
  });
  it('supports the manual workflow with no worker', () => {
    const w = create();
    expect(service.status(owner).inboxCount).toBe(1);
    act(w.id, 'accept');
    act(w.id, 'complete');
    expect(service.get(owner, w.id).runs).toEqual([]);
    expect(service.list(owner, listSchema.parse({ view: 'completed' })).total).toBe(1);
  });
  it('enforces inbox intake for direct callers even with a legacy routing override', () => {
    const input = {
      ...createSchema.parse({ title: 'External follow-up', objective: 'Needs a decision.' }),
      destination: 'backlog',
      ownerId: 'owner',
      lifecycle: 'completed',
    };
    const w = service.create(source, input);
    expect(w.assignment?.state).toBe('proposed');
    expect(w.ownerId).toBeNull();
    expect(w.lifecycle).toBe('open');
    expect(w.attention.map((a) => a.kind)).toEqual(['assignment']);
    expect(service.list(owner, listSchema.parse({ view: 'inbox' })).items[0].id).toBe(w.id);
  });
  it('declines responsibility without cancelling the work', () => {
    const w = create();
    act(w.id, 'decline');
    expect(service.get(owner, w.id).lifecycle).toBe('open');
    expect(service.list(owner, listSchema.parse({ view: 'backlog' })).total).toBe(1);
    act(w.id, 'accept');
    expect(service.get(owner, w.id).ownerId).toBe('owner');
  });
  it('requires another explicit approval after changes are requested', () => {
    const w = queued(),
      a = worker(),
      r = service.claim(a)!;
    result(a, r);
    expect(() => act(w.id, 'changes')).toThrow('Describe');
    act(w.id, 'changes', 'Need additional evidence.');
    expect(service.claim(a)).toBeNull();
    act(w.id, 'run');
    expect(service.claim(a)?.id).not.toBe(r.id);
  });
  it('rejects duplicate approval and stale UI writes', () => {
    const w = queued();
    expect(() => act(w.id, 'run')).toThrow('already an active');
    expect(() =>
      service.action(owner, w.id, { action: 'cancel', revision: 1, message: '' }),
    ).toThrow('changed');
    expect(service.get(owner, w.id).runs).toHaveLength(1);
  });
  it('edits context only while idle and preserves approved snapshots', () => {
    const w = create();
    service.edit(owner, w.id, w.revision, {
      title: 'Updated',
      objective: 'New objective',
      priority: 'high',
      acceptanceCriteria: ['Evidence'],
      references: [],
    });
    act(w.id, 'accept');
    act(w.id, 'run');
    expect(() =>
      service.edit(owner, w.id, service.get(owner, w.id).revision, {
        title: 'Cannot change',
        objective: 'Other',
        priority: 'low',
        acceptanceCriteria: [],
        references: [],
      }),
    ).toThrow('active run');
    expect(service.claim(worker())?.snapshot.objective).toBe('New objective');
  });
  it('cancels running attempts and rejects late writes', () => {
    const w = queued(),
      a = worker(),
      r = service.claim(a)!;
    act(w.id, 'cancel');
    expect(() => result(a, r)).toThrow('no longer active');
    expect(service.get(owner, w.id).lifecycle).toBe('cancelled');
    expect(service.status(owner).inboxCount).toBe(0);
    expect(() => act(w.id, 'run')).toThrow('no longer open');
  });
  it('handles scoped idempotent creation and conflicting retries', () => {
    const input = createSchema.parse({
      title: 'Follow-up',
      objective: 'Later',
      idempotencyKey: 'same',
    });
    const one = service.create(source, input);
    expect(service.create(source, input).id).toBe(one.id);
    expect(service.get(owner, one.id).attention).toHaveLength(1);
    expect(() => service.create(source, { ...input, title: 'Other' })).toThrow('different content');
    expect(service.list(owner, listSchema.parse({})).total).toBe(1);
  });
  it('preserves legacy idempotent retries without reopening a decided assignment', () => {
    const input = createSchema.parse({
      title: 'Legacy capture',
      objective: 'Keep the original work.',
      idempotencyKey: 'legacy',
    });
    const w = service.create(source, input);
    act(w.id, 'accept');
    const { idempotencyKey, ...content } = input;
    for (const destination of ['inbox', 'backlog']) {
      store.raw
        .prepare('UPDATE idempotency SET fingerprint = ? WHERE resourceId = ?')
        .run(hash(JSON.stringify({ ...content, destination, idempotencyKey })), w.id);
      const retry = { ...input, destination };
      expect(service.create(source, retry).id).toBe(w.id);
      expect(service.get(owner, w.id).attention).toEqual([]);
      expect(() => service.create(source, { ...input, title: 'Different' })).toThrow(
        'different content',
      );
    }
    expect(service.list(owner, listSchema.parse({})).total).toBe(1);
  });
  it('rolls back all writes if event persistence fails', () => {
    store.raw.exec(
      "CREATE TRIGGER reject_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    expect(() => create()).toThrow('test failure');
    expect(store.db.select().from(s.work).all()).toEqual([]);
    expect(store.db.select().from(s.assignments).all()).toEqual([]);
    expect(store.db.select().from(s.attention).all()).toEqual([]);
  });
  it('enforces immutable event history and foreign keys', () => {
    const w = create();
    expect(() =>
      store.db.update(s.events).set({ message: 'tamper' }).where(eq(s.events.workId, w.id)).run(),
    ).toThrow('append-only');
    expect(() => store.raw.prepare('DELETE FROM events').run()).toThrow('append-only');
    expect(() =>
      store.raw
        .prepare("INSERT INTO source_refs VALUES ('bad','missing','link','https://example.com')")
        .run(),
    ).toThrow();
  });
  it('filters and searches without interpreting query text as SQL', () => {
    const w = queued();
    expect(service.list(owner, listSchema.parse({ view: 'queued' })).total).toBe(1);
    service.claim(worker());
    expect(service.list(owner, listSchema.parse({ view: 'running' })).items[0].id).toBe(w.id);
    expect(service.list(owner, listSchema.parse({ q: "' OR 1=1 --" })).total).toBe(0);
    expect(service.list(owner, listSchema.parse({ q: 'AUTHENTICATION' })).total).toBe(1);
  });
  it('stores creation provenance and agent notes', () => {
    const c = auth.register('agent', 'Capture agent'),
      a = auth.actor(c.secret, 'bearer');
    const w = service.create(a, createSchema.parse({ title: 'Follow-up', objective: 'Later' }));
    service.note(a, w.id, 'Context', [{ system: 'issue', url: 'https://example.com/issue' }]);
    expect(service.get(owner, w.id).createdBy).toBe(a.id);
    expect(service.get(owner, w.id).sourceName).toBe('Capture agent');
    expect(service.list(owner, listSchema.parse({})).items[0].sourceName).toBe('Capture agent');
    expect(service.get(owner, w.id).events[0].actorName).toBe('Capture agent');
    expect(() => service.action(a, w.id, { action: 'accept', revision: 2, message: '' })).toThrow(
      'cannot perform',
    );
    expect(() => service.claim(a)).toThrow('cannot perform');
  });
});
describe('worker reliability and authorization', () => {
  it('allows only one claimant and one active attempt per worker', () => {
    const w = queued(),
      a = worker('A'),
      b = worker('B');
    const r = service.claim(a)!;
    expect(service.claim(b)).toBeNull();
    expect(() => service.claim(a)).toThrow('already has');
    expect(() => result(b, r)).toThrow('does not own');
    expect(() => service.runUpdate(a, r.id, { type: 'heartbeat', claimToken: 'wrong' })).toThrow(
      'does not own',
    );
    expect(service.get(owner, w.id).runs[0].claimToken).toBeNull();
    expect(service.list(owner, listSchema.parse({})).items[0].run?.claimToken).toBeNull();
  });
  it('expires leases visibly, rejects stale claims, and never replays automatically', () => {
    const w = queued(),
      a = worker(),
      r = service.claim(a)!;
    now += 60001;
    expect(service.reconcile()).toBe(1);
    expect(service.reconcile()).toBe(0);
    expect(service.get(owner, w.id).runs[0].state).toBe('failed');
    expect(service.status(owner).inboxCount).toBe(1);
    expect(() => result(a, r)).toThrow('no longer active');
    expect(service.claim(a)).toBeNull();
    act(w.id, 'run');
    const next = service.claim(a)!;
    expect(next.id).not.toBe(r.id);
    expect(() => result(a, r, 'late')).toThrow('no longer active');
  });
  it('renews leases through heartbeats', () => {
    queued();
    const a = worker(),
      r = service.claim(a)!;
    now += 50000;
    service.runUpdate(a, r.id, { type: 'heartbeat', claimToken: r.claimToken });
    now += 50000;
    expect(service.reconcile()).toBe(0);
    result(a, r);
  });
  it('deduplicates results/progress but rejects changed messages', () => {
    const w = queued(),
      a = worker(),
      r = service.claim(a)!;
    const p = {
      type: 'progress' as const,
      claimToken: r.claimToken,
      messageId: 'p1',
      message: 'Hello',
    };
    service.runUpdate(a, r.id, p);
    service.runUpdate(a, r.id, p);
    expect(service.get(owner, w.id).events.filter((e) => e.type === 'progress')).toHaveLength(1);
    expect(() => service.runUpdate(a, r.id, { ...p, message: 'Other' })).toThrow('reused');
    result(a, r);
    result(a, r);
    expect(service.get(owner, w.id).events.filter((e) => e.type === 'result')).toHaveLength(1);
  });
  it('orders work by priority then queue time', () => {
    const one = queued();
    now++;
    const high = create({ title: 'Urgent', priority: 'urgent' });
    act(high.id, 'accept');
    act(high.id, 'run');
    expect(service.claim(worker())?.snapshot.title).toBe('Urgent');
    expect(service.claim(worker())?.snapshot.title).toBe(one.title);
  });
  it('persists queued work, history, and credentials across database restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-inbox-persist-'));
    try {
      let disk = openStore(join(dir, 'db.sqlite'));
      const svc = new WorkService(disk, Date.now, true);
      const diskAuth = new Auth(disk);
      const source = diskAuth.actor(diskAuth.register('agent', 'External source').secret, 'bearer');
      const w = svc.create(source, createSchema.parse({ title: 'Durable', objective: 'Keep it' }));
      svc.action(owner, w.id, { action: 'accept', revision: 1, message: '' });
      svc.action(owner, w.id, { action: 'run', revision: 2, message: '' });
      const c = new Auth(disk).register('worker', 'Persistent');
      disk.close();
      disk = openStore(join(dir, 'db.sqlite'));
      expect(
        new WorkService(disk, Date.now, true).claim(new Auth(disk).actor(c.secret, 'bearer'))
          ?.snapshot.title,
      ).toBe('Durable');
      expect(disk.raw.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({
        n: 7,
      });
      disk.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('active/history and current-status filters', () => {
  it('keeps active work separate from history and filters before count/pagination', () => {
    const unstarted = create({ title: 'Filter fixture: unstarted' });
    const accepted = create();
    act(accepted.id, 'accept');
    const declined = create();
    act(declined.id, 'decline');
    const failed = queued();
    const failedWorker = worker();
    service.claim(failedWorker);
    now += 60001;
    service.reconcile();
    const running = queued();
    service.claim(worker());
    const review = queued();
    const reviewer = worker();
    const reviewRun = service.claim(reviewer)!;
    result(reviewer, reviewRun);
    const waiting = queued();
    const completed = create();
    act(completed.id, 'accept');
    act(completed.id, 'complete');
    const cancelled = create();
    act(cancelled.id, 'cancel');
    const blocked = create();
    store.db.update(s.work).set({ lifecycle: 'blocked' }).where(eq(s.work.id, blocked.id)).run();
    const expected = {
      backlog: unstarted.id,
      accepted: accepted.id,
      declined: declined.id,
      failed: failed.id,
      running: running.id,
      review: review.id,
      queued: waiting.id,
      blocked: blocked.id,
    };
    expect(service.list(owner, listSchema.parse({ view: 'active' })).total).toBe(8);
    expect(service.list(owner, listSchema.parse({ view: 'history' })).total).toBe(2);
    for (const [status, id] of Object.entries(expected)) {
      const filtered = service.list(owner, listSchema.parse({ view: 'active', status }));
      expect(filtered.total, status).toBe(1);
      expect(filtered.items[0].id, status).toBe(id);
    }
    expect(
      service
        .list(owner, listSchema.parse({ view: 'history', status: 'completed' }))
        .items.map((w) => w.id),
    ).toEqual([completed.id]);
    expect(
      service
        .list(owner, listSchema.parse({ view: 'history', status: 'cancelled' }))
        .items.map((w) => w.id),
    ).toEqual([cancelled.id]);
    const paged = service.list(
      owner,
      listSchema.parse({ view: 'active', status: 'backlog', limit: 1, offset: 1 }),
    );
    expect(paged.total).toBe(1);
    expect(paged.items).toEqual([]);
    expect(
      service.list(
        owner,
        listSchema.parse({ view: 'active', status: 'backlog', q: 'Filter fixture' }),
      ).total,
    ).toBe(1);
    expect(
      service.list(owner, listSchema.parse({ view: 'active', status: 'completed' })).total,
    ).toBe(0);
  });
  it('uses the newest run even when attempts share a timestamp', () => {
    const work = queued();
    const a = worker();
    const run = service.claim(a)!;
    result(a, run);
    act(work.id, 'changes', 'Try another attempt.');
    act(work.id, 'run');
    expect(
      service
        .list(owner, listSchema.parse({ view: 'active', status: 'queued' }))
        .items.map((w) => w.id),
    ).toEqual([work.id]);
    expect(service.list(owner, listSchema.parse({ view: 'active', status: 'review' })).total).toBe(
      0,
    );
    expect(service.get(owner, work.id).runs[0].state).toBe('queued');
  });
});
