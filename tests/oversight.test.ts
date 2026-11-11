import { beforeEach, afterEach, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { OversightService } from '../src/services/oversight.js';
import { Auth } from '../src/services/auth.js';
import { createSchema, listSchema, type Actor } from '../src/shared/contracts.js';
let store: ReturnType<typeof openStore>,
  work: WorkService,
  streams: StreamService,
  flow: OversightService,
  agent: Actor;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
beforeEach(() => {
  store = openStore(':memory:');
  work = new WorkService(store);
  streams = new StreamService(work);
  flow = new OversightService(streams);
  const auth = new Auth(store);
  agent = auth.actor(auth.register('agent', 'Fixture agent').secret, 'bearer');
});
afterEach(() => store.close());
const submit = (title: string, parentId?: string) =>
  streams.submit(agent, {
    title,
    outcome: 'A usable outcome',
    parentId,
    scopeIntent: 'within_scope',
    idempotencyKey: randomUUID(),
  });
const approve = (s: ReturnType<typeof submit>) =>
  streams.action(owner, s.id, { revision: s.revision, action: 'accept' });
const change = (streamId: string, title = 'Routine change') =>
  work.create(
    agent,
    createSchema.parse({
      title,
      objective: 'Deliver a reviewable output',
      streamId,
      scopeIntent: 'within_scope',
      idempotencyKey: randomUUID(),
    }),
  );
const action = (streamId: string) =>
  flow.createAction(agent, {
    streamId,
    title: 'Get API access from Bob',
    doneWhen: 'Access is available in the local credential store',
    waitingOn: 'Bob',
    idempotencyKey: randomUUID(),
  });
const gate = (targetId: string, kind: 'stream' | 'change', revision: number, sourceId: string) =>
  flow.dependencies(agent, {
    target: { id: targetId, kind },
    revision,
    dependencies: [
      {
        source: { id: sourceId, kind: 'human_action' },
        stage: 'start',
        condition: 'done',
        reason: 'Access is required to connect the API',
      },
    ],
  });
it('joins approved decomposition, partial blockage, human response, evidence and routine delivery without a completion chore', () => {
  const root = approve(submit('Launch integration')),
    first = submit('API branch', root.id),
    second = submit('Independent docs', root.id);
  expect(first.state).toBe('active');
  expect(first.coverage?.approvalId).toBe(root.approvalId);
  const a = change(first.id, 'Connect API'),
    b = change(second.id, 'Write documentation');
  expect(a.assignment?.state).toBe('covered');
  expect(a.ownerId).toBeNull();
  expect(a.events.some((e) => e.type === 'assignment_accepted')).toBe(false);
  expect(work.status(owner).inboxCount).toBe(0);
  const h = action(root.id);
  gate(a.id, 'change', a.tracking.revision, h.id);
  streams.updateChange(agent, b.id, { revision: 1, progress: 'working' });
  const pin = work.get(agent, a.id).tracking;
  streams.updateChange(agent, a.id, {
    revision: pin.revision,
    assessDependencies: true,
    assessmentFingerprint: pin.assessmentFingerprint,
  });
  const attention = flow.attention(owner);
  expect(attention.total).toBe(1);
  expect(attention.items[0].direct.map((x) => x.id)).toEqual([a.id]);
  expect(new Set(attention.items[0].affectedStreams.map((x) => x.id))).toEqual(
    new Set([first.id, root.id]),
  );
  expect(work.status(owner).inboxCount).toBe(attention.total);
  expect(flow.overview(owner).items[0].summary).toMatchObject({
    blocked: 1,
    working: 1,
    changes: 2,
  });
  expect(() =>
    flow.respond(agent, h.id, {
      revision: 1,
      state: 'done',
      response: 'Done',
      idempotencyKey: 'forged',
    }),
  ).toThrow('Only the owner');
  const response = {
    revision: 1,
    state: 'done' as const,
    response: 'Bob granted access; use the existing local credential store.',
    idempotencyKey: 'answer',
  };
  expect(flow.respond(owner, h.id, response).state).toBe('done');
  expect(flow.respond(owner, h.id, response).revision).toBe(2);
  expect(flow.attention(owner).total).toBe(0);
  const after = work.get(agent, a.id).tracking;
  expect(after.prerequisites[0]).toMatchObject({ satisfied: true, evidence: 'human' });
  expect(after.assessmentState).toBe('stale');
  expect(flow.overview(owner).items[0].summary).toMatchObject({ blocked: 0, working: 1 });
  streams.updateChange(agent, a.id, { revision: after.revision, progress: 'delivered' });
  expect(work.get(owner, a.id).lifecycle).toBe('open');
  expect(streams.get(owner, root.id).state).toBe('active');
  expect(
    work.list(owner, listSchema.parse({ view: 'active' })).items.map((w) => w.id),
  ).not.toContain(a.id);
  expect(work.list(owner, listSchema.parse({ view: 'history' })).items.map((w) => w.id)).toContain(
    a.id,
  );
  expect(flow.attention(owner).total).toBe(0);
  expect(() =>
    streams.claim(agent, a.id, {
      revision: work.get(agent, a.id).tracking.revision,
      sessionId: randomUUID(),
      token: randomBytes(32).toString('base64url'),
    }),
  ).toThrow('open changes');
  expect(() =>
    streams.updateChange(agent, a.id, {
      revision: work.get(agent, a.id).tracking.revision,
      progress: 'working',
    }),
  ).toThrow('Explain');
  const reopened = streams.updateChange(agent, a.id, {
    revision: work.get(agent, a.id).tracking.revision,
    progress: 'working',
    progressNote: 'Additional scope-preserving test fix is needed.',
  });
  expect(reopened.tracking.deliveredAt).toBeNull();
});
it('keeps old policy and uncertain retries intact; enables future coverage without retroactively accepting proposals', () => {
  const root = submit('Legacy stream');
  store.raw.prepare("UPDATE streams SET state='active' WHERE id=?").run(root.id);
  const p = {
    title: 'Old proposal',
    objective: 'Unknown coverage',
    streamId: root.id,
    scopeIntent: 'within_scope' as const,
    idempotencyKey: 'retry',
  };
  const old = work.create(agent, createSchema.parse(p));
  expect(old.assignment?.state).toBe('proposed');
  const enabled = streams.action(owner, root.id, {
    revision: root.revision,
    action: 'enable_coverage',
  });
  expect(work.create(agent, createSchema.parse(p)).assignment?.state).toBe('proposed');
  expect(change(root.id).assignment?.state).toBe('covered');
  expect(() =>
    flow.cover(agent, root.id, { streamRevision: enabled.revision, changeIds: [old.id] }),
  ).toThrow('credential');
  flow.cover(owner, root.id, { streamRevision: enabled.revision, changeIds: [old.id] });
  expect(work.get(owner, old.id).assignment?.state).toBe('covered');
  expect(work.get(owner, old.id).tracking.coverage?.approvalId).toBe(enabled.approvalId);
  const expansion = work.create(
    agent,
    createSchema.parse({ ...p, idempotencyKey: 'expand', scopeIntent: 'scope_expansion' }),
  );
  expect(expansion.assignment?.state).toBe('proposed');
  expect(
    work.create(
      agent,
      createSchema.parse({ ...p, idempotencyKey: 'absent', scopeIntent: undefined }),
    ).assignment?.state,
  ).toBe('proposed');
});
it('revokes descendant claims on ancestor pause, scope drift and cross-root moves without reviving leases', () => {
  let root = approve(submit('Root'));
  const child = submit('Child', root.id),
    w = change(child.id),
    sessionId = randomUUID(),
    token = randomBytes(32).toString('base64url');
  const lease = streams.claim(agent, w.id, { revision: 1, sessionId, token });
  root = streams.action(owner, root.id, { revision: root.revision, action: 'pause' });
  expect(work.get(agent, w.id).tracking.claim?.state).toBe('revoked');
  root = streams.action(owner, root.id, { revision: root.revision, action: 'resume' });
  expect(() => streams.claim(agent, w.id, { revision: 1, sessionId, token })).toThrow(
    'no longer active',
  );
  expect(() => streams.renew(agent, lease.claim!.id, { sessionId, token })).toThrow(
    'no longer active',
  );
  const other = approve(submit('Other'));
  expect(() =>
    flow.move(agent, child.id, {
      streamRevision: child.revision,
      parentId: other.id,
      reason: 'Reorganize',
    }),
  ).toThrow('owner');
  const moved = flow.move(owner, child.id, {
    streamRevision: child.revision,
    parentId: other.id,
    reason: 'Change direction',
  });
  expect(moved.coverage).toBeNull();
  expect(() =>
    streams.claim(agent, w.id, {
      revision: 1,
      sessionId: randomUUID(),
      token: randomBytes(32).toString('base64url'),
    }),
  ).toThrow('currently covered');
  expect(flow.attention(owner).items.some((i) => i.kind === 'coverage')).toBe(true);
});
it('keeps composition separate, rejects containment and mixed stage cycles atomically, and permits parallel branches', () => {
  const root = approve(submit('Root')),
    a = submit('A', root.id),
    b = submit('B', root.id);
  expect(() =>
    flow.move(owner, root.id, { streamRevision: root.revision, parentId: a.id, reason: 'Cycle' }),
  ).toThrow('cannot contain');
  const dep = (target: string, revision: number, source: string) =>
    flow.dependencies(agent, {
      target: { id: target, kind: 'stream' },
      revision,
      dependencies: [
        {
          source: { id: source, kind: 'stream' },
          stage: 'start',
          condition: 'outcome_available',
          reason: 'Need its output',
        },
      ],
    });
  dep(a.id, a.revision, b.id);
  expect(() => dep(b.id, b.revision, a.id)).toThrow('cycle');
  expect(streams.get(agent, b.id).dependencies).toEqual([]);
  expect(streams.get(agent, root.id).dependencies).toEqual([]);
  const c = change(a.id);
  flow.dependencies(agent, {
    target: { id: c.id, kind: 'change' },
    revision: 1,
    dependencies: [
      {
        source: { id: b.id, kind: 'stream' },
        stage: 'deliver',
        condition: 'outcome_available',
        reason: 'Integrate when ready',
      },
    ],
  });
  expect(work.get(agent, c.id).tracking.prerequisites).toHaveLength(1);
});
it('deduplicates shared human impact, cancellation does not satisfy, and reopening stales assessments', () => {
  const root = approve(submit('Root')),
    a = submit('A', root.id),
    b = submit('B', root.id),
    h = action(root.id);
  gate(a.id, 'stream', a.revision, h.id);
  gate(b.id, 'stream', b.revision, h.id);
  const item = flow.attention(owner).items[0];
  expect(item.direct).toHaveLength(2);
  expect(item.affectedStreams.filter((s) => s.id === root.id)).toHaveLength(1);
  flow.respond(agent, h.id, {
    revision: 1,
    state: 'cancelled',
    response: 'Obsolete request',
    idempotencyKey: 'cancel',
  });
  expect(streams.get(agent, a.id).dependencies[0].satisfied).toBe(false);
  expect(flow.attention(owner).total).toBe(0);
  flow.respond(owner, h.id, {
    revision: 2,
    state: 'open',
    response: 'Still required',
    idempotencyKey: 'reopen',
  });
  expect(flow.attention(owner).total).toBe(1);
  const fingerprint = streams.get(agent, a.id).assessmentFingerprint;
  flow.respond(owner, h.id, {
    revision: 3,
    state: 'done',
    response: 'Ready',
    idempotencyKey: 'done',
  });
  expect(() =>
    flow.report(agent, a.id, {
      streamRevision: 2,
      assessDependencies: true,
      assessmentFingerprint: fingerprint,
    }),
  ).toThrow('Assessment context changed');
});
it('preserves human answers and rejects flag-only resolutions, stale responses and agent answers', () => {
  const root = approve(submit('Root')),
    q = streams.recordContext(agent, root.id, {
      kind: 'question',
      body: 'Which endpoint?',
      needsHuman: true,
      idempotencyKey: 'q',
    });
  expect(() => streams.resolveContext(agent, q.id, { revision: 1, state: 'resolved' })).toThrow(
    'human answer',
  );
  expect(() =>
    flow.answer(agent, q.id, { revision: 1, answer: 'My choice', idempotencyKey: 'bad' }),
  ).toThrow('credential');
  flow.answer(owner, q.id, { revision: 1, answer: 'Use staging.', idempotencyKey: 'answer' });
  expect(streams.entry(agent, q.id)).toMatchObject({
    state: 'resolved',
    answer: 'Use staging.',
    answeredBy: 'owner',
  });
  expect(() =>
    flow.answer(owner, q.id, { revision: 1, answer: 'Use prod.', idempotencyKey: 'stale' }),
  ).toThrow('changed');
});
it('pins ancestor scope and action evidence while ignoring report wording and dependency ordering', () => {
  const root = approve(submit('Root')),
    branch = submit('Branch', root.id),
    w = change(branch.id),
    h = action(root.id),
    h2 = flow.createAction(agent, {
      streamId: root.id,
      title: 'Get documentation',
      doneWhen: 'Docs are linked',
      idempotencyKey: 'docs',
    });
  const deps = [h, h2].map((h) => ({
    source: { id: h.id, kind: 'human_action' as const },
    stage: 'start' as const,
    condition: 'done' as const,
    reason: 'Needed',
  }));
  flow.dependencies(agent, {
    target: { id: w.id, kind: 'change' },
    revision: 1,
    dependencies: deps,
  });
  let m = work.get(agent, w.id).tracking;
  streams.updateChange(agent, w.id, {
    revision: m.revision,
    assessDependencies: true,
    assessmentFingerprint: m.assessmentFingerprint,
  });
  m = work.get(agent, w.id).tracking;
  flow.dependencies(agent, {
    target: { id: w.id, kind: 'change' },
    revision: m.revision,
    dependencies: [...deps].reverse(),
  });
  expect(work.get(agent, w.id).tracking.revision).toBe(m.revision);
  streams.updateChange(agent, w.id, { revision: m.revision, progressNote: 'Wording only' });
  expect(work.get(agent, w.id).tracking.assessmentState).toBe('current');
  let s = streams.update(agent, root.id, {
    revision: root.revision,
    proposedScope: { title: 'Root expanded', outcome: 'Broader outcome' },
  });
  s = streams.action(owner, root.id, { revision: s.revision, action: 'accept_scope' });
  expect(work.get(agent, w.id).tracking.assessmentState).toBe('stale');
  expect(work.get(agent, w.id).tracking.coverage).toBeNull();
  expect(() =>
    streams.claim(agent, w.id, {
      revision: work.get(agent, w.id).tracking.revision,
      sessionId: randomUUID(),
      token: randomBytes(32).toString('base64url'),
    }),
  ).toThrow('currently covered');
  flow.cover(owner, root.id, {
    streamRevision: s.revision,
    streamIds: [branch.id],
    changeIds: [w.id],
  });
  expect(work.get(agent, w.id).tracking.coverage?.approvalId).toBe(s.approvalId);
});
it('bounds escaped context with paginated human requests, children and cross-type prerequisites', () => {
  const root = approve(submit('Root'));
  for (let i = 0; i < 30; i++) {
    submit('Child ' + i, root.id);
    flow.createAction(agent, {
      streamId: root.id,
      title: 'Request ' + i,
      doneWhen: '\u0000'.repeat(1500),
      description: '\u0000'.repeat(4000),
      idempotencyKey: String(i),
    });
    streams.recordContext(agent, root.id, {
      kind: 'question',
      body: '\u0000'.repeat(4000),
      needsHuman: true,
      idempotencyKey: String(i),
    });
  }
  const context = streams.context(agent, { streamId: root.id, limit: 30 });
  expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(48000);
  if (context.selectionRequired) throw new Error('Selection lost');
  expect(context.humanActions.items.length).toBeGreaterThan(0);
  expect(context.humanActions.total).toBe(30);
  expect(context.children.total).toBe(30);
  expect(context.entries.total).toBe(30);
  expect(context.humanActions.items[0].detail).toContain('/api/human-actions/');
});
