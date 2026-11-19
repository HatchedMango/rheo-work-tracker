import { it, expect, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
import { workflowSetup } from '../src/workflow/setup.js';
import { runHook, saveCheckpoint, setStopPolicy, selectWork } from '../src/workflow/hooks.js';
import { SyncOutbox, privateWrite } from '../src/workflow/outbox.js';
import { readSession, sessionPath, withSession } from '../src/workflow/session-state.js';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
async function fixture(client: 'codex' | 'claude-code' = 'codex') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'work-inbox-sync-')));
  dirs.push(dir);
  vi.stubEnv('WORK_INBOX_SYNC_HOME', join(dir, 'private-sync'));
  const reserve = createServer();
  await new Promise<void>((r) => reserve.listen(0, '127.0.0.1', r));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((r) => reserve.close(() => r()));
  const store = openStore(':memory:'),
    origin = `http://127.0.0.1:${port}`;
  const services = await createApp(store, { origin });
  const c = services.auth.register('agent', 'Hook test');
  const agent = services.auth.actor(c.secret, 'bearer');
  const stream = services.streams.submit(agent, {
    title: 'Real lifecycle fixture',
    outcome: 'Durable sync',
    idempotencyKey: randomUUID(),
  });
  const credentialFile = join(dir, 'credential.json');
  writeFileSync(credentialFile, JSON.stringify({ url: origin, token: c.secret }), { mode: 0o600 });
  workflowSetup('install', {
    project: dir,
    client,
    credentialFile,
    helper: join(dir, 'helper'),
    serverName: 'fixture',
    streamId: stream.id,
  });
  const binding = join(dir, `.work-inbox/${client}.json`);
  return { ...services, dir, store, agent, stream, credentialFile, binding, port };
}
it('recovers offline lifecycle writes and checks for a real checkpoint, with a single continuation and no transcript capture', async () => {
  const f = await fixture();
  try {
    const input = {
      hook_event_name: 'SessionStart',
      session_id: 'native-hook-session',
      source: 'startup',
      transcript_path: '/never/read',
      prompt: 'Do not persist full prompt',
    };
    const offline = await runHook(f.binding, input);
    expect(offline).toHaveProperty('systemMessage');
    const outbox = new SyncOutbox(f.credentialFile, f.dir, 'codex');
    expect(outbox.pending()).toHaveLength(1);
    expect(statSync(outbox.directory).mode & 0o777).toBe(0o700);
    expect(statSync(outbox.path(outbox.pending()[0].eventId)).mode & 0o777).toBe(0o600);
    expect(readFileSync(outbox.path(outbox.pending()[0].eventId), 'utf8')).not.toContain(
      'transcript',
    );
    await f.app.listen({ port: f.port, host: '127.0.0.1' });
    const started = await runHook(f.binding, { ...input, source: 'resume' });
    expect(started).toHaveProperty('hookSpecificOutput');
    expect(started.hookSpecificOutput?.additionalContext).toContain('Use the work-inbox skill');
    expect(started.hookSpecificOutput?.additionalContext).toContain('get_stream_context');
    expect(() => readFileSync(join(f.dir, 'AGENTS.md'))).toThrow();
    expect(outbox.pending()).toHaveLength(0);
    await runHook(f.binding, {
      hook_event_name: 'UserPromptSubmit',
      session_id: input.session_id,
      turn_id: 'native-turn',
    });
    const missing = await runHook(f.binding, {
      hook_event_name: 'Stop',
      session_id: input.session_id,
      turn_id: 'native-turn',
    });
    expect(missing).toHaveProperty('decision', 'block');
    const continued = await runHook(f.binding, {
      hook_event_name: 'Stop',
      session_id: input.session_id,
      turn_id: 'native-turn',
      stop_hook_active: true,
    });
    expect(continued).not.toHaveProperty('decision');
    const path = join(f.dir, 'checkpoint.json');
    writeFileSync(path, JSON.stringify({ summary: 'Plan prepared; no implementation' }), {
      mode: 0o600,
    });
    const result = await saveCheckpoint(f.binding, path, input.session_id);
    expect(result.pending).toBe(0);
    expect(result.conflicts).toEqual([]);
    expect(
      await runHook(f.binding, {
        hook_event_name: 'Stop',
        session_id: input.session_id,
        turn_id: 'native-turn',
      }),
    ).toEqual({});
    expect(f.sync.list({ id: 'owner', scope: 'owner', ownerId: 'owner' }).items[0]).toMatchObject({
      needsCheckpoint: 0,
      summary: 'Plan prepared; no implementation',
    });
  } finally {
    await f.app.close();
    f.store.close();
  }
});
it('replays an uncertain successful write once and quarantines conflicts without claiming synchronization', async () => {
  const f = await fixture();
  try {
    await f.app.listen({ port: f.port, host: '127.0.0.1' });
    const outbox = new SyncOutbox(f.credentialFile, f.dir, 'codex');
    const first = outbox.enqueue({
      eventId: randomUUID(),
      sessionId: 'replay',
      client: 'codex',
      project: f.dir,
      streamId: f.stream.id,
      turnId: 'one',
      event: 'start',
      occurredAt: Date.now(),
    });
    f.sync.event(f.agent, first); // Successful server write with an unreceived acknowledgement.
    await outbox.flush();
    expect(outbox.pending()).toHaveLength(0);
    expect(
      (f.store.raw.prepare('SELECT count(*) n FROM workflow_receipts').get() as { n: number }).n,
    ).toBe(1);
    outbox.enqueue({
      ...first,
      eventId: randomUUID(),
      event: 'checkpoint',
      checkpoint: {
        summary: 'Stale answer',
        feedback: [
          {
            kind: 'stream_decision',
            id: f.stream.id,
            revision: 999,
            action: 'accept',
            response: 'Yes',
          },
        ],
      },
      occurredAt: Date.now(),
    });
    const rejected = await outbox.flush();
    expect(rejected.conflicts).toHaveLength(1);
    expect(outbox.pending()).toHaveLength(0);
    expect((await outbox.flush()).conflicts).toEqual(rejected.conflicts);
    expect(readdirSync(outbox.directory).some((n) => n.endsWith('.conflict'))).toBe(true);
    expect(
      f.sync.list({ id: 'owner', scope: 'owner', ownerId: 'owner' }).items[0].pendingWrites,
    ).toBe(1);
    outbox.enqueue({
      ...first,
      eventId: randomUUID(),
      event: 'checkpoint',
      checkpoint: {
        summary: 'Re-read current context; discarded unsupported approval without applying it',
        reconciles: rejected.conflicts,
      },
      occurredAt: Date.now(),
    });
    const reconciled = await outbox.flush();
    expect(reconciled.conflicts).toEqual([]);
    expect(readdirSync(outbox.directory).some((n) => n.endsWith('.resolved'))).toBe(true);
    expect(
      f.sync.list({ id: 'owner', scope: 'owner', ownerId: 'owner' }).items[0].pendingWrites,
    ).toBe(0);
  } finally {
    await f.app.close();
    f.store.close();
  }
});

