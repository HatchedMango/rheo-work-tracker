import { it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  readdirSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { eq } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
import { agentConnections } from '../src/db/schema.js';
import { connectionConfiguration, shellQuote } from '../src/services/connections.js';
let dir: string,
  store: ReturnType<typeof openStore>,
  ctx: Awaited<ReturnType<typeof createApp>>,
  port: number,
  origin: string,
  host: string;
beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'work-inbox-connections-')));
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
  port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  origin = `http://127.0.0.1:${port}`;
  host = `127.0.0.1:${port}`;
  store = openStore(join(dir, 'work.sqlite'));
  ctx = await createApp(store, {
    origin,
    connectionDir: join(dir, 'Agent files with spaces'),
    mcpEntry: resolve('dist/mcp/index.js'),
  });
});
afterEach(async () => {
  await ctx.app.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
async function ownerHeaders() {
  const r = await ctx.app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { host, origin },
    payload: {},
  });
  return { host, origin, cookie: r.headers['set-cookie']!.toString().split(';')[0] };
}
async function create(client = 'codex', idempotencyKey = randomUUID()) {
  const headers = await ownerHeaders();
  const r = await ctx.app.inject({
    method: 'POST',
    url: '/api/connections',
    headers,
    payload: { name: 'Personal agent', client, idempotencyKey },
  });
  expect(r.statusCode).toBe(201);
  return { setup: r.json(), headers };
}
it('creates a protected scoped credential and per-client configuration without exposing the secret', async () => {
  const { setup, headers } = await create();
  const file = JSON.parse(readFileSync(setup.launch.env.WORK_INBOX_CREDENTIAL_FILE, 'utf8'));
  expect(file.url).toBe(origin);
  expect(ctx.auth.actor(file.token, 'bearer').scope).toBe('agent');
  expect(statSync(setup.launch.env.WORK_INBOX_CREDENTIAL_FILE).mode & 0o077).toBe(0);
  expect(statSync(join(dir, 'Agent files with spaces')).mode & 0o077).toBe(0);
  expect(setup.configuration).toContain('[mcp_servers.');
  expect(setup.configuration).toContain(setup.serverName);
  expect(setup.command).toContain('codex mcp add');
  expect(setup.setupPrompt).toContain('preserve all existing servers and settings');
  expect(setup.setupPrompt).toContain('Do not claim the connection is verified');
  expect(setup.setupPrompt).toContain('list_work');
  expect(JSON.stringify(setup)).not.toContain(file.token);
  const listed = await ctx.app.inject({ url: '/api/connections', headers });
  expect(listed.json().items).toEqual([]);
  expect(listed.body).not.toContain(file.token);
  expect(listed.body).not.toContain('credentialPath');
  const second = await create('claude-desktop');
  expect(second.setup.setupPrompt).toContain('Claude Desktop');
  const json = JSON.parse(second.setup.configuration);
  expect(json.mcpServers[second.setup.serverName].command).toBe(process.execPath);
  expect(second.setup.serverName).not.toBe(setup.serverName);
  const commandConfig = connectionConfiguration(
    'codex',
    'abcd-1234',
    "/Node's folder/node",
    '/app with spaces/mcp.js',
    "/User's files/credential.json",
  );
  expect(commandConfig.command).toContain(
    shellQuote("WORK_INBOX_CREDENTIAL_FILE=/User's files/credential.json"),
  );
  expect(commandConfig.configuration).toContain(JSON.stringify("/User's files/credential.json"));
});
it('makes retries idempotent, rejects changed requests, and blocks non-owner credential management', async () => {
  const key = randomUUID();
  const { setup, headers } = await create('codex', key);
  const retry = await ctx.app.inject({
    method: 'POST',
    url: '/api/connections',
    headers,
    payload: { name: 'Personal agent', client: 'codex', idempotencyKey: key },
  });
  expect(retry.json().id).toBe(setup.id);
  expect(readdirSync(join(dir, 'Agent files with spaces'))).toHaveLength(1);
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/connections',
        headers,
        payload: { name: 'Other', client: 'codex', idempotencyKey: key },
      })
    ).statusCode,
  ).toBe(409);
  const agent = ctx.auth.register('agent', 'Limited');
  const limited = { host, origin, authorization: `Bearer ${agent.secret}` };
  for (const url of ['/api/connections', `/api/connections/${setup.id}/setup`])
    expect((await ctx.app.inject({ url, headers: limited })).statusCode).toBe(403);
  for (const url of [
    '/api/connections',
    `/api/connections/${setup.id}/check`,
    `/api/connections/${setup.id}/disconnect`,
    `/api/connections/${setup.id}/complete`,
  ])
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url,
          headers: limited,
          payload: { name: 'Escalate', client: 'codex', idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(403);
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { host, origin: 'https://evil.example', cookie: headers.cookie },
        payload: { name: 'Foreign', client: 'other', idempotencyKey: randomUUID() },
      })
    ).statusCode,
  ).toBe(403);
});
it('local check launches the actual generated MCP entry without verifying an agent; real calls verify and disconnect revokes', async () => {
  const { setup, headers } = await create();
  await ctx.app.listen({ host: '127.0.0.1', port });
  const check = await ctx.app.inject({
    method: 'POST',
    url: `/api/connections/${setup.id}/check`,
    headers,
    payload: {},
  });
  expect(check.json().ok).toBe(true);
  expect(check.json().connection.state).toBe('pending');
  expect(check.json().connection.checkOk).toBe(true);
  const client = new Client({ name: 'real-client-test', version: '1.0' });
  try {
    await client.connect(new StdioClientTransport({ ...setup.launch, stderr: 'pipe' }));
    await expect
      .poll(
        () =>
          store.db.select().from(agentConnections).where(eq(agentConnections.id, setup.id)).get()
            ?.initializedAt,
      )
      .not.toBeNull();
    expect(
      ctx.connections.get({ id: 'owner', scope: 'owner', ownerId: 'owner' }, setup.id).state,
    ).toBe('detected');
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'create_work',
        'list_work',
        'get_work',
        'add_work_update',
        'get_stream_context',
      ]),
    );
    // Listing tools alone does not claim that the user has used one.
    expect(
      ctx.connections.get({ id: 'owner', scope: 'owner', ownerId: 'owner' }, setup.id).state,
    ).toBe('detected');
    const result = await client.callTool({ name: 'list_work', arguments: { limit: 1 } });
    expect(result.isError).not.toBe(true);
    const row = ctx.connections.get({ id: 'owner', scope: 'owner', ownerId: 'owner' }, setup.id);
    expect(row.state).toBe('verified');
    expect(row.lastTool).toBe('list_work');
    expect(row.clientName).toBe('real-client-test');
    expect(ctx.connections.list({ id: 'owner', scope: 'owner', ownerId: 'owner' })).toEqual([]);
    const complete = await ctx.app.inject({
      method: 'POST',
      url: `/api/connections/${setup.id}/complete`,
      headers,
      payload: {},
    });
    expect(complete.statusCode).toBe(200);
    expect(ctx.connections.list({ id: 'owner', scope: 'owner', ownerId: 'owner' })).toHaveLength(1);

    expect(store.raw.prepare('SELECT count(*) AS n FROM work').get()).toEqual({ n: 0 });
    const disconnected = await ctx.app.inject({
      method: 'POST',
      url: `/api/connections/${setup.id}/disconnect`,
      headers,
      payload: {},
    });
    expect(disconnected.json().state).toBe('disconnected');
    expect((await client.callTool({ name: 'list_work', arguments: {} })).isError).toBe(true);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/connections/${setup.id}/check`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await client.close();
  }
});
it('failed checks remain pending and telemetry cannot verify another connection', async () => {
  const { setup, headers } = await create();
  const other = await create('other');
  const file = JSON.parse(readFileSync(other.setup.launch.env.WORK_INBOX_CREDENTIAL_FILE, 'utf8'));
  const activity = await ctx.app.inject({
    method: 'POST',
    url: '/api/agent/activity',
    headers: { host, authorization: `Bearer ${file.token}` },
    payload: {
      kind: 'tool',
      clientName: 'Other client',
      tool: 'list_work',
      connectionId: setup.id,
    },
  });
  expect(activity.statusCode).toBe(200);
  const owner = { id: 'owner', scope: 'owner' as const, ownerId: 'owner' };
  expect(ctx.connections.list(owner)).toEqual([]);
  expect(ctx.connections.get(owner, setup.id).state).toBe('pending');
  expect(ctx.connections.get(owner, other.setup.id).state).toBe('verified');
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/agent/activity',
        headers,
        payload: { kind: 'tool', clientName: 'Browser', tool: 'list_work' },
      })
    ).statusCode,
  ).toBe(403);
  rmSync(setup.launch.env.WORK_INBOX_CREDENTIAL_FILE);
  const check = await ctx.app.inject({
    method: 'POST',
    url: `/api/connections/${setup.id}/check`,
    headers,
    payload: {},
  });
  expect(check.json().ok).toBe(false);
  expect(check.json().connection.state).toBe('pending');
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/connections',
        headers,
        payload: { client: 'not-supported', name: 'Bad', idempotencyKey: randomUUID() },
      })
    ).statusCode,
  ).toBe(400);
});

it('keeps unverified setups out of connections and revokes credentials when cancelled', async () => {
  const { setup, headers } = await create();
  const token = JSON.parse(readFileSync(setup.launch.env.WORK_INBOX_CREDENTIAL_FILE, 'utf8')).token;
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/connections/${setup.id}/complete`,
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(409);
  expect((await ctx.app.inject({ url: '/api/connections', headers })).json().items).toEqual([]);
  const cancelled = await ctx.app.inject({
    method: 'POST',
    url: `/api/connections/${setup.id}/disconnect`,
    headers,
    payload: {},
  });
  expect(cancelled.json().state).toBe('disconnected');
  expect((await ctx.app.inject({ url: '/api/connections', headers })).json().items).toEqual([]);
  expect(() => ctx.auth.actor(token, 'bearer')).toThrow();
  expect(
    (await ctx.app.inject({ url: `/api/connections/${setup.id}/setup`, headers })).statusCode,
  ).toBe(409);
});

