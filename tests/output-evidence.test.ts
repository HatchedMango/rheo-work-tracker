import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
import { createSchema } from '../src/shared/contracts.js';
let dir: string, store: ReturnType<typeof openStore>, ctx: Awaited<ReturnType<typeof createApp>>;
let agent: ReturnType<typeof ctx.auth.actor>,
  headers: { host: string; authorization: string },
  owner: { host: string; origin: string; cookie: string };
const origin = 'http://127.0.0.1:4310';
const gitlab = 'https://gitlab.company.example';
const token = 'synthetic-readonly-test-token';
const commit = 'a'.repeat(40);
beforeEach(async () => {
  vi.stubEnv('RHEO_GITLAB_CONFIG', '');
  dir = mkdtempSync(join(tmpdir(), 'rheo-output-evidence-'));
  store = openStore(':memory:');
  ctx = await createApp(store, {
    origin,
    integrationDir: join(dir, 'integrations'),
    gitlabKeychain: null,
  });
  const c = ctx.auth.register('agent', 'Evidence fixture');
  agent = ctx.auth.actor(c.secret, 'bearer');
  headers = { host: '127.0.0.1:4310', authorization: `Bearer ${c.secret}` };
  const session = await ctx.app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { host: headers.host, origin },
    payload: {},
  });
  owner = {
    host: headers.host,
    origin,
    cookie: session.headers['set-cookie']!.toString().split(';')[0],
  };
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await ctx.app.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
async function configure() {
  const r = await ctx.app.inject({
    method: 'POST',
    url: '/api/integrations/gitlab',
    headers: owner,
    payload: { origin: gitlab, token },
  });
  expect(r.statusCode).toBe(200);
  expect(r.body).not.toContain(token);
}
function output(url = `${gitlab}/team/subgroup/project/-/merge_requests/12`) {
  const stream = ctx.streams.submit(agent, {
    title: 'Goal',
    outcome: 'Ship a change',
    idempotencyKey: randomUUID(),
  });
  const work = ctx.service.create(
    agent,
    createSchema.parse({ title: 'Change', objective: 'Useful output', streamId: stream.id }),
  );
  const report = ctx.streams.recordOutput(agent, work.id, {
    kind: 'mr',
    label: 'Implementation MR',
    url,
    codeRevision: commit,
    state: 'available',
    idempotencyKey: randomUUID(),
  });
  return { work, report };
}
function observe(workId: string, outputId: string, revision = 1) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/work/${workId}/outputs/${outputId}/observe`,
    headers,
    payload: { revision },
  });
}
function response(url = `${gitlab}/team/subgroup/project/-/merge_requests/12`, revision = commit) {
  return Response.json({
    web_url: url,
    state: 'merged',
    sha: revision,
    head_pipeline: { sha: revision, status: 'success' },
  });
}
it('stores read access only for the owner and never returns credentials', async () => {
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/integrations/gitlab',
        headers,
        payload: { origin: gitlab, token },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/integrations/gitlab',
        headers: { ...owner, origin: 'https://evil.example' },
        payload: { origin: gitlab, token },
      })
    ).statusCode,
  ).toBe(403);
  await configure();
  const config = JSON.parse(readFileSync(join(dir, 'integrations/gitlab.json'), 'utf8'));
  expect(statSync(config.tokenFile).mode & 0o777).toBe(0o600);
  expect(readFileSync(config.tokenFile, 'utf8')).toBe(token);
  const status = await ctx.app.inject({ url: '/api/integrations/gitlab', headers });
  expect(status.body).not.toContain(token);
  expect(status.body).not.toContain(config.tokenFile);
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/integrations/gitlab/disconnect',
        headers: owner,
        payload: {},
      })
    ).json().configured,
  ).toBe(false);
  expect(() => readFileSync(config.tokenFile)).toThrow();
});
it('reads only the configured host and keeps observations separate from reports, gates and daily credit', async () => {
  await configure();
  const { work, report } = output();
  const fetcher = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetcher);
  const before = ctx.service.get(agent, work.id);
  const checked = await observe(work.id, report.id);
  expect(checked.statusCode).toBe(200);
  expect(checked.json()).toMatchObject({
    status: 'observed',
    mrState: 'merged',
    pipelineStatus: 'success',
    applicable: true,
    outputRevision: 1,
    codeRevision: commit,
  });
  expect(fetcher).toHaveBeenCalledWith(
    `${gitlab}/api/v4/projects/team%2Fsubgroup%2Fproject/merge_requests/12`,
    expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      headers: expect.objectContaining({ 'PRIVATE-TOKEN': token }),
    }),
  );
  expect(ctx.service.get(agent, work.id).tracking).toEqual(before.tracking);
  expect(store.raw.prepare('SELECT count(*) n FROM change_completions').get()).toEqual({ n: 0 });
  expect(checked.body).not.toContain(token);
});
it('does not send access to another host or treat redirected/failed responses as confirmed', async () => {
  await configure();
  const wrong = output('https://other.example/team/project/-/merge_requests/12');
  const fetcher = vi.fn(
    async () => new Response('', { status: 302, headers: { location: 'https://other.example' } }),
  );
  vi.stubGlobal('fetch', fetcher);
  expect((await observe(wrong.work.id, wrong.report.id)).statusCode).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const { work, report } = output();
  expect((await observe(work.id, report.id)).json()).toMatchObject({
    status: 'unavailable',
    mrState: null,
    pipelineStatus: null,
  });
  expect(ctx.streams.outputs(agent, work.id).items[0].state).toBe('available');
});
it('fences output edits during the network request and labels older/different revisions', async () => {
  await configure();
  const { work, report } = output();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      ctx.streams.recordOutput(agent, work.id, {
        revision: report.revision,
        kind: 'mr',
        label: report.label,
        url: report.url,
        codeRevision: 'b'.repeat(40),
        state: 'available',
        idempotencyKey: randomUUID(),
      });
      return response();
    }),
  );
  expect((await observe(work.id, report.id)).statusCode).toBe(409);
  expect(store.raw.prepare('SELECT count(*) n FROM output_observations').get()).toEqual({ n: 0 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  );
  expect((await observe(work.id, report.id, 2)).json().applicable).toBe(false);
  expect(ctx.service.get(agent, work.id).tracking.progress).not.toBe('delivered');
});
it('retains failed and stale observations as history without changing the work graph', async () => {
  await configure();
  const { work, report } = output();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  );
  await observe(work.id, report.id);
  ctx.streams.recordOutput(agent, work.id, {
    revision: 1,
    kind: 'mr',
    label: report.label,
    url: report.url,
    codeRevision: commit,
    state: 'available',
    idempotencyKey: randomUUID(),
  });
  const prior = await ctx.app.inject({ url: `/api/work/${work.id}/output-evidence`, headers });
  expect(prior.json().outputs[0].observation.applicable).toBe(false);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error(token);
    }),
  );
  const failed = await observe(work.id, report.id, 2);
  expect(failed.json()).toMatchObject({ status: 'unavailable', mrState: null });
  expect(failed.body).not.toContain(token);
  expect(store.raw.prepare('SELECT count(*) n FROM output_observations').get()).toEqual({ n: 2 });
});
it('discards an in-flight check after access removal or agent revocation', async () => {
  await configure();
  const first = output();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/integrations/gitlab/disconnect',
        headers: owner,
        payload: {},
      });
      return response();
    }),
  );
  expect((await observe(first.work.id, first.report.id)).statusCode).toBe(409);
  expect(store.raw.prepare('SELECT count(*) n FROM output_observations').get()).toEqual({ n: 0 });
  await configure();
  const second = output();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      ctx.auth.revoke(agent.credentialId!);
      return response();
    }),
  );
  expect((await observe(second.work.id, second.report.id)).statusCode).toBe(403);
  expect(store.raw.prepare('SELECT count(*) n FROM output_observations').get()).toEqual({ n: 0 });
});

it('records standard readiness fields conservatively without treating a pending mergeability check as clear', async () => {
  await configure();
  const { work, report } = output();
  const before = ctx.service.get(agent, work.id).tracking;
  for (const [state, expected] of [
    [
      { detailed_merge_status: 'checking', has_conflicts: false },
      { mergeStatus: 'checking', hasConflicts: null, discussionsResolved: null },
    ],
    [
      {
        detailed_merge_status: 'conflict',
        has_conflicts: true,
        blocking_discussions_resolved: false,
        draft: true,
      },
      { mergeStatus: 'conflict', hasConflicts: true, discussionsResolved: false, draft: true },
    ],
    [
      {
        detailed_merge_status: 'mergeable',
        has_conflicts: false,
        blocking_discussions_resolved: true,
      },
      { mergeStatus: 'mergeable', hasConflicts: false, discussionsResolved: true },
    ],
  ] as const) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ web_url: report.url, state: 'opened', sha: commit, ...state }),
      ),
    );
    expect((await observe(work.id, report.id)).json()).toMatchObject({
      status: 'observed',
      httpStatus: 200,
      ...expected,
    });
  }
  expect(ctx.service.get(agent, work.id).tracking).toEqual(before);
  expect(store.raw.prepare('SELECT count(*) n FROM change_completions').get()).toEqual({ n: 0 });
});

it('retains actionable safe failure categories without storing provider bodies or exception details', async () => {
  await configure();
  const { work, report } = output();
  for (const [status, code] of [
    [401, 'authentication'],
    [403, 'permission'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [503, 'http'],
    [302, 'redirect'],
  ] as const) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(token, { status })),
    );
    const result = await observe(work.id, report.id);
    expect(result.json()).toMatchObject({
      status: 'unavailable',
      httpStatus: status,
      failureCode: code,
    });
    expect(result.body).not.toContain(token);
    expect(result.json().message).not.toBe('GitLab could not be checked.');
  }
  for (const [name, code] of [
    ['TimeoutError', 'timeout'],
    ['Error', 'network'],
  ] as const) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const error = new Error(token);
        error.name = name;
        throw error;
      }),
    );
    const result = await observe(work.id, report.id);
    expect(result.json()).toMatchObject({ failureCode: code, httpStatus: null });
    expect(result.body).not.toContain(token);
  }
  expect(
    JSON.stringify(store.raw.prepare('SELECT * FROM output_observations').all()),
  ).not.toContain(token);
});

it('stores new Mac-managed access by Keychain reference and keeps replacement/removal retryable', async () => {
  await configure();
  const legacy = JSON.parse(readFileSync(join(dir, 'integrations/gitlab.json'), 'utf8'));
  await ctx.app.close();
  const secrets = new Map<string, string>();
  const keychain = {
    write: vi.fn(async (id: string, value: string) => {
      secrets.set(id, value);
    }),
    read: vi.fn(async (id: string) => secrets.get(id)!),
    remove: vi.fn(async (id: string) => {
      secrets.delete(id);
    }),
  };
  ctx = await createApp(store, {
    origin,
    integrationDir: join(dir, 'integrations'),
    gitlabKeychain: keychain,
  });
  await configure();
  const first = JSON.parse(readFileSync(join(dir, 'integrations/gitlab.json'), 'utf8'));
  expect(first.keychainId).toBeTruthy();
  expect(first).not.toHaveProperty('tokenFile');
  expect(JSON.stringify(first)).not.toContain(token);
  expect(secrets.get(first.keychainId)).toBe(token);
  expect(() => readFileSync(legacy.tokenFile)).toThrow();
  const { work, report } = output();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  );
  expect((await observe(work.id, report.id)).json().status).toBe('observed');
  keychain.remove.mockRejectedValueOnce(new Error(token));
  const failed = await ctx.app.inject({
    method: 'POST',
    url: '/api/integrations/gitlab',
    headers: owner,
    payload: { origin: gitlab, token: 'new-synthetic-test-token' },
  });
  expect(failed.statusCode).toBe(409);
  expect(failed.body).not.toContain(token);
  expect(JSON.parse(readFileSync(join(dir, 'integrations/gitlab.json'), 'utf8'))).toEqual(first);
  expect(secrets.size).toBe(1);
  await configure();
  expect(secrets.has(first.keychainId)).toBe(false);
  expect(secrets.size).toBe(1);
  await ctx.app.inject({
    method: 'POST',
    url: '/api/integrations/gitlab/disconnect',
    headers: owner,
    payload: {},
  });
  expect(secrets.size).toBe(0);
  keychain.write.mockRejectedValueOnce(new Error(token));
  const denied = await ctx.app.inject({
    method: 'POST',
    url: '/api/integrations/gitlab',
    headers: owner,
    payload: { origin: gitlab, token },
  });
  expect(denied.statusCode).toBe(409);
  expect(denied.body).not.toContain(token);
  expect(
    readdirSync(join(dir, 'integrations')).some((name) => name.startsWith('gitlab-token-')),
  ).toBe(false);
  expect(() => readFileSync(join(dir, 'integrations/gitlab.json'))).toThrow();
});