for (const client of ['codex', 'claude-code'] as const) {
  it(`${client}: durably suppresses repeated stops, including continuation turns and recovery`, async () => {
    const f = await fixture(client);
    try {
      await f.app.listen({ port: f.port, host: '127.0.0.1' });
      const input = { session_id: 'repeat', ...(client === 'codex' ? { turn_id: 'one' } : {}) };
      await runHook(f.binding, { ...input, hook_event_name: 'UserPromptSubmit' });
      expect(await runHook(f.binding, { ...input, hook_event_name: 'Stop' })).toHaveProperty(
        'decision',
        'block',
      );
      for (let i = 0; i < 3; i++)
        expect(await runHook(f.binding, { ...input, hook_event_name: 'Stop' })).not.toHaveProperty(
          'decision',
        );
      // A continuation can be a new user-prompt event, with no active flag.
      const continuation = {
        session_id: 'repeat',
        ...(client === 'codex' ? { turn_id: 'two' } : {}),
      };
      await runHook(f.binding, { ...continuation, hook_event_name: 'UserPromptSubmit' });
      const outbox = new SyncOutbox(f.credentialFile, f.dir, client);
      expect(readSession(outbox, 'repeat').reminder).toBeDefined();
      await runHook(f.binding, {
        ...continuation,
        hook_event_name: 'SessionStart',
        source: 'compact',
      });
      expect(
        await runHook(f.binding, { ...continuation, hook_event_name: 'Stop' }),
      ).not.toHaveProperty('decision');
      const file = join(f.dir, 'cp.json');
      writeFileSync(
        file,
        JSON.stringify({ summary: 'Check failed; next revise the parser, same output.' }),
      );
      expect((await saveCheckpoint(f.binding, file, 'repeat')).pending).toBe(0);
      expect(await runHook(f.binding, { ...continuation, hook_event_name: 'Stop' })).toEqual({});
      await runHook(f.binding, {
        ...continuation,
        hook_event_name: 'UserPromptSubmit',
        ...(client === 'codex' ? { turn_id: 'three' } : {}),
      });
      expect(
        await runHook(f.binding, {
          hook_event_name: 'Stop',
          session_id: 'repeat',
          ...(client === 'codex' ? { turn_id: 'three' } : {}),
        }),
      ).toHaveProperty('decision', 'block');
      expect(statSync(sessionPath(outbox, 'repeat')).mode & 0o777).toBe(0o600);
    } finally {
      await f.app.close();
      f.store.close();
    }
  });
}
it('keeps runner policy per session and never overrides another hook or an interrupt', async () => {
  const f = await fixture();
  try {
    await f.app.listen({ port: f.port, host: '127.0.0.1' });
    await setStopPolicy(f.binding, 'runner', 'observe');
    for (const session_id of ['runner', 'normal'])
      await runHook(f.binding, { hook_event_name: 'UserPromptSubmit', session_id, turn_id: 'one' });
    for (let i = 0; i < 3; i++) {
      const r = await runHook(f.binding, {
        hook_event_name: 'Stop',
        session_id: 'runner',
        turn_id: 'one',
      });
      expect(r).not.toHaveProperty('decision');
      expect(r).not.toHaveProperty('continue');
      expect(r).not.toHaveProperty('hookSpecificOutput');
    }
    expect(
      await runHook(f.binding, { hook_event_name: 'Stop', session_id: 'normal', turn_id: 'one' }),
    ).toHaveProperty('decision', 'block');
    await runHook(f.binding, {
      hook_event_name: 'SessionStart',
      session_id: 'runner',
      source: 'resume',
    });
    expect(
      await runHook(f.binding, { hook_event_name: 'Stop', session_id: 'runner' }),
    ).not.toHaveProperty('decision');
    const interrupted = await runHook(f.binding, {
      hook_event_name: 'Interrupt',
      session_id: 'runner',
      turn_id: 'one',
    });
    expect(interrupted).not.toHaveProperty('decision');
    expect(interrupted).not.toHaveProperty('continue');
    expect(
      f.sync
        .list({ id: 'owner', scope: 'owner', ownerId: 'owner' })
        .items.find((x) => x.sessionId === 'runner'),
    ).toMatchObject({ needsCheckpoint: 1, summary: '' });
  } finally {
    await f.app.close();
    f.store.close();
  }
});
it('uses compact prompts, full recovery, and keeps older turn notifications from rolling back state', async () => {
  const f = await fixture();
  try {
    await f.app.listen({ port: f.port, host: '127.0.0.1' });
    const input = { session_id: 'recover', turn_id: 'current' };
    await runHook(f.binding, { ...input, hook_event_name: 'SessionStart', source: 'startup' });
    const refresh = await runHook(f.binding, { ...input, hook_event_name: 'UserPromptSubmit' });
    expect(refresh.hookSpecificOutput?.additionalContext).toContain('"mode":"compact"');
    const recovery = await runHook(f.binding, {
      ...input,
      hook_event_name: 'SessionStart',
      source: 'compact',
    });
    expect(JSON.stringify(recovery)).toContain('workflowVersion');
    expect(recovery.hookSpecificOutput?.additionalContext).not.toContain('"mode":"compact"');
    expect(
      await runHook(f.binding, {
        hook_event_name: 'Stop',
        session_id: input.session_id,
        turn_id: 'old',
      }),
    ).not.toHaveProperty('decision');
    expect(f.sync.list({ id: 'owner', scope: 'owner', ownerId: 'owner' }).items[0].turnId).toBe(
      'current',
    );
    const file = join(f.dir, 'cp.json');
    writeFileSync(file, JSON.stringify({ summary: 'Incomplete; next check recovery.' }));
    await saveCheckpoint(f.binding, file, input.session_id);
    expect(
      JSON.stringify(
        await runHook(f.binding, { ...input, hook_event_name: 'SessionStart', source: 'resume' }),
      ),
    ).toContain('Incomplete; next check recovery.');
    expect(await runHook(f.binding, { ...input, hook_event_name: 'Interrupt' })).not.toHaveProperty(
      'decision',
    );
    expect(await runHook(f.binding, { ...input, hook_event_name: 'Stop' })).toHaveProperty(
      'decision',
      'block',
    );
    expect(await runHook(f.binding, { ...input, hook_event_name: 'Stop' })).not.toHaveProperty(
      'decision',
    );
  } finally {
    await f.app.close();
    f.store.close();
  }
});
it('migrates legacy selections, isolates concurrent sessions and atomically emits one reminder', async () => {
  const f = await fixture();
  try {
    await f.app.listen({ port: f.port, host: '127.0.0.1' });
    const outbox = new SyncOutbox(f.credentialFile, f.dir, 'codex');
    privateWrite(join(outbox.directory, 'sessions.json'), { legacy: { turnId: 'old' } });
    privateWrite(join(outbox.directory, 'selection.json'), { legacy: { streamId: f.stream.id } });
    expect(readSession(outbox, 'legacy')).toMatchObject({
      turnId: 'old',
      selected: { streamId: f.stream.id },
    });
    const sessions = ['legacy', 'parallel-1', 'parallel-2'];
    await Promise.all(
      sessions.map((session_id) =>
        runHook(f.binding, {
          hook_event_name: 'UserPromptSubmit',
          session_id,
          turn_id: session_id,
        }),
      ),
    );
    await outbox.flush();
    for (const id of sessions) expect(readSession(outbox, id).turnId).toBe(id);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        runHook(f.binding, { hook_event_name: 'Stop', session_id: 'legacy', turn_id: 'legacy' }),
      ),
    );
    expect(results.filter((r) => 'decision' in r)).toHaveLength(1);
    expect(readFileSync(join(outbox.directory, 'sessions.json'), 'utf8')).toContain('old');
    await selectWork(f.binding, 'legacy', { streamId: f.stream.id });
    expect(readSession(outbox, 'parallel-1').turnId).toBe('parallel-1');
    // The same-session lock also prevents competing local state mutations.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        withSession(outbox, 'locked', (state) => {
          state.occurredAt = (state.occurredAt ?? 0) + 1;
        }),
      ),
    );
    expect(readSession(outbox, 'locked').occurredAt).toBe(5);
  } finally {
    await f.app.close();
    f.store.close();
  }
});
it('rejects stale guidance without enqueuing unsupported events', async () => {
  const f = await fixture();
  try {
    const b = JSON.parse(readFileSync(f.binding, 'utf8'));
    b.version = '1.0.0';
    writeFileSync(f.binding, JSON.stringify(b));
    expect(
      JSON.stringify(
        await runHook(f.binding, { hook_event_name: 'SessionStart', session_id: 'old-client' }),
      ),
    ).toContain('needs updating');
    expect(new SyncOutbox(f.credentialFile, f.dir, 'codex').pending()).toEqual([]);
  } finally {
    await f.app.close();
    f.store.close();
  }
});

