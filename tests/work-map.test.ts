import { beforeEach, afterEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { Auth } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { OversightService } from '../src/services/oversight.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
import { orderMapNodes } from '../src/shared/work-map.js';
let store: ReturnType<typeof openStore>,
  work: WorkService,
  streams: StreamService,
  flow: OversightService,
  agent: Actor;
beforeEach(() => {
  store = openStore(':memory:');
  work = new WorkService(store);
  streams = new StreamService(work);
  flow = new OversightService(streams);
  const auth = new Auth(store);
  agent = auth.actor(auth.register('agent', 'Map fixture').secret, 'bearer');
});
afterEach(() => store.close());
const stream = (title: string, parentId?: string) =>
  streams.submit(agent, { title, outcome: title, parentId, idempotencyKey: randomUUID() });
const change = (streamId: string, title: string) =>
  work.create(agent, createSchema.parse({ streamId, title, objective: 'Useful result: ' + title }));
it('separates composition from real cross-branch and external prerequisites, including a human blocker', () => {
  const root = stream('Make intake useful'),
    a = stream('Connect API', root.id),
    b = stream('Write guidance', root.id),
    outside = stream('Shared contract');
  const target = change(a.id, 'Connect the endpoint'),
    parallel = change(b.id, 'Write the guide'),
    source = change(outside.id, 'Publish contract');
  const human = flow.createAction(agent, {
    streamId: root.id,
    title: 'Get access from Bob',
    doneWhen: 'Access is ready',
    conversationUrl: 'codex://threads/' + randomUUID(),
    idempotencyKey: randomUUID(),
  });
  flow.dependencies(agent, {
    target: { id: target.id, kind: 'change' },
    revision: 1,
    dependencies: [
      {
        source: { id: human.id, kind: 'human_action' },
        stage: 'start',
        condition: 'done',
        reason: 'Access is required',
      },
      {
        source: { id: source.id, kind: 'change' },
        stage: 'deliver',
        condition: 'output_available',
        reason: 'Use the shared contract',
      },
    ],
  });
  streams.recordOutput(agent, source.id, {
    kind: 'mr',
    url: 'https://example.com/mr/1',
    label: 'Contract',
    state: 'available',
    idempotencyKey: randomUUID(),
  });
  streams.updateChange(agent, parallel.id, { revision: 1, progress: 'working' });
  const map = flow.map(agent, root.id);
  expect(map.complete).toBe(true);
  expect(map.groups.find((g) => g.id === a.id)?.parentId).toBe(root.id);
  expect(map.nodes.find((n) => n.id === target.id)).toMatchObject({
    groupId: a.id,
    status: 'Waiting to start',
  });
  expect(map.nodes.find((n) => n.id === parallel.id)?.status).toBe('In progress');
  expect(map.nodes.find((n) => n.id === source.id)).toMatchObject({
    groupId: 'linked',
    reference: true,
  });
  expect(map.nodes.find((n) => n.id === human.id)?.conversationUrl).toBe(human.conversationUrl);
  expect(map.edges).toHaveLength(2);
  expect(map.edges.find((e) => e.sourceId === human.id)).toMatchObject({
    stage: 'start',
    satisfied: false,
    evidence: 'unknown',
  });
  expect(map.edges.find((e) => e.sourceId === source.id)).toMatchObject({
    stage: 'deliver',
    satisfied: true,
    evidence: 'reported',
  });
  expect(map.edges.some((e) => e.sourceId === root.id && e.targetId === a.id)).toBe(false);
  expect(store.raw.prepare('SELECT count(*) n FROM stream_approvals').get()).toEqual({ n: 0 });
});
it('does not infer independence from missing or stale assessment and preserves delivered work', () => {
  const s = stream('Daily use'),
    unassessed = change(s.id, 'Unassessed'),
    assessed = change(s.id, 'Assessed'),
    done = change(s.id, 'Delivered result');
  streams.updateChange(agent, assessed.id, {
    revision: 1,
    assessDependencies: true,
    assessmentFingerprint: assessed.tracking.assessmentFingerprint,
  });
  streams.updateChange(agent, done.id, { revision: 1, progress: 'delivered' });
  let map = flow.map(agent, s.id);
  expect(map.nodes.find((n) => n.id === unassessed.id)).toMatchObject({
    status: 'Planned',
    assessment: 'unknown',
  });
  expect(map.nodes.find((n) => n.id === assessed.id)).toMatchObject({
    status: 'Ready',
    assessment: 'current',
  });
  expect(map.nodes.find((n) => n.id === done.id)).toMatchObject({
    status: 'Delivered',
    quiet: true,
  });
  streams.update(agent, s.id, {
    revision: s.revision,
    scope: { title: 'Changed goal', outcome: 'Changed boundary' },
  });
  map = flow.map(agent, s.id);
  expect(map.nodes.find((n) => n.id === assessed.id)).toMatchObject({
    status: 'Planned',
    assessment: 'stale',
  });
  expect(map.edges).toEqual([]);
  streams.updateChange(agent, unassessed.id, { revision: 1, progress: 'working' });
  const active = flow.map(agent, s.id);
  expect(orderMapNodes(active.nodes, active.edges).nodes[0].id).toBe(unassessed.id);
});
it('retains stage-valid node loops and distinguishes delivery gates from start blockers', () => {
  const s = stream('Staged work'),
    a = change(s.id, 'A'),
    b = change(s.id, 'B');
  flow.dependencies(agent, {
    target: { id: a.id, kind: 'change' },
    revision: 1,
    dependencies: [
      {
        source: { id: b.id, kind: 'change' },
        stage: 'start',
        condition: 'output_available',
        reason: 'Start against B output',
      },
    ],
  });
  flow.dependencies(agent, {
    target: { id: b.id, kind: 'change' },
    revision: 1,
    dependencies: [
      {
        source: { id: a.id, kind: 'change' },
        stage: 'deliver',
        condition: 'output_available',
        reason: 'Deliver after A output',
      },
    ],
  });
  streams.updateChange(agent, b.id, { revision: 2, progress: 'working' });
  const map = flow.map(agent, s.id);
  expect(map.nodes.find((n) => n.id === b.id)?.status).toBe('In progress');
  const layout = orderMapNodes(map.nodes, map.edges);
  expect(layout.stagedLoop).toBe(true);
  expect(layout.nodes).toHaveLength(map.nodes.length);
  expect(orderMapNodes(map.nodes, map.edges).nodes.map((n) => n.id)).toEqual(
    layout.nodes.map((n) => n.id),
  );
});
it('bounds dense work and linked references without dangling edges or changing stored work', () => {
  const s = stream('Large stream');
  for (let i = 0; i < 170; i++) change(s.id, 'Change ' + i);
  const before = store.raw.prepare('SELECT count(*) n FROM events').get();
  const map = flow.map(agent, s.id);
  expect(map.complete).toBe(false);
  expect(map.nodes.length).toBeLessThanOrEqual(200);
  expect(map.omittedNodes).toBeGreaterThan(0);
  expect(store.raw.prepare('SELECT count(*) n FROM events').get()).toEqual(before);
  const other = stream('Other'),
    target = change(other.id, 'Target');
  const refs = Array.from({ length: 45 }, (_, i) => change(s.id, 'Reference ' + i));
  flow.dependencies(agent, {
    target: { id: target.id, kind: 'change' },
    revision: 1,
    dependencies: refs.map((r) => ({
      source: { id: r.id, kind: 'change' as const },
      stage: 'start' as const,
      condition: 'output_available' as const,
      reason: 'Required reference',
    })),
  });
  const linked = flow.map(agent, other.id),
    ids = new Set(linked.nodes.map((n) => n.id));
  expect(linked.complete).toBe(false);
  expect(linked.omittedEdges).toBe(5);
  expect(linked.nodes.filter((n) => n.reference)).toHaveLength(40);
  expect(linked.edges.every((e) => ids.has(e.sourceId) && ids.has(e.targetId))).toBe(true);
});

it('keeps explicit questions visible after an answer and discloses omitted feeding streams', () => {
  const root = stream('Prepare daily use');
  const body = 'Choose the default repository. ' + 'Supporting context. '.repeat(50);
  const q = streams.recordContext(agent, root.id, {
    kind: 'question',
    body,
    needsHuman: true,
    conversationUrl: 'https://claude.ai/chat/existing',
    idempotencyKey: randomUUID(),
  });
  streams.recordContext(agent, root.id, {
    kind: 'finding',
    body: 'Routine agent detail',
    idempotencyKey: randomUUID(),
  });
  let map = flow.map(agent, root.id);
  expect(map.nodes.filter((n) => n.kind === 'question')).toHaveLength(1);
  expect(map.nodes.find((n) => n.id === q.id)).toMatchObject({
    status: 'Needs you',
    quiet: false,
    conversationUrl: q.conversationUrl,
  });
  expect(map.nodes.find((n) => n.id === q.id)!.purpose.length).toBeLessThanOrEqual(600);
  expect(streams.entry(agent, q.id).body).toBe(body.trim());
  const owner: Actor = { id: 'owner', ownerId: 'owner', scope: 'owner' };
  flow.answer(owner, q.id, {
    revision: q.revision,
    answer: 'Use this repository.',
    idempotencyKey: randomUUID(),
  });
  map = flow.map(agent, root.id);
  expect(map.nodes.find((n) => n.id === q.id)).toMatchObject({
    status: 'Answered',
    quiet: true,
    update: 'Use this repository.',
  });
  for (let i = 0; i < 41; i++) stream('Feeding stream ' + i, root.id);
  map = flow.map(agent, root.id);
  expect(map.groups).toHaveLength(40);
  expect(map.moreStreams).toBe(true);
  expect(map.complete).toBe(false);
});
