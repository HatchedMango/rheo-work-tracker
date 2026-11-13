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
  let client = new Client({ name: 'integration-test', version: '1.0' });
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
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'add_work_update',
        'create_work',
        'get_work',
        'list_work',
        'submit_stream',
        'get_stream_context',
        'update_change',
        'claim_change',
      ]),
    );
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
    expect(w.assignment.state).toBe('tracked');
    expect(w.attention.map((a: { kind: string }) => a.kind)).toEqual([]);
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
    ).toBe(0);
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
    expect(service.status({ id: 'owner', scope: 'owner', ownerId: 'owner' }).inboxCount).toBe(0);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).not.toBe(true);
      return read(r);
    };
    const stream = await call('submit_stream', {
      title: 'Resumable delivery',
      outcome: 'Recover evidence in a fresh session.',
      idempotencyKey: 'handoff',
    });
    const owner = { id: 'owner', scope: 'owner' as const, ownerId: 'owner' };
    const { StreamService } = await import('../src/services/streams.js');
    const streams = new StreamService(service);
    streams.action(owner, stream.id, { revision: 1, action: 'accept' });
    let planned = await call('update_change', {
      id: w.id,
      revision: 1,
      streamId: stream.id,
      expectedOutput: 'A reviewable MR',
      dependencies: [],
    });
    const missingFingerprint = await client.callTool({
      name: 'update_change',
      arguments: { id: w.id, revision: planned.tracking.revision, assessDependencies: true },
    });
    expect(missingFingerprint.isError).toBe(true);
    planned = await call('update_change', {
      id: w.id,
      revision: planned.tracking.revision,
      assessmentFingerprint: planned.tracking.assessmentFingerprint,
      assessDependencies: true,
    });
    service.action(owner, w.id, {
      revision: service.get(owner, w.id).revision,
      action: 'accept',
      message: '',
    });
    const { randomUUID } = await import('node:crypto');
    const sessionId = randomUUID();
    const claimToken = randomUUID().replaceAll('-', '');
    const claim = await call('claim_change', {
      token: claimToken,
      id: w.id,
      revision: planned.tracking.revision,
      sessionId,
    });
    expect(
      await call('claim_change', {
        id: w.id,
        revision: planned.tracking.revision,
        sessionId,
        token: claimToken,
      }),
    ).toEqual(claim);
    await call('record_context', {
      streamId: stream.id,
      kind: 'decision',
      body: 'Use a local helper at startup.',
      idempotencyKey: 'decision',
    });
    await call('record_context', {
      streamId: stream.id,
      kind: 'question',
      body: 'Which remote will receive the MR?',
      idempotencyKey: 'question',
    });
    await call('record_output', {
      id: w.id,
      kind: 'mr',
      url: 'https://example.com/mr/1',
      label: 'First output',
      state: 'available',
      codeRevision: 'abc123',
      idempotencyKey: 'output',
    });
    await call('update_change', {
      id: w.id,
      revision: planned.tracking.revision,
      progress: 'review',
      progressNote: 'Review the output; remote remains an open question.',
    });
    await call('update_claim', {
      id: claim.claim.id,
      sessionId,
      token: claim.token,
      release: true,
    });
    await client.close();
    client = new Client({ name: 'fresh-session', version: '1.0' });
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
    const recovered = await call('get_stream_context', {
      streamId: stream.id,
      project: '/explicit/project',
    });
    expect(recovered.stream.outcome).toBe(stream.outcome);
    expect(recovered.entries.items.map((e: { body: string }) => e.body)).toEqual(
      expect.arrayContaining([
        'Use a local helper at startup.',
        'Which remote will receive the MR?',
      ]),
    );
    expect(recovered.changes.items[0].tracking).toMatchObject({
      progress: 'review',
      claim: { state: 'released' },
      outputs: [{ codeRevision: 'abc123', state: 'available' }],
    });
    const child = await call('submit_stream', {
      title: 'Routine branch',
      outcome: 'Deliver one part',
      parentId: stream.id,
      scopeIntent: 'within_scope',
      idempotencyKey: 'branch',
    });
    expect(child.state).toBe('active');
    const routine = await call('create_work', {
      title: 'Routine output',
      objective: 'Small reviewed artifact',
      streamId: child.id,
      scopeIntent: 'within_scope',
      idempotencyKey: 'routine',
    });
    expect(routine.assignment.state).toBe('covered');
    expect(routine.attention).toEqual([]);
    const human = await call('request_human_action', {
      streamId: stream.id,
      title: 'Get access from Bob',
      doneWhen: 'Access available locally',
      idempotencyKey: 'access',
    });
    await call('set_prerequisites', {
      target: { id: routine.id, kind: 'change' },
      revision: 1,
      dependencies: [
        {
          source: { id: human.id, kind: 'human_action' },
          stage: 'start',
          condition: 'done',
          reason: 'Need access',
        },
      ],
    });
    expect((await call('get_human_action', { actionId: human.id })).state).toBe('open');
    const overview = await call('get_stream_context', {
      changeId: routine.id,
      project: '/explicit/project',
    });
    expect(overview.humanActions.total).toBe(0);
    expect(overview.changes.items[0].tracking.prerequisites[0].source.id).toBe(human.id);
    await call('report_stream', {
      streamId: child.id,
      streamRevision: child.revision,
      phase: 'Integration',
      summary: 'Waiting on access',
      reviewRequested: false,
    });
    await call('record_stream_output', {
      streamId: child.id,
      kind: 'document',
      url: 'https://example.com/result',
      label: 'Notes',
      state: 'available',
      idempotencyKey: 'notes',
    });
    await call('withdraw_human_action', {
      actionId: human.id,
      revision: 1,
      reason: 'No longer needed',
      idempotencyKey: 'withdraw',
    });
    expect((await call('get_human_action', { actionId: human.id })).state).toBe('cancelled');
    expect(
      store.raw.prepare('SELECT project FROM workflow_reads WHERE credentialId=?').get(c.id),
    ).toEqual({ project: '/explicit/project' });
  } finally {
    await client.close();
    await app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