it('coordinates independent helper processes without losing the same session state', async () => {
  const f = await fixture();
  try {
    const script = `
      import { SyncOutbox } from './src/workflow/outbox.ts';
      import { withSession } from './src/workflow/session-state.ts';
      const outbox = new SyncOutbox(process.env.TEST_CREDENTIAL_PATH, process.env.TEST_PROJECT_PATH, 'codex');
      for (let i = 0; i < 10; i++) await withSession(outbox, 'process-session', state => { state.occurredAt = (state.occurredAt ?? 0) + 1; });
    `;
    await Promise.all(
      Array.from({ length: 3 }, () =>
        promisify(execFile)(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '-e', script],
          {
            env: {
              ...process.env,
              TEST_CREDENTIAL_PATH: f.credentialFile,
              TEST_PROJECT_PATH: f.dir,
            },
          },
        ),
      ),
    );
    expect(
      readSession(new SyncOutbox(f.credentialFile, f.dir, 'codex'), 'process-session').occurredAt,
    ).toBe(30);
  } finally {
    await f.app.close();
    f.store.close();
  }
});

it('keeps unselected prompts and stop hooks quiet while recovering selection guidance at startup and compaction', async () => {
  const f = await fixture('claude-code');
  try {
    const binding = JSON.parse(readFileSync(f.binding, 'utf8'));
    delete binding.streamId;
    writeFileSync(f.binding, JSON.stringify(binding));
    const session = { session_id: 'untracked-monorepo-chat' };
    for (const hook_event_name of ['UserPromptSubmit', 'Stop', 'Interrupt', 'PostCompact']) {
      expect(await runHook(f.binding, { ...session, hook_event_name })).toEqual({});
    }
    for (const source of ['startup', 'resume', 'compact']) {
      const result = await runHook(f.binding, {
        ...session,
        hook_event_name: 'SessionStart',
        source,
      });
      expect(result.hookSpecificOutput?.additionalContext).toContain(
        'No stream or change is selected',
      );
      expect(result).not.toHaveProperty('decision');
    }
    const outbox = new SyncOutbox(f.credentialFile, f.dir, 'claude-code');
    expect(outbox.pending()).toEqual([]);
    await f.app.listen({ port: f.port, host: '127.0.0.1' });
    await selectWork(f.binding, session.session_id, { streamId: f.stream.id });
    expect(
      (await runHook(f.binding, { ...session, hook_event_name: 'UserPromptSubmit' }))
        .hookSpecificOutput?.additionalContext,
    ).toContain(f.stream.title);
    expect(await runHook(f.binding, { ...session, hook_event_name: 'PostCompact' })).toEqual({});
    expect(readSession(outbox, session.session_id).fullContextLoaded).toBe(false);
    const recovered = await runHook(f.binding, {
      ...session,
      hook_event_name: 'SessionStart',
      source: 'compact',
    });
    expect(recovered.hookSpecificOutput?.additionalContext).toContain('Use the work-inbox skill');
    expect(readSession(outbox, session.session_id).fullContextLoaded).toBe(true);
  } finally {
    await f.app.close();
    f.store.close();
  }
});

