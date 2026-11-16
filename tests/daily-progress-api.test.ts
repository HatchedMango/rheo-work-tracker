import { it, expect, afterEach } from 'vitest';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
const origin = 'http://127.0.0.1:4310',
  host = '127.0.0.1:4310';
const store = openStore(':memory:');
const ctx = await createApp(store, {
  origin,
  clock: () => Date.parse('2026-11-16T18:00:00Z'),
});
afterEach(async () => {
  await ctx.app.close();
  store.close();
});
it('keeps progress and target writes owner-only, validates zones and preserves local write boundaries', async () => {
  const session = await ctx.app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { host, origin },
    payload: {},
  });
  const cookie = session.headers['set-cookie']!.toString().split(';')[0];
  const token = ctx.auth.register('agent', 'Agent').secret;
  const get = (headers: Record<string, string>) =>
    ctx.app.inject({
      url: '/api/daily-progress?timeZone=America%2FChicago',
      headers: { host, ...headers },
    });
  expect((await get({})).statusCode).toBe(401);
  expect((await get({ authorization: 'Bearer ' + token })).statusCode).toBe(403);
  expect(
    (
      await ctx.app.inject({
        url: '/api/daily-progress?timeZone=not-a-zone',
        headers: { host, cookie },
      })
    ).statusCode,
  ).toBe(400);
  const result = await get({ cookie });
  expect(result.json()).toMatchObject({ count: 0, target: 5, metric: 'changes_done' });
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/daily-progress/target',
        headers: { host, cookie },
        payload: { target: 8, revision: 1 },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/daily-progress/target',
        headers: { host, authorization: 'Bearer ' + token },
        payload: { target: 8, revision: 1 },
      })
    ).statusCode,
  ).toBe(403);
  const saved = await ctx.app.inject({
    method: 'POST',
    url: '/api/daily-progress/target',
    headers: { host, cookie, origin },
    payload: { target: 8, revision: 1 },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toEqual({ target: 8, revision: 2 });
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/daily-progress/target',
        headers: { host, cookie, origin },
        payload: { target: 7, revision: 1 },
      })
    ).statusCode,
  ).toBe(409);
});
