import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
it('round trips all four tools over real stdio and HTTP with a scoped agent credential', async () => {
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const dir = mkdtempSync(join(tmpdir(), 'work-inbox-mcp-'));
  const store = openStore(':memory:');
  const { app, auth, service } = await createApp(store, { origin: `http://127.0.0.1:${port}` });
  const c = auth.register('agent', 'MCP follow-up');
  const path = join(dir, 'agent.json');
  writeFileSync(path, JSON.stringify({ url: `http://127.0.0.1:${port}`, token: c.secret }), {
    mode: 0o600,
  });
  const client = new Client({ name: 'integration-test', version: '1.0' });
  try {
    await app.listen({ port, host: '127.0.0.1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'src/mcp/index.ts'],
        cwd: process.cwd(),
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
          ),
          WORK_INBOX_CREDENTIAL_FILE: path,
        },
        stderr: 'pipe',
      }),
    );
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_work_update',
      'create_work',
      'get_work',
      'list_work',
    ]);
    expect(tools.find((t) => t.name === 'create_work')?.inputSchema.properties).not.toHaveProperty(
      'destination',
    );
    const created = await client.callTool({
      name: 'create_work',
      arguments: {
        title: 'Refactor date picker later',
        objective: 'Keep a follow-up without interrupting current work.',
        idempotencyKey: 'mcp-demo',
      },
    });
    expect(created.isError).not.toBe(true);
    const read = (r: typeof created) =>
      JSON.parse((r.content as { type: string; text: string }[])[0].text);
    const w = read(created);
    expect(w.ownerId).toBeNull();
    expect(w.assignment.state).toBe('proposed');
    expect(w.attention.map((a: { kind: string }) => a.kind)).toEqual(['assignment']);
    const retry = await client.callTool({
      name: 'create_work',
      arguments: {
        title: 'Refactor date picker later',
        objective: 'Keep a follow-up without interrupting current work.',
        idempotencyKey: 'mcp-demo',
        destination: 'backlog',
      },
    });
    expect(read(retry).id).toBe(w.id);
    expect(
      read(await client.callTool({ name: 'list_work', arguments: { view: 'inbox' } })).total,
    ).toBe(1);
    await client.callTool({
      name: 'add_work_update',
      arguments: {
        id: w.id,
        message: 'Discovered while working on another task.',
        references: [{ system: 'context', url: 'https://example.com/context' }],
      },
    });
    const item = read(await client.callTool({ name: 'get_work', arguments: { id: w.id } }));
    expect(item.events[0].message).toContain('Discovered');
    expect(item.events[0].actorName).toBe('MCP follow-up');
    expect(service.status({ id: 'owner', scope: 'owner', ownerId: 'owner' }).inboxCount).toBe(1);
  } finally {
    await client.close();
    await app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
