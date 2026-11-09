import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
let store: ReturnType<typeof openStore>, ctx: Awaited<ReturnType<typeof createApp>>, now: number;
const host = '127.0.0.1:4310',
  origin = `http://${host}`;
beforeEach(async () => {
  now = 1000000;
  store = openStore(':memory:');
  ctx = await createApp(store, { origin, clock: () => now });
});
afterEach(async () => {
  await ctx.app.close();
  store.close();
});
async function session() {
  const r = await ctx.app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { host, origin },
    payload: {},
  });
  expect(r.statusCode).toBe(200);
  return r.headers['set-cookie']!.toString().split(';')[0];
}
describe('local HTTP boundaries', () => {
  it('isolates data until a local session is established and validates host/origin', async () => {
    expect((await ctx.app.inject({ url: '/api/status', headers: { host } })).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ url: '/api/status', headers: { host: 'evil.example' } })).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          url: '/api/status',
          headers: { host, origin: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('automatically issues a protected session and reuses it without creating credentials', async () => {
    const cookie = await session();
    expect(cookie).toMatch(/^session=/);
    const initialCount = store.raw.prepare('SELECT count(*) AS n FROM credentials').get();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host, origin, cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(store.raw.prepare('SELECT count(*) AS n FROM credentials').get()).toEqual(initialCount);
    expect(
      (await ctx.app.inject({ url: '/api/status', headers: { host, cookie } })).statusCode,
    ).toBe(200);
    const fresh = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host, origin },
      payload: {},
    });
    expect(fresh.headers['set-cookie']).toContain('HttpOnly');
    expect(fresh.headers['set-cookie']).toContain('SameSite=Strict');
  });
  it('renews expired, revoked, and unknown cookies automatically', async () => {
    const expired = ctx.auth.issue('session', 'owner', now - 1);
    const revoked = ctx.auth.issue('session');
    ctx.auth.revoke(revoked.id);
    for (const existing of [expired, revoked]) {
      const cookie = `session=${existing.secret}`;
      expect(
        (await ctx.app.inject({ url: '/api/status', headers: { host, cookie } })).statusCode,
      ).toBe(401);
      const renewed = await ctx.app.inject({
        method: 'POST',
        url: '/api/session',
        headers: { host, origin, cookie },
        payload: {},
      });
      expect(renewed.statusCode).toBe(200);
      expect(renewed.headers['set-cookie']).toContain('session=');
    }
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/session',
          headers: { host, origin, cookie: 'session=unknown' },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
  });
  it('blocks cross-site, untrusted same-site, and malformed session bootstrap requests', async () => {
    for (const headers of [
      { host },
      { host, origin: 'https://evil.example' },
      { host, origin: 'null' },
      { host, origin: 'http://127.0.0.1:9999' },
      { host, origin, 'sec-fetch-site': 'cross-site' },
      { host, 'sec-fetch-site': 'same-site' },
      { host: 'evil.example', origin },
    ]) {
      expect(
        (await ctx.app.inject({ method: 'POST', url: '/api/session', headers, payload: {} }))
          .statusCode,
      ).toBe(403);
    }
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/session',
          headers: { host, origin, 'content-type': 'text/plain' },
          payload: '{}',
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/session',
          headers: { host, origin },
          payload: { actorId: 'other' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await ctx.app.inject({ url: '/api/session', headers: { host } })).statusCode).toBe(404);
    expect(store.raw.prepare('SELECT count(*) AS n FROM credentials').get()).toEqual({ n: 0 });
  });
  it('keeps origin and JSON checks on browser updates', async () => {
    const cookie = await session();
    const source = ctx.auth.register('agent', 'External source');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/work',
      headers: { host, authorization: `Bearer ${source.secret}` },
      payload: { title: 'Incoming request', objective: 'Review this work.' },
    });
    expect(created.statusCode).toBe(201);
    const url = `/api/work/${created.json().id}/updates`;
    for (const headers of [
      { host, cookie },
      { host, cookie, origin: 'https://evil.example' },
      { host, cookie, origin, 'sec-fetch-site': 'cross-site' },
    ]) {
      expect(
        (await ctx.app.inject({ method: 'POST', url, headers, payload: { message: 'Context' } }))
          .statusCode,
      ).toBe(403);
    }
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url,
          headers: { host, origin, cookie, 'content-type': 'text/plain' },
          payload: '{"message":"Context"}',
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url,
          headers: { host, origin, cookie },
          payload: { message: 'Context' },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('requires external credentials to create work even from a valid browser session', async () => {
    const cookie = await session();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/work',
      headers: { host, origin, cookie },
      payload: { title: 'Manual task', objective: 'Not allowed from the UI.' },
    });
    expect(response.statusCode).toBe(403);
    expect(store.raw.prepare('SELECT count(*) AS n FROM work').get()).toEqual({ n: 0 });
  });
  it('always routes external work to Inbox, including legacy backlog requests and retries', async () => {
    const agent = ctx.auth.register('agent', 'External source');
    const headers = { host, authorization: `Bearer ${agent.secret}` };
    const cookie = await session();
    const ids: string[] = [];
    for (const destination of [undefined, 'backlog', 'inbox']) {
      const payload = {
        title: `Intake ${destination ?? 'default'}`,
        objective: 'Needs a user decision.',
        destination,
        idempotencyKey: `intake-${destination ?? 'default'}`,
        ownerId: 'owner',
        assignment: { state: 'accepted' },
        lifecycle: 'completed',
      };
      const response = await ctx.app.inject({ method: 'POST', url: '/api/work', headers, payload });
      expect(response.statusCode).toBe(201);
      const work = response.json();
      ids.push(work.id);
      expect(work.ownerId).toBeNull();
      expect(work.assignment.state).toBe('proposed');
      expect(work.lifecycle).toBe('open');
      expect(work.attention).toHaveLength(1);
      const retry = await ctx.app.inject({
        method: 'POST',
        url: '/api/work',
        headers,
        payload: { ...payload, destination: 'backlog' },
      });
      expect(retry.statusCode).toBe(201);
      expect(retry.json().id).toBe(work.id);
      for (const action of ['accept', 'decline', 'cancel', 'complete']) {
        expect(
          (
            await ctx.app.inject({
              method: 'POST',
              url: `/api/work/${work.id}/actions`,
              headers,
              payload: { action, revision: work.revision },
            })
          ).statusCode,
        ).toBe(403);
      }
    }
    const inbox = await ctx.app.inject({ url: '/api/work?view=inbox', headers: { host, cookie } });
    expect(
      inbox
        .json()
        .items.map((w: { id: string }) => w.id)
        .sort(),
    ).toEqual(ids.sort());
    const accepted = await ctx.app.inject({
      method: 'POST',
      url: `/api/work/${ids[0]}/actions`,
      headers: { host, origin, cookie },
      payload: { action: 'accept', revision: 1 },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().attention).toEqual([]);
  });
  it('removes login/logout endpoints and never elevates bearer credentials during bootstrap', async () => {
    for (const scope of ['agent', 'worker'] as const) {
      const credential = ctx.auth.register(scope, scope);
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/session',
        headers: { host, origin, authorization: `Bearer ${credential.secret}` },
        payload: {},
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    for (const url of ['/api/login', '/api/logout'])
      expect(
        (await ctx.app.inject({ method: 'POST', url, headers: { host, origin }, payload: {} }))
          .statusCode,
      ).toBe(404);
  });
  it('enforces agent and worker credential scopes and revocation', async () => {
    const agent = ctx.auth.register('agent', 'Agent'),
      worker = ctx.auth.register('worker', 'Worker');
    const headers = { host, authorization: `Bearer ${agent.secret}` };
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/work',
      headers,
      payload: { title: 'Follow up', objective: 'Later' },
    });
    expect(created.statusCode).toBe(201);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/work/${created.json().id}/actions`,
          headers,
          payload: { action: 'accept', revision: 1 },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/worker/claim', headers, payload: {} }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          url: '/api/work',
          headers: { host, authorization: `Bearer ${worker.secret}` },
        })
      ).statusCode,
    ).toBe(403);
    ctx.auth.revoke(agent.id);
    expect((await ctx.app.inject({ url: '/api/work', headers })).statusCode).toBe(401);
  });
  it('validates links, bounded pagination, IDs, and request bodies', async () => {
    const cookie = await session(),
      headers = { host, origin, cookie };
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/work',
          headers,
          payload: {
            title: 'X',
            objective: 'Y',
            references: [{ system: 'bad', url: 'javascript:alert(1)' }],
          },
        })
      ).statusCode,
    ).toBe(400);
    expect((await ctx.app.inject({ url: '/api/work?limit=9999', headers })).statusCode).toBe(400);
    expect((await ctx.app.inject({ url: '/api/work/not-an-id', headers })).statusCode).toBe(400);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/work',
          headers,
          payload: { title: '', objective: 'Y' },
        })
      ).statusCode,
    ).toBe(400);
  });
});

it('normal app exposes no execution worker and rejects simulation approval/claims', async () => {
  const cookie = await session();
  const source = ctx.auth.register('agent', 'External source');
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/work',
    headers: { host, authorization: `Bearer ${source.secret}` },
    payload: { title: 'Manual completion', objective: 'Do real work outside this app.' },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().id;
  const accepted = await ctx.app.inject({
    method: 'POST',
    url: `/api/work/${id}/actions`,
    headers: { host, origin, cookie },
    payload: { action: 'accept', revision: 1 },
  });
  expect(accepted.statusCode).toBe(200);
  const attempt = await ctx.app.inject({
    method: 'POST',
    url: `/api/work/${id}/actions`,
    headers: { host, origin, cookie },
    payload: { action: 'run', revision: accepted.json().revision },
  });
  expect(attempt.statusCode).toBe(409);
  expect(attempt.json().message).toBe('No execution worker connected.');
  const worker = ctx.auth.register('worker', 'Old simulation');
  const claim = await ctx.app.inject({
    method: 'POST',
    url: '/api/worker/claim',
    headers: { host, authorization: `Bearer ${worker.secret}` },
    payload: {},
  });
  expect(claim.statusCode).toBe(409);
  const status = await ctx.app.inject({ url: '/api/status', headers: { host, cookie } });
  expect(status.json()).toMatchObject({ adapter: null, executionAvailable: false, workers: [] });
  expect(store.raw.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({ n: 0 });
  const completed = await ctx.app.inject({
    method: 'POST',
    url: `/api/work/${id}/actions`,
    headers: { host, origin, cookie },
    payload: { action: 'complete', revision: accepted.json().revision },
  });
  expect(completed.json().lifecycle).toBe('completed');
});
