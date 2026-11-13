import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { Auth } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { OversightService } from '../src/services/oversight.js';
import { SyncService } from '../src/services/sync.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
import { contextEntrySchema } from '../src/shared/streams.js';
import { humanActionSchema } from '../src/shared/oversight.js';
import { conversationLink } from '../src/shared/conversation.js';
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
it('tracks new and legacy undecided work without approval, retaining claim ownership and lifecycle limits', () => {
  const store = openStore(':memory:');
  try {
    const auth = new Auth(store),
      agent = auth.actor(auth.register('agent', 'Tracker').secret, 'bearer');
    const work = new WorkService(store),
      streams = new StreamService(work),
      flow = new OversightService(streams);
    const s = streams.submit(agent, {
      title: 'Make the app useful',
      outcome: 'Use it daily',
      idempotencyKey: randomUUID(),
    });
    expect(s.state).toBe('active');
    const renamed = streams.update(agent, s.id, {
      revision: s.revision,
      scope: {
        title: 'Make the app ready for daily use',
        outcome: 'Use it every day',
        constraints: 'Local only',
      },
    });
    expect(renamed.title).toBe('Make the app ready for daily use');
    expect(renamed.pendingScope).toBeNull();
    expect(() =>
      streams.update(agent, s.id, {
        revision: s.revision,
        scope: { title: 'Stale goal', outcome: 'Stale' },
      }),
    ).toThrow('revision');
    expect(
      streams
        .events(agent, s.id)
        .items.some((e) => (e as { type: string }).type === 'scope_updated'),
    ).toBe(true);

    const w = work.create(
      agent,
      createSchema.parse({
        title: 'Keep work after restart',
        objective: 'Retain context',
        streamId: s.id,
      }),
    );
    expect(w.assignment?.state).toBe('tracked');
    expect(work.status(owner).inboxCount).toBe(0);
    expect(w.runs).toEqual([]);
    // Historical proposals do not become fake human decisions during the transition.
    store.raw.prepare("UPDATE assignments SET state='proposed' WHERE workId=?").run(w.id);
    store.raw.prepare("UPDATE streams SET state='proposed' WHERE id=?").run(s.id);
    const sessionId = randomUUID(),
      token = randomUUID().replaceAll('-', '');
    const claim = streams.claim(agent, w.id, { revision: 1, sessionId, token });
    expect(claim.claim?.state).toBe('active');
    expect(work.get(owner, w.id).assignment?.state).toBe('proposed');
    expect(store.raw.prepare('SELECT count(*) n FROM stream_approvals').get()).toEqual({ n: 0 });
    expect(flow.attention(owner).items).toEqual([]);
    streams.action(owner, s.id, { revision: renamed.revision, action: 'pause' });
    expect(work.get(agent, w.id).tracking.claim?.state).toBe('revoked');
    expect(() => streams.renew(agent, claim.claim!.id, { sessionId, token })).toThrow();
    expect(work.get(agent, w.id).lifecycle).toBe('open');
  } finally {
    store.close();
  }
});
it('shows only explicit questions/actions and resolves the same request from attributed chat feedback', () => {
  const store = openStore(':memory:');
  try {
    const auth = new Auth(store),
      agent = auth.actor(auth.register('agent', 'Tracker').secret, 'bearer');
    const work = new WorkService(store),
      streams = new StreamService(work),
      flow = new OversightService(streams),
      sync = new SyncService(flow);
    const s = streams.submit(agent, {
      title: 'Connect the service',
      outcome: 'Working access',
      idempotencyKey: randomUUID(),
    });
    const w = work.create(
      agent,
      createSchema.parse({ title: 'Connect API', objective: 'Use access', streamId: s.id }),
    );
    streams.updateChange(agent, w.id, { revision: 1, progress: 'review', reviewRequested: true });
    streams.update(agent, s.id, {
      revision: s.revision,
      proposedScope: { title: 'Legacy scope', outcome: 'Not accepted' },
    });
    streams.recordContext(agent, s.id, {
      kind: 'finding',
      body: 'Routine report',
      idempotencyKey: randomUUID(),
    });
    expect(flow.attention(owner).total).toBe(0);
    const chat = 'codex://threads/' + randomUUID();
    const q = streams.recordContext(agent, s.id, {
      kind: 'question',
      body: 'Which account should receive access?',
      needsHuman: true,
      conversationUrl: chat,
      idempotencyKey: randomUUID(),
    });
    const h = flow.createAction(agent, {
      streamId: s.id,
      title: 'Get API access from Bob',
      doneWhen: 'Access is ready',
      idempotencyKey: randomUUID(),
    });
    expect(
      flow
        .attention(owner)
        .items.map((x) => x.kind)
        .sort(),
    ).toEqual(['action', 'question']);
    expect(flow.attention(owner).items.find((x) => x.entityId === q.id)?.conversationUrl).toBe(
      chat,
    );
    expect(
      flow.attention(owner).items.find((x) => x.entityId === h.id)?.conversationUrl,
    ).toBeNull();
    const sessionId = randomUUID(),
      turnId = randomUUID();
    sync.event(agent, {
      eventId: randomUUID(),
      event: 'prompt',
      occurredAt: Date.now(),
      client: 'codex',
      project: '/fixture',
      sessionId,
      turnId,
      streamId: s.id,
    });
    const checkpoint = {
      eventId: randomUUID(),
      event: 'checkpoint' as const,
      occurredAt: Date.now(),
      client: 'codex' as const,
      project: '/fixture',
      sessionId,
      turnId,
      streamId: s.id,
      checkpoint: {
        summary: 'The user chose the team account',
        feedback: [
          {
            kind: 'question' as const,
            id: q.id,
            revision: q.revision,
            answer: 'Use the team account.',
          },
        ],
      },
    };
    expect(() => sync.event(agent, checkpoint)).toThrow();
    sync.permission(owner, agent.credentialId!, true);
    sync.event(agent, checkpoint);
    expect(flow.attention(owner).items.map((x) => x.entityId)).toEqual([h.id]);
    expect(streams.entry(owner, q.id).answerSource).toContain(sessionId);
    expect(work.get(owner, w.id).lifecycle).toBe('open');
  } finally {
    store.close();
  }
});
it('accepts only passive chat destinations, rejecting commands, credentials, and new-chat links', () => {
  const valid = [
    'https://claude.ai/chat/example',
    'https://chatgpt.com/c/example',
    'codex://threads/' + randomUUID(),
  ];
  const unsafe = [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///tmp/private',
    'codex://new?prompt=run',
    'codex://threads/new',
    'codex://settings',
    'codex://threads/' + randomUUID() + '?prompt=run',
    'https://user:secret@example.com/chat',
    'otherapp://run',
  ];
  for (const url of valid) {
    expect(conversationLink(url)).not.toBeNull();
    expect(
      contextEntrySchema.safeParse({
        kind: 'question',
        body: 'Ask',
        conversationUrl: url,
        idempotencyKey: 'q',
      }).success,
    ).toBe(true);
  }
  for (const url of unsafe) {
    expect(conversationLink(url)).toBeNull();
    expect(
      humanActionSchema.safeParse({
        streamId: randomUUID(),
        title: 'Ask',
        doneWhen: 'Answered',
        conversationUrl: url,
        idempotencyKey: 'h',
      }).success,
    ).toBe(false);
  }
  expect(conversationLink(undefined)).toBeNull();
});
