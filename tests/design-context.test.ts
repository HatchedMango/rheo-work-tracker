import { beforeEach, afterEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { Auth } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { DesignContextService } from '../src/services/design-context.js';
import { OversightService } from '../src/services/oversight.js';
import { SyncService } from '../src/services/sync.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
import type { DesignTarget } from '../src/shared/design-context.js';
let store: ReturnType<typeof openStore>,
  work: WorkService,
  streams: StreamService,
  design: DesignContextService,
  agent: Actor,
  other: Actor;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
beforeEach(() => {
  store = openStore(':memory:');
  work = new WorkService(store, () => 1000000);
  streams = new StreamService(work);
  design = new DesignContextService(streams);
  const auth = new Auth(store, () => 1000000);
  agent = auth.actor(auth.register('agent', 'Author').secret, 'bearer');
  other = auth.actor(auth.register('agent', 'Other').secret, 'bearer');
});
afterEach(() => store.close());
const stream = (parentId?: string) =>
  streams.submit(agent, {
    title: 'Scope',
    outcome: 'Retain context',
    parentId,
    idempotencyKey: randomUUID(),
  });
const change = (streamId?: string) =>
  work.create(
    agent,
    createSchema.parse({
      title: 'Output',
      objective: 'Keep evidence bounded',
      streamId,
      acceptanceCriteria: ['Images remain private.'],
      idempotencyKey: randomUUID(),
    }),
  );
const assumption = (target: DesignTarget) =>
  design.save(agent, {
    target,
    record: {
      kind: 'assumption',
      statement: 'The storage endpoint supports private uploads.',
      status: 'supported',
      evidence: 'Provider documentation.',
      invalidatedBy: 'Anonymous access succeeds.',
    },
    reason: 'Record a design dependency.',
    idempotencyKey: randomUUID(),
  });
it('keeps semantic history with safe retries, no-op updates, revision conflicts and author fences', () => {
  const w = change(),
    target = { kind: 'change' as const, id: w.id };
  const initial = assumption(target);
  const p = {
    id: initial.id,
    revision: 1,
    target,
    record: { ...initial.record, evidence: 'Checked in staging.' },
    reason: 'Verified the provider behavior.',
    idempotencyKey: randomUUID(),
  };
  const next = design.save(agent, p);
  expect(next.revision).toBe(2);
  expect(design.save(agent, p).revision).toBe(2);
  expect(() => design.save(agent, { ...p, idempotencyKey: randomUUID() })).toThrow('changed');
  expect(() => design.save(other, { ...p, revision: 2, idempotencyKey: randomUUID() })).toThrow(
    'author',
  );
  expect(design.save(agent, { ...p, revision: 2, idempotencyKey: randomUUID() }).revision).toBe(2);
  const history = work.get(agent, w.id).events.filter((e) => e.type === 'design_context_changed');
  expect(history).toHaveLength(2);
  expect(history[0].data.before).toMatchObject({ evidence: 'Provider documentation.' });
  expect(() =>
    design.save(owner, {
      ...p,
      revision: 2,
      target: { kind: 'stream', id: stream().id },
      idempotencyKey: randomUUID(),
    }),
  ).toThrow('scope');
  expect(() => design.list({ ...agent, scope: 'worker' }, { target })).toThrow('credential');
  expect(() => design.read({ ...agent, ownerId: 'someone-else' }, initial.id)).toThrow('owner');
});
it('flags only explicitly linked work after assumption edits and never changes lifecycle or output credit', () => {
  const s = stream(),
    source = assumption({ kind: 'stream', id: s.id }),
    a = change(s.id),
    b = change(s.id);
  const p = {
    changeId: a.id,
    assumptionId: source.id,
    assumptionRevision: 1,
    revision: 0,
    note: 'The upload path depends on this behavior.',
    idempotencyKey: randomUUID(),
  };
  expect(design.review(agent, p).needsReview).toBe(false);
  expect(design.review(agent, p).revision).toBe(1);
  streams.recordOutput(agent, a.id, {
    kind: 'document',
    label: 'Retained output',
    url: 'https://example.com/output',
    state: 'available',
    idempotencyKey: randomUUID(),
  });
  streams.updateChange(agent, a.id, {
    revision: work.get(agent, a.id).tracking.revision,
    progress: 'delivered',
    progressNote: 'Bounded output retained.',
  });
  const before = work.get(agent, a.id);
  design.save(agent, {
    id: source.id,
    revision: 1,
    target: source.target,
    record: {
      ...source.record,
      kind: 'assumption',
      statement: 'The storage endpoint supports private uploads.',
      status: 'invalidated',
      invalidatedBy: 'Anonymous access succeeds.',
      evidence: 'The staging probe returned a public image.',
    },
    reason: 'Observed a failed privacy check.',
    idempotencyKey: randomUUID(),
  });
  expect(design.summary(agent, { kind: 'change', id: a.id }).needsReview).toBe(1);
  expect(design.read(agent, source.id).dependents?.items[0]).toMatchObject({
    changeId: a.id,
    needsReview: true,
  });
  expect(design.summary(agent, { kind: 'change', id: b.id }).needsReview).toBe(0);
  expect(design.list(agent, { target: { kind: 'change', id: a.id } }).reviews[0]).toMatchObject({
    needsReview: true,
    status: 'invalidated',
    currentRevision: 2,
  });
  const after = work.get(agent, a.id);
  expect(after.lifecycle).toBe(before.lifecycle);
  expect(after.tracking.progress).toBe(before.tracking.progress);
  expect(after.attention).toEqual(before.attention);
  expect(after.tracking.deliveredAt).toBe(before.tracking.deliveredAt);
  expect(after.tracking.outputs).toEqual(before.tracking.outputs);
  expect(store.raw.prepare('SELECT count(*) n FROM change_completions').get()).toEqual({ n: 1 });
  expect(() => design.review(agent, { ...p, revision: 1, idempotencyKey: randomUUID() })).toThrow(
    'Assumption changed',
  );
  expect(
    design.review(other, {
      ...p,
      revision: 1,
      assumptionRevision: 2,
      note: 'Reviewed the impact; replace the upload adapter.',
      idempotencyKey: randomUUID(),
    }).needsReview,
  ).toBe(false);
  expect(design.summary(agent, { kind: 'change', id: a.id }).needsReview).toBe(0);
  expect(design.read(agent, source.id).record).toMatchObject({ status: 'invalidated' });
});
it('inherits only active opt-in ancestor invariants and recomputes membership after moves', () => {
  const parent = stream(),
    child = stream(parent.id),
    sibling = stream(parent.id),
    w = change(child.id);
  const save = (id: string, inherit: boolean) =>
    design.save(agent, {
      target: { kind: 'stream', id },
      record: {
        kind: 'invariant',
        statement: 'Uploads remain private.',
        applicability: 'Image upload pipeline',
        status: 'active',
        inherit,
      },
      reason: 'Preserve privacy.',
      idempotencyKey: randomUUID(),
    });
  const inherited = save(parent.id, true);
  save(parent.id, false);
  save(sibling.id, true);
  save(child.id, false);
  const target = { kind: 'change' as const, id: w.id };
  expect(design.list(agent, { target }).items.map((r) => r.id)).toEqual([inherited.id]);
  expect(design.list(agent, { target: { kind: 'stream', id: child.id } }).items).toHaveLength(2);
  const before = design.fingerprint(agent, target);
  design.save(agent, {
    id: inherited.id,
    revision: 1,
    target: inherited.target,
    record: {
      ...inherited.record,
      kind: 'invariant',
      statement: 'Uploads remain private.',
      applicability: 'Image upload pipeline',
      inherit: true,
      status: 'retired',
    },
    reason: 'Replace with scoped storage rules.',
    idempotencyKey: randomUUID(),
  });
  expect(design.list(agent, { target }).total).toBe(0);
  expect(design.fingerprint(agent, target)).not.toEqual(before);
  streams.updateChange(owner, w.id, { revision: w.tracking.revision, streamId: sibling.id });
  expect(design.list(agent, { target }).items).toHaveLength(1);
});
it('snapshots exact criteria and records conditions, limitations and code revision without certifying delivery', () => {
  const w = change(),
    target = { kind: 'change' as const, id: w.id };
  const record = {
    kind: 'verification' as const,
    criterionIndex: 0,
    criterion: w.acceptanceCriteria[0],
    result: 'pass' as const,
    method: 'manual' as const,
    evidence: 'Anonymous GET returned 403.',
    conditions: 'Staging bucket, signed-out browser.',
    limitations: 'Does not cover production or expired signed URLs.',
    codeRevision: 'abc123',
    checkedAt: 999999,
  };
  const v = design.save(agent, {
    target,
    record,
    reason: 'Checked the privacy criterion.',
    idempotencyKey: randomUUID(),
  });
  expect(v.criterionChanged).toBe(false);
  expect(() =>
    design.save(agent, {
      target,
      record: { ...record, criterion: 'Wrong criterion' },
      reason: 'Wrong',
      idempotencyKey: randomUUID(),
    }),
  ).toThrow('Criterion changed');
  expect(() =>
    design.save(agent, {
      target: { kind: 'stream', id: stream().id },
      record,
      reason: 'Wrong scope',
      idempotencyKey: randomUUID(),
    }),
  ).toThrow('change criterion');
  expect(() =>
    design.save(agent, {
      target,
      record: { ...record, checkedAt: 1000001 },
      reason: 'Future',
      idempotencyKey: randomUUID(),
    }),
  ).toThrow('future');
  work.edit(owner, w.id, w.revision, {
    title: w.title,
    objective: w.objective,
    acceptanceCriteria: ['Private uploads expire.'],
    priority: 'normal',
    references: [],
  });
  expect(design.read(agent, v.id).criterionChanged).toBe(true);
  expect(work.get(agent, w.id).tracking.deliveredAt).toBeNull();
  expect(() =>
    design.save(agent, {
      target,
      record: {
        ...record,
        references: [{ system: 'unsafe', url: 'https://token:secret@example.com' }],
      },
      reason: 'Unsafe reference',
      idempotencyKey: randomUUID(),
    }),
  ).toThrow('credentials');
});
it('bounds context pages, retains all cursors and changes compact freshness for linked and inherited edits', () => {
  const s = stream(),
    w = change(s.id),
    target = { kind: 'change' as const, id: w.id },
    sync = new SyncService(new OversightService(streams));
  for (let i = 0; i < 14; i++) {
    const source = assumption({ kind: 'stream', id: s.id });
    design.review(agent, {
      changeId: w.id,
      assumptionId: source.id,
      assumptionRevision: 1,
      revision: 0,
      note: 'A relevant assumption.',
      idempotencyKey: randomUUID(),
    });
  }
  const page = design.list(agent, { target, limit: 12 });
  expect(page.total).toBe(14);
  expect(page.items).toHaveLength(12);
  expect(page.nextOffset).toBe(12);
  expect(page.reviewNextOffset).toBe(12);
  expect(design.list(agent, { target, limit: 12, offset: 12 }).items).toHaveLength(2);
  const before = sync.compactContext(agent, s.id, w.id, '').freshness;
  const source = page.items[0];
  design.save(agent, {
    id: source.id,
    revision: 1,
    target: source.target,
    record: {
      ...source.record,
      kind: 'assumption',
      statement: 'The storage endpoint supports private uploads.',
      status: 'supported',
      invalidatedBy: 'Anonymous access succeeds.',
      evidence: 'A new observation.',
    },
    reason: 'Recheck required.',
    idempotencyKey: randomUUID(),
  });
  expect(sync.compactContext(agent, s.id, w.id, '').freshness).not.toBe(before);
  const context = streams.context(agent, { changeId: w.id });
  if (context.selectionRequired) throw new Error('Expected selected context');
  expect(context.designContext).toMatchObject({ total: 14, needsReview: 1 });
  expect(context.designContext.items).toHaveLength(4);
});
