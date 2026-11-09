import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, readdirSync } from 'node:fs';
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
  dir = mkdtempSync(join(tmpdir(), 'work-inbox-connections-'));
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
    expect(tools.tools.map((t) => t.name)).toHaveLength(4);
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
