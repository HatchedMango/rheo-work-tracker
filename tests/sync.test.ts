import { afterEach, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { OversightService } from '../src/services/oversight.js';
import { SyncService } from '../src/services/sync.js';
import { Auth } from '../src/services/auth.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
import type { syncEventSchema } from '../src/shared/sync.js';
import type { z } from 'zod';
let store: ReturnType<typeof openStore>,
  work: WorkService,
  streams: StreamService,
  flow: OversightService,
  sync: SyncService,
  agent: Actor,
  t = 100000;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
beforeEach(() => {
  store = openStore(':memory:');
  work = new WorkService(store, () => ++t);
  streams = new StreamService(work);
  flow = new OversightService(streams);
  sync = new SyncService(flow);
  const auth = new Auth(store, () => t);
  agent = auth.actor(auth.register('agent', 'Agent').secret, 'bearer');
});
afterEach(() => store.close());
const stream = () =>
  streams.submit(agent, { title: 'Stream', outcome: 'Working sync', idempotencyKey: randomUUID() });
function event(
  streamId: string,
  event: z.input<typeof syncEventSchema>['event'] = 'start',
  more: Partial<z.input<typeof syncEventSchema>> = {},
) {
  return {
    eventId: randomUUID(),
    streamId,
    sessionId: 'native-session',
    client: 'codex' as const,
    project: '/project',
    turnId: 'turn-one',
    event,
    occurredAt: ++t,
    ...more,
  };
}
it('distinguishes context retrieval, checkpoints, missed updates and duplicate receipt replay', () => {
  const s = stream();
  const start = event(s.id);
  const first = sync.event(agent, start);
  expect(first.session).toMatchObject({ needsCheckpoint: 1, lastCheckpointAt: null });
  expect(first.context).toBeDefined();
  const checkpoint = event(s.id, 'checkpoint', {
    checkpoint: { summary: 'Plan prepared; no implementation started' },
  });
  const saved = sync.event(agent, checkpoint);
  expect(saved.session.state).toBe('recorded');
  expect(sync.event(agent, checkpoint)).toEqual(saved);
  expect(() => sync.event(agent, { ...checkpoint, checkpoint: { summary: 'Different' } })).toThrow(
    'different content',
  );
  sync.event(agent, event(s.id, 'stop'));
  expect(sync.list(owner).items[0].needsCheckpoint).toBe(0);
  sync.event(agent, event(s.id, 'prompt', { turnId: 'turn-two' }));
  sync.event(agent, event(s.id, 'stop', { turnId: 'turn-two' }));
  expect(sync.list(owner).items[0]).toMatchObject({
    state: 'needs_update',
    checkpointTurnId: 'turn-one',
  });
  expect(() =>
    sync.event(
      agent,
      event(s.id, 'checkpoint', { turnId: 'turn-one', checkpoint: { summary: 'Stale' } }),
    ),
  ).toThrow('another turn');
});
it('atomically records exact answers, action completion and progress with agent provenance', () => {
  let s = stream();
  s = streams.action(owner, s.id, { revision: s.revision, action: 'accept' });
  const w = work.create(
    agent,
    createSchema.parse({
      title: 'Change',
      objective: 'Implement',
      streamId: s.id,
      scopeIntent: 'within_scope',
    }),
  );
  const q = streams.recordContext(agent, s.id, {
    kind: 'question',
    body: 'Which API?',
    needsHuman: true,
    idempotencyKey: randomUUID(),
  });
  const action = flow.createAction(agent, {
    streamId: s.id,
    title: 'Ask Bob',
    doneWhen: 'Access ready',
    idempotencyKey: randomUUID(),
  });
  flow.dependencies(agent, {
    target: { kind: 'change', id: w.id },
    revision: w.tracking.revision,
    dependencies: [
      {
        source: { kind: 'human_action', id: action.id },
        stage: 'start',
        condition: 'done',
        reason: 'Need access',
      },
    ],
  });
  const current = work.get(agent, w.id);
  sync.event(agent, event(s.id, 'start', { changeId: w.id }));
  const cp = event(s.id, 'checkpoint', {
    changeId: w.id,
    checkpoint: {
      summary: 'Human answered in chat',
      feedback: [
        { kind: 'question', id: q.id, revision: q.revision, answer: 'Use sandbox' },
        {
          kind: 'human_action',
          id: action.id,
          revision: action.revision,
          state: 'done',
          response: 'Bob granted access',
        },
      ],
      change: {
        revision: current.tracking.revision,
        progress: 'working',
        note: 'Starting the sandbox integration',
      },
    },
  });
  expect(() => sync.event(agent, cp)).toThrow('not enabled');
  expect(streams.entry(agent, q.id).state).toBe('open');
  sync.permission(owner, agent.credentialId!, true);
  sync.event(agent, cp);
  expect(streams.entry(agent, q.id)).toMatchObject({
    answer: 'Use sandbox',
    answeredBy: agent.id,
    state: 'resolved',
  });
  expect(JSON.parse(streams.entry(agent, q.id).answerSource!)).toMatchObject({
    client: 'codex',
    sessionId: 'native-session',
  });
  expect(flow.action(agent, action.id)).toMatchObject({ state: 'done', respondedBy: agent.id });
  expect(work.get(agent, w.id).tracking.prerequisites[0]).toMatchObject({
    satisfied: true,
    evidence: 'reported',
  });
  expect(flow.attention(owner).total).toBe(0);
  expect(work.status(owner).inboxCount).toBe(0);
  sync.permission(owner, agent.credentialId!, false);
  expect(() =>
    sync.event(
      agent,
      event(s.id, 'checkpoint', {
        changeId: w.id,
        checkpoint: {
          summary: 'Try again',
          feedback: [
            { kind: 'human_action', id: action.id, revision: 2, state: 'done', response: 'Again' },
          ],
        },
      }),
    ),
  ).toThrow('not enabled');
});
it('rolls back earlier responses when a later response conflicts and rejects cross-selection feedback', () => {
  const s = stream(),
    other = stream();
  sync.event(agent, event(s.id));
  sync.permission(owner, agent.credentialId!, true);
  const q = streams.recordContext(agent, s.id, {
    kind: 'question',
    body: 'Answer?',
    idempotencyKey: randomUUID(),
  });
  const h = flow.createAction(agent, {
    streamId: s.id,
    title: 'Access',
    doneWhen: 'Ready',
    idempotencyKey: randomUUID(),
  });
  expect(() =>
    sync.event(
      agent,
      event(s.id, 'checkpoint', {
        checkpoint: {
          summary: 'Conflicting',
          feedback: [
            { kind: 'question', id: q.id, revision: 1, answer: 'Yes' },
            { kind: 'human_action', id: h.id, revision: 999, state: 'done', response: 'Done' },
          ],
        },
      }),
    ),
  ).toThrow('changed');
  expect(streams.entry(agent, q.id).state).toBe('open');
  expect(sync.list(owner).items[0].lastCheckpointAt).toBeNull();
  expect(() =>
    sync.event(
      agent,
      event(s.id, 'checkpoint', {
        checkpoint: {
          summary: 'Wrong stream',
          feedback: [
            {
              kind: 'stream_decision',
              id: other.id,
              revision: other.revision,
              action: 'accept',
              response: 'Go',
            },
          ],
        },
      }),
    ),
  ).toThrow('outside');
  expect(() => sync.event(agent, event(s.id, 'start', { project: '/another' }))).toThrow(
    'selection changed',
  );
});
it('records relayed decisions without owner impersonation or final completion and keeps old events from reverting freshness', () => {
  const s = stream(),
    start = event(s.id);
  sync.event(agent, start);
  sync.permission(owner, agent.credentialId!, true);
  sync.event(
    agent,
    event(s.id, 'checkpoint', {
      checkpoint: {
        summary: 'Direction approved in chat',
        feedback: [
          {
            kind: 'stream_decision',
            id: s.id,
            revision: s.revision,
            action: 'accept',
            response: 'Start',
          },
        ],
      },
    }),
  );
  const approved = streams.get(agent, s.id);
  expect(approved.state).toBe('active');
  expect(
    store.raw.prepare('SELECT actorId FROM stream_approvals WHERE id=?').get(approved.approvalId),
  ).toEqual({ actorId: agent.id });
  sync.event(agent, {
    ...event(s.id, 'prompt'),
    occurredAt: start.occurredAt - 1,
    turnId: 'older',
  });
  expect(sync.list(owner).items[0]).toMatchObject({ turnId: 'turn-one', needsCheckpoint: 0 });
  const w = work.create(
    agent,
    createSchema.parse({ title: 'Legacy request', objective: 'Do work', streamId: s.id }),
  );
  sync.event(
    agent,
    event(s.id, 'checkpoint', {
      checkpoint: {
        summary: 'Earlier implementation permission recorded',
        feedback: [
          {
            kind: 'work_decision',
            id: w.id,
            revision: w.revision,
            action: 'accept',
            response: 'User authorized implementation',
          },
        ],
      },
    }),
  );
  expect(work.get(agent, w.id)).toMatchObject({
    lifecycle: 'open',
    ownerId: 'owner',
    assignment: { state: 'accepted' },
  });
  expect(work.get(agent, w.id).events[0]).toMatchObject({
    actorId: agent.id,
    type: 'relayed_accept',
  });
});
it('does not expose other agents sessions or allow permission grants and reports queue freshness monotonically', () => {
  const s = stream();
  sync.event(agent, event(s.id));
  const auth = new Auth(store, () => t),
    second = auth.actor(auth.register('agent', 'Second').secret, 'bearer');
  expect(sync.list(second).items).toHaveLength(0);
  expect(() => sync.permission(agent, agent.credentialId!, true)).toThrow('Only the owner');
  sync.queue(agent, { sessionId: 'native-session', pendingWrites: 2, observedAt: 50 });
  sync.queue(agent, { sessionId: 'native-session', pendingWrites: 0, observedAt: 40 });
  expect(sync.list(owner).items[0].pendingWrites).toBe(2);
});
it('retargets a native chat only through an explicit fresh context load and rejects delayed writes for the old selection', () => {
  const first = stream(),
    second = stream();
  sync.event(agent, event(first.id));
  sync.event(
    agent,
    event(first.id, 'checkpoint', { checkpoint: { summary: 'First plan recorded' } }),
  );
  expect(() =>
    sync.event(
      agent,
      event(second.id, 'checkpoint', { checkpoint: { summary: 'Wrong selection' } }),
    ),
  ).toThrow('Explicitly select');
  sync.event(agent, event(second.id, 'start'));
  expect(sync.list(owner).items[0]).toMatchObject({
    streamId: second.id,
    lastCheckpointAt: null,
    needsCheckpoint: 1,
  });
  expect(() =>
    sync.event(
      agent,
      event(first.id, 'checkpoint', { checkpoint: { summary: 'Delayed first plan' } }),
    ),
  ).toThrow('Explicitly select');
});
it('keeps compact refreshes bounded and explicit about omitted context while legacy and recovery calls stay full', () => {
  let s = stream();
  s = streams.update(agent, s.id, {
    revision: s.revision,
    context: 'Full recovery approach and failed attempts.',
    scope: { title: '😀'.repeat(80), outcome: '😀'.repeat(1800), constraints: '' },
  });
  for (let i = 0; i < 6; i++)
    streams.recordContext(agent, s.id, {
      kind: 'question',
      body: `Question ${i}: ${'😀'.repeat(700)}`,
      needsHuman: true,
      idempotencyKey: randomUUID(),
    });
  const full = sync.event(agent, event(s.id));
  expect(full.context).toHaveProperty('entries');
  const compact = sync.event(
    agent,
    event(s.id, 'prompt', { contextMode: 'compact', turnId: 'next' }),
  );
  expect(compact.context).toMatchObject({ mode: 'compact', complete: false, stream: { id: s.id } });
  expect(Buffer.byteLength(JSON.stringify(compact.context))).toBeLessThanOrEqual(8192);
  expect(JSON.stringify(compact.context)).toContain('not a complete dependency review');
  const recovered = sync.event(
    agent,
    event(s.id, 'compact', { contextMode: 'compact', turnId: 'next' }),
  );
  expect(recovered.context).toHaveProperty('entries');
  expect(JSON.stringify(recovered.context)).toContain('Full recovery approach');
});