it('persists project checkpoint preferences across sessions and setup while honoring session overrides', async () => {
  const f = await fixture();
  try {
    const { runWorkflow } = await import('../src/workflow/index.js');
    await f.app.listen({ port: f.port, host: '127.0.0.1' });
    await runWorkflow([
      'mode',
      '--binding',
      f.binding,
      '--scope',
      'project',
      '--stop-policy',
      'observe',
    ]);
    workflowSetup('install', {
      project: f.dir,
      client: 'codex',
      credentialFile: f.credentialFile,
      helper: join(f.dir, 'helper'),
      serverName: 'fixture',
      streamId: f.stream.id,
    });
    expect(JSON.parse(readFileSync(f.binding, 'utf8')).stopPolicy).toBe('observe');
    for (const session_id of ['fresh-a', 'fresh-b']) {
      await runHook(f.binding, { session_id, hook_event_name: 'SessionStart' });
      const stop = await runHook(f.binding, { session_id, hook_event_name: 'Stop' });
      expect(stop).not.toHaveProperty('decision');
      expect(stop).toHaveProperty('systemMessage', expect.stringContaining('unsynchronized'));
    }
    await setStopPolicy(f.binding, 'session-override', 'checkpoint-once');
    await runHook(f.binding, { session_id: 'session-override', hook_event_name: 'SessionStart' });
    expect(
      await runHook(f.binding, { session_id: 'session-override', hook_event_name: 'Stop' }),
    ).toHaveProperty('decision', 'block');
    expect(
      f.sync
        .list({ id: 'owner', scope: 'owner', ownerId: 'owner' })
        .items.every((s: { needsCheckpoint: number }) => s.needsCheckpoint === 1),
    ).toBe(true);
    await expect(
      runWorkflow(['mode', '--binding', f.binding, '--stop-policy', 'observe']),
    ).rejects.toThrow('session-id');
  } finally {
    await f.app.close();
    f.store.close();
  }
});
