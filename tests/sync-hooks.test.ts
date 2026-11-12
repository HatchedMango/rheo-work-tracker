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
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
import { workflowSetup } from '../src/workflow/setup.js';
import { runHook, saveCheckpoint } from '../src/workflow/hooks.js';
import { SyncOutbox } from '../src/workflow/outbox.js';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
async function fixture() {
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
    client: 'codex',
    credentialFile,
    helper: join(dir, 'helper'),
    serverName: 'fixture',
    streamId: stream.id,
  });
  const binding = join(dir, '.work-inbox/codex.json');
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