it('terminates Claude Code variadic environment options before the server name', () => {
  const config = connectionConfiguration(
    'claude-code',
    '4633a26c-test',
    '/runtime/node',
    '/app/mcp.js',
    "/User's files/credential.json",
  );
  expect(config.command).toContain(
    `--env ${shellQuote("WORK_INBOX_CREDENTIAL_FILE=/User's files/credential.json")} --transport stdio --scope local ${shellQuote(config.serverName)} --`,
  );
  expect(config.setupPrompt).toContain('Claude Code');
  expect(config.workflowPrompt).toContain('SessionStart');
});

async function readyConnection(client = 'claude-code') {
  const result = await create(client);
  store.raw
    .prepare('UPDATE agent_connections SET lastToolAt=?,completedAt=? WHERE id=?')
    .run(Date.now(), Date.now(), result.setup.id);
  const credential = JSON.parse(
    readFileSync(result.setup.launch.env.WORK_INBOX_CREDENTIAL_FILE, 'utf8'),
  );
  return {
    ...result,
    agentHeaders: { host, authorization: `Bearer ${credential.token}` },
    token: credential.token,
  };
}

it('prepares scoped existing-project handoffs without changing work, files, credentials or completion credit', async () => {
  const { setup, headers, token } = await readyConnection();
  const project = join(dir, "Client's $(project)");
  mkdirSync(project);
  const guidance = join(project, 'CLAUDE.md');
  writeFileSync(guidance, 'Keep existing guidance.');
  const alias = join(dir, 'alias');
  symlinkSync(project, alias);
  const request = () =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/connections/${setup.id}/existing-work`,
      headers,
      payload: { projects: [project, alias, project] },
    });
  const first = await request();
  expect(first.statusCode).toBe(200);
  expect(first.json().projects).toHaveLength(1);
  const prompt = first.json().projects[0].prompt;
  expect(prompt).toContain(JSON.stringify(project));
  expect(prompt).toContain(setup.serverName);
  expect(prompt).toContain('Reuse matching streams and unfinished changes');
  expect(prompt).toContain('Keep completed history as context');
  expect(prompt).toContain('never invent IDs');
  expect(prompt).toContain('\n\nUse this local helper');
  expect(prompt).not.toContain('\\n\\nUse this local helper');
  expect(first.body).not.toContain(token);
  expect((await request()).json().projects).toEqual(first.json().projects);
  expect(readFileSync(guidance, 'utf8')).toBe('Keep existing guidance.');
  expect(store.raw.prepare('SELECT count(*) n FROM work').get()).toEqual({ n: 0 });
  expect(store.raw.prepare('SELECT count(*) n FROM streams').get()).toEqual({ n: 0 });
  expect(store.raw.prepare('SELECT count(*) n FROM change_completions').get()).toEqual({ n: 0 });
  expect(store.raw.prepare('SELECT count(*) n FROM agent_connections').get()).toEqual({ n: 1 });
});

it('requires owner access, a verified supported connection and explicit real project folders', async () => {
  const { setup, headers, agentHeaders } = await readyConnection();
  const url = `/api/connections/${setup.id}/existing-work`;
  const post = (payload: unknown, h: Record<string, string> = headers, path = url) =>
    ctx.app.inject({ method: 'POST', url: path, headers: h, payload: payload as object });
  expect((await post({ projects: [dir] }, agentHeaders)).statusCode).toBe(403);
  expect(
    (await post({ projects: [dir], since: 0 }, agentHeaders, url + '/status')).statusCode,
  ).toBe(403);
  for (const projects of [
    [],
    ['relative'],
    [dir + '-missing'],
    Array(11).fill(dir),
    ['/tmp/\ninvalid'],
  ])
    expect((await post({ projects })).statusCode).toBe(400);
  const file = join(dir, 'file');
  writeFileSync(file, 'not a directory');
  expect((await post({ projects: [file] })).statusCode).toBe(400);
  expect(
    (await post({ projects: [dir], since: Date.now() + 100000 }, headers, url + '/status'))
      .statusCode,
  ).toBe(400);
  const pending = await create();
  expect(
    (
      await post(
        { projects: [dir] },
        pending.headers,
        `/api/connections/${pending.setup.id}/existing-work`,
      )
    ).statusCode,
  ).toBe(409);
  const unsupported = await readyConnection('claude-desktop');
  expect(
    (
      await post(
        { projects: [dir] },
        unsupported.headers,
        `/api/connections/${unsupported.setup.id}/existing-work`,
      )
    ).statusCode,
  ).toBe(400);
  await ctx.app.inject({
    method: 'POST',
    url: `/api/connections/${setup.id}/disconnect`,
    headers,
    payload: {},
  });
  expect((await post({ projects: [dir] })).statusCode).toBe(409);
});

it('observes only fresh context and current checkpoints from the selected connection and project', async () => {
  const { setup, headers, agentHeaders } = await readyConnection();
  const project = join(dir, 'active');
  mkdirSync(project);
  const otherProject = join(dir, 'other');
  mkdirSync(otherProject);
  const endpoint = `/api/connections/${setup.id}/existing-work`;
  const prepared = await ctx.app.inject({
    method: 'POST',
    url: endpoint,
    headers,
    payload: { projects: [project, otherProject] },
  });
  const since = prepared.json().preparedAt;
  const status = async () => {
    const r = await ctx.app.inject({
      method: 'POST',
      url: endpoint + '/status',
      headers,
      payload: { projects: [project, otherProject], since },
    });
    expect(r.statusCode).toBe(200);
    return r.json().projects;
  };
  expect((await status()).map((p: { contextAt: number | null }) => p.contextAt)).toEqual([
    null,
    null,
  ]);
  const s = await ctx.app.inject({
    method: 'POST',
    url: '/api/streams',
    headers: agentHeaders,
    payload: {
      title: 'Ship the active project',
      outcome: 'Finish the current work',
      idempotencyKey: randomUUID(),
    },
  });
  expect(s.statusCode).toBe(201);
  const identity = {
    client: 'claude-code',
    sessionId: randomUUID(),
    project,
    streamId: s.json().id,
    turnId: 'first',
  };
  const sync = async (event: string, extras: object = {}) => {
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/sync/events',
      headers: agentHeaders,
      payload: { ...identity, eventId: randomUUID(), occurredAt: Date.now(), event, ...extras },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().session.sessionId).toBe(identity.sessionId);
  };
  await sync('start');
  expect((await status())[0]).toMatchObject({ contextAt: expect.any(Number), checkpointAt: null });
  expect((await status())[1]).toMatchObject({ contextAt: null, checkpointAt: null });
  await sync('checkpoint', { checkpoint: { summary: 'Current project handoff saved.' } });
  expect((await status())[0]).toMatchObject({
    checkpointAt: expect.any(Number),
    needsUpdate: false,
  });
  await sync('prompt', { turnId: 'second' });
  expect((await status())[0]).toMatchObject({ checkpointAt: null, needsUpdate: true });
  await sync('checkpoint', {
    turnId: 'second',
    checkpoint: { summary: 'Latest project handoff saved.' },
  });
  store.raw
    .prepare('UPDATE workflow_sessions SET pendingWrites=1 WHERE sessionId=?')
    .run(identity.sessionId);
  expect((await status())[0]).toMatchObject({ checkpointAt: null, needsUpdate: true });
  store.raw
    .prepare(
      'UPDATE workflow_sessions SET pendingWrites=0,lastContextAt=?,lastCheckpointAt=? WHERE sessionId=?',
    )
    .run(since - 1, since - 1, identity.sessionId);
  store.raw.prepare('DELETE FROM workflow_reads').run();
  expect((await status())[0]).toMatchObject({ contextAt: null, checkpointAt: null });
  const other = await readyConnection();
  await ctx.app.inject({
    method: 'POST',
    url: '/api/sync/events',
    headers: other.agentHeaders,
    payload: {
      ...identity,
      sessionId: randomUUID(),
      eventId: randomUUID(),
      occurredAt: Date.now(),
      event: 'start',
    },
  });
  expect((await status())[0]).toMatchObject({ contextAt: null, checkpointAt: null });
});
