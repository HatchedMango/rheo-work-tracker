import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
it('round trips the work tools over real stdio and HTTP with a scoped agent credential', async () => {
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const dir = mkdtempSync(join(tmpdir(), 'work-inbox-mcp-'));
  const store = openStore(':memory:');
  const { app, auth, service } = await createApp(store, {
    origin: `http://127.0.0.1:${port}`,
    integrationDir: join(dir, 'integrations'),
    gitlabKeychain: null,
  });
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
    expect(client.getServerVersion()?.version).toBe(
      JSON.parse(readFileSync('package.json', 'utf8')).version,
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
        'review_dependencies',
        'assess_dependencies',
        'check_output',
        'save_design_record',
        'get_design_context',
        'get_design_record',
        'review_assumption',
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
    const workflow = read(await client.callTool({ name: 'get_workflow', arguments: {} }));
    expect(workflow.capabilities.protocol).toBe('agent-loop-v1');
    for (const name of workflow.capabilities.requiredTools)
      expect(tools.some((t) => t.name === name)).toBe(true);
    expect(
      tools.find((t) => t.name === 'claim_change')?.inputSchema.properties?.purpose,
    ).toMatchObject({ enum: ['collaboration', 'implementation'] });
    expect(workflow.loopProtocol).toContain('implement → check → revise');
    expect(workflow.capabilities.clientCheck).toContain('server contract only');
    const w = read(created);
    const design = read(
      await client.callTool({
        name: 'save_design_record',
        arguments: {
          target: { kind: 'change', id: w.id },
          record: {
            kind: 'assumption',
            statement: 'The provider accepts private uploads.',
            status: 'unknown',
            evidence: 'A provider check remains.',
            invalidatedBy: 'An unauthenticated read succeeds.',
          },
          reason: 'Retain the design dependency.',
          idempotencyKey: 'mcp-design',
        },
      }),
    );
    expect(design.record.kind).toBe('assumption');
    expect(
      read(
        await client.callTool({
          name: 'review_assumption',
          arguments: {
            changeId: w.id,
            assumptionId: design.id,
            assumptionRevision: 1,
            revision: 0,
            note: 'Check privacy before relying on this endpoint.',
            idempotencyKey: 'mcp-review',
          },
        }),
      ).needsReview,
    ).toBe(false);
    expect(
      read(await client.callTool({ name: 'get_design_record', arguments: { id: design.id } })).id,
    ).toBe(design.id);
    expect(
      read(
        await client.callTool({
          name: 'get_design_context',
          arguments: { target: { kind: 'change', id: w.id } },
        }),
      ).total,
    ).toBe(1);
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
    const evidence = read(
      await client.callTool({ name: 'get_work', arguments: { id: w.id, part: 'output-evidence' } }),
    );
    expect(evidence).toMatchObject({ configured: false, outputs: [] });
    const invalidCheck = await client.callTool({
      name: 'check_output',
      arguments: { id: w.id, outputId: crypto.randomUUID(), revision: 1 },
    });
    expect(invalidCheck.isError).toBe(true);
    expect(
      read(await client.callTool({ name: 'get_work', arguments: { id: w.id } })).tracking.progress,
    ).toBe(item.tracking.progress);

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
      guidance: { steps: ['Ask Bob for access.'], why: 'This unlocks the integration.' },
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
    const revisedHuman = await call('revise_human_action', {
      actionId: human.id,
      revision: 1,
      title: 'Get API access',
      guidance: { steps: ['Ask Bob for sandbox access.'], why: 'This unlocks the integration.' },
      idempotencyKey: 'clarify-access',
    });
    expect(revisedHuman).toMatchObject({
      id: human.id,
      revision: 2,
      state: 'open',
      guidance: { steps: ['Ask Bob for sandbox access.'] },
    });
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
      revision: 2,
      reason: 'No longer needed',
      idempotencyKey: 'withdraw',
    });
    expect((await call('get_human_action', { actionId: human.id })).state).toBe('cancelled');
    const standalone = await call('create_work', {
      title: 'Independent copy change',
      objective: 'Change wording using the existing interface.',
    });
    const t = { id: standalone.id, kind: 'change' };
    const review = await call('review_dependencies', { target: t });
    expect(review.scopeStreamId).toBeNull();
    const report = await call('assess_dependencies', {
      target: t,
      revision: review.revision,
      scopeStreamId: review.scopeStreamId,
      scopeFingerprint: review.scopeFingerprint,
      planFingerprint: review.planFingerprint,
      reviewedIds: review.items.map((x: { id: string }) => x.id),
      coverage: 'complete',
      start: { result: 'none', reason: 'No new output is required for this copy change.' },
      deliver: {
        result: 'none',
        reason: 'This uses the current interface and has no delivery gate.',
      },
      idempotencyKey: 'explicit-none',
    });
    expect(report.state).toBe('current');
    const request = {
      id: standalone.id,
      revision: report.revision,
      sessionId: crypto.randomUUID(),
      token: crypto.randomUUID().replaceAll('-', ''),
      purpose: 'implementation',
    };
    const managed = await call('claim_change', request);
    expect(managed.claim.purpose).toBe('implementation');
    await call('update_claim', {
      id: managed.claim.id,
      sessionId: request.sessionId,
      token: request.token,
      release: true,
    });
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
