import { expect, it } from 'vitest';
import { sessionConversation } from '../src/shared/session-navigation.js';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
it('offers only validated native Codex links and falls back for other client identities', () => {
  const id = randomUUID();
  expect(sessionConversation('codex', id)).toBe(`codex://threads/${id}`);
  for (const value of [
    'anything',
    '../../new',
    '123?command=run',
    'javascript:alert(1)',
    `${id}/extra`,
  ])
    expect(sessionConversation('codex', value)).toBeNull();
  expect(sessionConversation('claude-code', id)).toBeNull();
});
it('requires authentication and an explicit bounded selection for the session API', async () => {
  const store = openStore(':memory:');
  const { app, auth, streams, sync } = await createApp(store, { origin: 'http://127.0.0.1:4310' });
  try {
    const a = auth.register('agent', 'First'),
      b = auth.register('agent', 'Second');
    const actor = auth.actor(a.secret, 'bearer');
    const s = streams.submit(actor, {
      title: 'Selected stream',
      outcome: 'Sessions',
      idempotencyKey: randomUUID(),
    });
    sync.event(actor, {
      client: 'codex',
      sessionId: randomUUID(),
      project: '/project',
      streamId: s.id,
      event: 'start',
      eventId: randomUUID(),
      occurredAt: Date.now(),
      turnId: 'one',
    });
    const headers = { host: '127.0.0.1:4310', authorization: `Bearer ${a.secret}` };
    expect(
      (await app.inject({ url: `/api/sessions?streamId=${s.id}`, headers: { host: headers.host } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ url: '/api/sessions', headers })).statusCode).toBe(400);
    expect(
      (await app.inject({ url: `/api/sessions?streamId=${s.id}&limit=31`, headers })).statusCode,
    ).toBe(400);
    const res = await app.inject({ url: `/api/sessions?streamId=${s.id}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, nextOffset: null });
    expect(res.body).not.toMatch(/credentialId|tokenHash/);
    expect(
      (
        await app.inject({
          url: `/api/sessions?streamId=${s.id}`,
          headers: { ...headers, authorization: `Bearer ${b.secret}` },
        })
      ).json().total,
    ).toBe(0);
  } finally {
    await app.close();
    store.close();
  }
});
