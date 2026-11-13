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
    expect(w.assignment.state).toBe('tracked');
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
    const mapUrl = `/api/streams/${s.id}/map`;
    const map = await app.inject({ url: mapUrl, headers: agent });
    expect(map.statusCode).toBe(200);
    expect(map.json().nodes.some((n: { id: string }) => n.id === w.id)).toBe(true);
    expect((await app.inject({ url: mapUrl, headers: owner })).statusCode).toBe(200);
    expect((await app.inject({ url: mapUrl, headers: { host } })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: mapUrl, headers: { host, authorization: `Bearer ${worker}` } }))
        .statusCode,
    ).toBe(403);
    expect((await app.inject({ url: '/api/streams/invalid/map', headers: agent })).statusCode).toBe(
      400,
    );
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

it('enforces assessment scopes, strict report schemas and managed implementation claims over HTTP', async () => {
  const store = openStore(':memory:'),
    { app, auth } = await createApp(store, { origin: 'http://127.0.0.1:4310' }),
    host = '127.0.0.1:4310';
  try {
    const token = auth.register('agent', 'Assessment API').secret,
      worker = auth.register('worker', 'Worker').secret,
      headers = { host, authorization: `Bearer ${token}` };
    const post = (url: string, payload: unknown, h = headers) =>
      app.inject({ method: 'POST', url, headers: h, payload: payload as Record<string, unknown> });
    const w = (
      await post('/api/work', { title: 'Assess this change', objective: 'Produce a useful output' })
    ).json();
    const target = { id: w.id, kind: 'change' };
    expect(
      (
        await post(
          '/api/dependencies/review',
          { target },
          { host, authorization: `Bearer ${worker}` },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await post('/api/dependencies/review', { target }, { host, authorization: '' })).statusCode,
    ).toBe(403);
    const read = await post('/api/dependencies/review', { target, limit: 100 });
    expect(read.statusCode).toBe(200);
    const r = read.json();
    const p = {
      target,
      revision: r.revision,
      scopeStreamId: r.scopeStreamId,
      scopeFingerprint: r.scopeFingerprint,
      planFingerprint: r.planFingerprint,
      reviewedIds: r.items.map((i: { id: string }) => i.id),
      coverage: 'complete',
      start: { result: 'none', reason: 'Existing code is sufficient.' },
      deliver: { result: 'none', reason: 'No prerequisite outputs are required.' },
      idempotencyKey: 'report',
    };
    expect(
      (await post('/api/dependencies/assess', { ...p, start: { result: 'none' } })).statusCode,
    ).toBe(400);
    expect((await post('/api/dependencies/assess', { ...p, actorName: 'Forged' })).statusCode).toBe(
      400,
    );
    const saved = await post('/api/dependencies/assess', p);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().actorName).toBe('Assessment API');
    expect((await post('/api/dependencies/assess', p)).json().id).toBe(saved.json().id);
    const detail = await app.inject({
      url: `/api/dependency-assessment?id=${w.id}&kind=change`,
      headers,
    });
    expect(detail.json().state).toBe('current');
    const claim = await post(`/api/work/${w.id}/claims`, {
      revision: saved.json().revision,
      sessionId: crypto.randomUUID(),
      token: crypto.randomUUID().replaceAll('-', ''),
      purpose: 'implementation',
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().claim.purpose).toBe('implementation');
    expect(
      (await post('/api/dependencies/assess', { ...p, target: { id: w.id, kind: 'human_action' } }))
        .statusCode,
    ).toBe(400);
  } finally {
    await app.close();
    store.close();
  }
});
