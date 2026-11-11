import { it, expect } from 'vitest';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
it('enforces new HTTP operation scopes and keeps lifecycle decisions out of agent tracking', async () => {
  const store = openStore(':memory:'),
    { app, auth } = await createApp(store, { origin: 'http://127.0.0.1:4310' }),
    host = '127.0.0.1:4310';
  try {
    const token = auth.register('agent', 'API source').secret,
      worker = auth.register('worker', 'Not a collaboration agent').secret;
    const agent = { host, authorization: `Bearer ${token}` };
    const request = (
      url: string,
      payload: Record<string, unknown>,
      headers: Record<string, string> = agent,
    ) => app.inject({ method: 'POST', url, headers, payload });
    const s = (
      await request('/api/streams', {
        title: 'API stream',
        outcome: 'Preserve authority',
        idempotencyKey: 'api',
      })
    ).json();
    expect(
      (await request(`/api/streams/${s.id}/actions`, { action: 'accept', revision: 1 })).statusCode,
    ).toBe(403);
    expect(
      (
        await request(`/api/streams/${s.id}/update`, {
          revision: 1,
          context: 'updated',
          state: 'active',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          '/api/streams',
          { title: 'No', outcome: 'No', idempotencyKey: 'worker' },
          { host, authorization: `Bearer ${worker}` },
        )
      ).statusCode,
    ).toBe(403);
    const session = await request('/api/session', {}, { host, origin: 'http://127.0.0.1:4310' }),
      owner = {
        host,
        origin: 'http://127.0.0.1:4310',
        cookie: session.headers['set-cookie']!.toString().split(';')[0],
      };
    expect(
      (await request(`/api/streams/${s.id}/actions`, { action: 'accept', revision: 1 }, owner))
        .statusCode,
    ).toBe(200);
    const w = (
      await request('/api/work', {
        title: 'Output',
        objective: 'Reviewable change',
        streamId: s.id,
      })
    ).json();
    expect(w.assignment.state).toBe('proposed');
    expect(
      (await request(`/api/work/${w.id}/tracking`, { revision: 1, lifecycle: 'completed' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await request(`/api/work/${w.id}/actions`, { action: 'complete', revision: 1 })).statusCode,
    ).toBe(403);
    const context = await app.inject({ url: `/api/context?streamId=${s.id}`, headers: agent });
    expect(context.statusCode).toBe(200);
    expect(context.json().changes.items[0].id).toBe(w.id);
    auth.revoke(auth.actor(token, 'bearer').credentialId!);
    expect(
      (await app.inject({ url: `/api/context?streamId=${s.id}`, headers: agent })).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
    store.close();
  }
});

it('returns bounded HTTP context for escaped text and rejects assessments missing their read fingerprint', async () => {
  const store = openStore(':memory:'),
    { app, auth } = await createApp(store, { origin: 'http://127.0.0.1:4310' }),
    host = '127.0.0.1:4310';
  try {
    const credential = auth.register('agent', 'HTTP fixture'),
      headers = { host, authorization: `Bearer ${credential.secret}` };
    const post = (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url, headers, payload });
    const escaped = '\u0000'.repeat(3000);
    const submitted = await post('/api/streams', {
      title: 'Escaped HTTP data',
      outcome: escaped,
      context: escaped,
      constraints: escaped,
      idempotencyKey: 'escaped',
    });
    expect(submitted.statusCode).toBe(201);
    const s = submitted.json();
    const created = await post('/api/work', {
      title: 'Bounded result',
      objective: escaped,
      streamId: s.id,
    });
    expect(created.statusCode).toBe(201);
    const w = created.json();
    const tracked = await post(`/api/work/${w.id}/tracking`, {
      revision: 1,
      progressNote: escaped,
      expectedOutput: escaped,
      baseRef: '\u0000'.repeat(500),
      areas: Array.from({ length: 5 }, () => '\u0000'.repeat(200)),
      resources: Array.from({ length: 5 }, () => '\u0000'.repeat(200)),
    });
    expect(tracked.statusCode).toBe(200);
    const context = await app.inject({ url: `/api/context?changeId=${w.id}`, headers });
    expect(context.statusCode).toBe(200);
    expect(Buffer.byteLength(context.body)).toBeLessThanOrEqual(48000);
    expect(context.json().changes.items[0].id).toBe(w.id);
    const missing = await post(`/api/work/${w.id}/tracking`, {
      revision: tracked.json().tracking.revision,
      assessDependencies: true,
    });
    expect(missing.statusCode).toBe(409);
    const pin = context.json().changes.items[0].tracking;
    expect(
      (
        await post(`/api/work/${w.id}/tracking`, {
          revision: pin.revision,
          assessDependencies: true,
          assessmentFingerprint: pin.assessmentFingerprint,
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    store.close();
  }
});

it('uses one attention count for mixed requests and enforces owner responses and coverage at HTTP boundaries', async () => {
  const store = openStore(':memory:'),
    { app, auth } = await createApp(store, { origin: 'http://127.0.0.1:4310' }),
    host = '127.0.0.1:4310';
  try {
    const token = auth.register('agent', 'Flow fixture').secret,
      agent = { host, authorization: `Bearer ${token}` };
    const post = (
      url: string,
      payload: Record<string, unknown>,
      headers: Record<string, string> = agent,
    ) => app.inject({ method: 'POST', url, headers, payload });
    const session = await post('/api/session', {}, { host, origin: 'http://127.0.0.1:4310' }),
      owner = {
        host,
        origin: 'http://127.0.0.1:4310',
        cookie: session.headers['set-cookie']!.toString().split(';')[0],
      };
    const s = (
      await post('/api/streams', {
        title: 'Flow',
        outcome: 'A usable outcome',
        idempotencyKey: 'flow',
      })
    ).json();
    await post(`/api/streams/${s.id}/actions`, { revision: 1, action: 'accept' }, owner);
    const w = (
      await post('/api/work', {
        title: 'Routine',
        objective: 'Result',
        streamId: s.id,
        scopeIntent: 'within_scope',
        approvalId: 'forged',
      })
    ).json();
    expect(w.assignment.state).toBe('covered');
    expect(w.tracking.coverage.approvalId).not.toBe('forged');
    const h = (
      await post('/api/human-actions', {
        streamId: s.id,
        title: 'Get access',
        doneWhen: 'Access is available',
        idempotencyKey: 'h',
      })
    ).json();
    expect(
      (
        await post('/api/dependencies', {
          target: { id: w.id, kind: 'change' },
          revision: 1,
          dependencies: [
            {
              source: { id: h.id, kind: 'human_action' },
              stage: 'start',
              condition: 'done',
              reason: 'Need access',
            },
          ],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(`/api/human-actions/${h.id}/respond`, {
          revision: 1,
          state: 'done',
          response: 'Pretend',
          idempotencyKey: 'bad',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await post(`/api/streams/${s.id}/coverage`, { streamRevision: 2, changeIds: [w.id] }))
        .statusCode,
    ).toBe(403);
    const attention = (await app.inject({ url: '/api/attention?limit=1', headers: agent })).json(),
      status = (await app.inject({ url: '/api/status', headers: agent })).json();
    expect(status.inboxCount).toBe(attention.total);
    expect(attention.total).toBe(1);
    const body = {
      revision: 1,
      state: 'done',
      response: 'Access is available in the local store',
      idempotencyKey: 'done',
    };
    expect((await post(`/api/human-actions/${h.id}/respond`, body, owner)).statusCode).toBe(200);
    expect((await post(`/api/human-actions/${h.id}/respond`, body, owner)).json().revision).toBe(2);
    expect(
      (
        await post(
          `/api/human-actions/${h.id}/respond`,
          { ...body, idempotencyKey: 'stale' },
          owner,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ url: `/api/context?changeId=${w.id}`, headers: agent })).json().changes
        .items[0].tracking.prerequisites[0].satisfied,
    ).toBe(true);
  } finally {
    await app.close();
    store.close();
  }
});
