import { it, expect, afterEach, vi } from 'vitest';
import { realpathSync } from 'node:fs';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { openStore } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';
import { createSchema } from '../src/shared/contracts.js';
import { workflowSetup } from '../src/workflow/setup.js';
import {
  reviewWork,
  beginWork,
  updateWorkLease,
  maintainWorkLease,
} from '../src/workflow/operations.js';
import { runHook, saveCheckpointValue } from '../src/workflow/hooks.js';
import { SyncOutbox } from '../src/workflow/outbox.js';
import { readSession, sessionPath, withSession } from '../src/workflow/session-state.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rheo-operations-')));
  vi.stubEnv('WORK_INBOX_SYNC_HOME', join(dir, 'private-sync'));
  const store = openStore(':memory:');
  const reserve = createServer();
  await new Promise<void>((r) => reserve.listen(0, '127.0.0.1', r));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((r) => reserve.close(() => r()));
  const ctx = await createApp(store, { origin: `http://127.0.0.1:${port}` });
  const url = await ctx.app.listen({ port, host: '127.0.0.1' });
  const credential = ctx.auth.register('agent', 'Fixture');
  const actor = ctx.auth.actor(credential.secret, 'bearer');
  const stream = ctx.streams.submit(actor, {
    title: 'Goal',
    outcome: 'Useful work',
    idempotencyKey: randomUUID(),
  });
  const change = ctx.service.create(
    actor,
    createSchema.parse({ title: 'Change', objective: 'An output', streamId: stream.id }),
  );
  const credentialFile = join(dir, 'credential.json');
  writeFileSync(credentialFile, JSON.stringify({ url, token: credential.secret }), { mode: 0o600 });
  workflowSetup('install', {
    project: dir,
    client: 'codex',
    credentialFile,
    helper: join(dir, 'helper'),
    serverName: 'fixture',
    streamId: stream.id,
    changeId: change.id,
  });
  const binding = join(dir, '.work-inbox/codex.json');
  const session = 'actual-native-session';
  const outbox = new SyncOutbox(credentialFile, dir, 'codex');
  cleanups.push(async () => {
    await ctx.app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...ctx, store, actor, stream, change, dir, binding, session, outbox };
}
function judgment(review: Awaited<ReturnType<typeof reviewWork>>) {
  return {
    reviewId: review.reviewId,
    reviewedIds: review.items.map((i) => i.id),
    coverage: 'complete',
    start: { result: 'none', reason: 'The reviewed scope needs no other output to begin.' },
    deliver: {
      result: 'none',
      reason: 'This output can be delivered independently within the reviewed scope.',
    },
  };
}
it('bundles real full records without assessing, keeps claim credentials private, and replays the existing contracts', async () => {
  const f = await fixture();
  const review = await reviewWork(f.binding, f.session);
  const data = JSON.parse(readFileSync(review.reviewFile, 'utf8'));
  expect(data.records.map((r: { id: string }) => r.id).sort()).toEqual(
    [f.change.id, f.stream.id].sort(),
  );
  expect(f.store.raw.prepare('SELECT count(*) n FROM dependency_assessments').get()).toEqual({
    n: 0,
  });
  expect(statSync(review.reviewFile).mode & 0o777).toBe(0o600);
  const begun = await beginWork(f.binding, f.session, judgment(review));
  const state = readSession(f.outbox, f.session);
  expect(begun.claim.purpose).toBe('implementation');
  expect(JSON.stringify(begun)).not.toContain(state.begin!.token);
  expect(statSync(sessionPath(f.outbox, f.session)).mode & 0o777).toBe(0o600);
  expect((await beginWork(f.binding, f.session, judgment(review))).claim.id).toBe(begun.claim.id);
  expect(f.store.raw.prepare('SELECT count(*) n FROM collaboration_claims').get()).toEqual({
    n: 1,
  });
  await updateWorkLease(f.binding, f.session, false);
  await withSession(f.outbox, f.session, (s) => {
    s.selected = { streamId: f.stream.id };
  });
  await updateWorkLease(f.binding, f.session, true);
  expect(f.service.get(f.actor, f.change.id).tracking.claim?.state).toBe('released');
  expect(f.service.get(f.actor, f.change.id).tracking.progress).not.toBe('delivered');
});
it('rejects missing review IDs, uncertainty and stale scope without inventing readiness', async () => {
  const f = await fixture();
  let review = await reviewWork(f.binding, f.session);
  await expect(
    beginWork(f.binding, f.session, { ...judgment(review), reviewedIds: [f.change.id] }),
  ).rejects.toMatchObject({ status: 400 });
  review = await reviewWork(f.binding, f.session);
  await expect(
    beginWork(f.binding, f.session, {
      ...judgment(review),
      start: {
        result: 'uncertain',
        reason: 'Unknown interface',
        nextStep: 'Read the required interface.',
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.service.get(f.actor, f.change.id).tracking.claim).toBeNull();
  review = await reviewWork(f.binding, f.session);
  f.service.create(
    f.actor,
    createSchema.parse({
      title: 'Related new work',
      objective: 'Review its effect',
      streamId: f.stream.id,
    }),
  );
  await expect(beginWork(f.binding, f.session, judgment(review))).rejects.toMatchObject({
    status: 409,
  });
  expect(f.service.get(f.actor, f.change.id).tracking.claim).toBeNull();
});
it('retains the same private identity after a lost claim response and saves only one claim', async () => {
  const f = await fixture();
  const review = await reviewWork(f.binding, f.session);
  const original = globalThis.fetch;
  let lose = true;
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    if (lose && String(args[0]).endsWith('/claims')) {
      lose = false;
      throw new Error('Response lost');
    }
    return response;
  });
  await expect(beginWork(f.binding, f.session, judgment(review))).rejects.toThrow('Response lost');
  const token = readSession(f.outbox, f.session).begin!.token;
  const result = await beginWork(f.binding, f.session, judgment(review));
  expect(readSession(f.outbox, f.session).begin!.token).toBe(token);
  expect(JSON.stringify(result)).not.toContain(token);
  expect(f.store.raw.prepare('SELECT count(*) n FROM collaboration_claims').get()).toEqual({
    n: 1,
  });
  await updateWorkLease(f.binding, f.session, true);
});
it('releases a just-created claim when explicit selection changes during the request', async () => {
  const f = await fixture();
  const review = await reviewWork(f.binding, f.session);
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    if (String(args[0]).endsWith('/claims'))
      await withSession(f.outbox, f.session, (s) => {
        s.selected = { streamId: f.stream.id };
      });
    return response;
  });
  await expect(beginWork(f.binding, f.session, judgment(review))).rejects.toThrow(
    'Selection changed during claiming',
  );
  expect(f.service.get(f.actor, f.change.id).tracking.claim?.state).toBe('released');
  expect(f.store.raw.prepare('SELECT count(*) n FROM change_completions').get()).toEqual({ n: 0 });
  expect(readSession(f.outbox, f.session).begin).toBeUndefined();
});
it('clears an acknowledged inactive lease without reclaiming or delivering work', async () => {
  const f = await fixture();
  const review = await reviewWork(f.binding, f.session);
  const begun = await beginWork(f.binding, f.session, judgment(review));
  f.store.raw
    .prepare("UPDATE collaboration_claims SET state='expired' WHERE id=?")
    .run(begun.claim.id);
  expect(await updateWorkLease(f.binding, f.session, true)).toMatchObject({
    alreadyInactive: true,
  });
  expect(readSession(f.outbox, f.session).begin).toBeUndefined();
  expect(f.store.raw.prepare('SELECT count(*) n FROM collaboration_claims').get()).toEqual({
    n: 1,
  });
  expect(f.service.get(f.actor, f.change.id).tracking.progress).not.toBe('delivered');
});

it('recovers recorded branch work with session precedence and never guesses from branch names', async () => {
  const f = await fixture();
  const { execFileSync } = await import('node:child_process');
  const { runWorkflow } = await import('../src/workflow/index.js');
  const { runHook, saveCheckpointValue, selectWork, useWorkBinding } =
    await import('../src/workflow/hooks.js');
  const { resolveWorkSelection } = await import('../src/workflow/work-bindings.js');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', f.dir, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-b', 'feature/unfamiliar-name');
  const opts = JSON.parse(readFileSync(f.binding, 'utf8'));
  delete opts.streamId;
  delete opts.changeId;
  writeFileSync(f.binding, JSON.stringify(opts));
  expect(resolveWorkSelection(opts, f.outbox, {}).selected.changeId).toBeUndefined();
  await runWorkflow([
    'bind',
    '--binding',
    f.binding,
    '--branch',
    'feature/unfamiliar-name',
    '--stream-id',
    f.stream.id,
    '--change-id',
    f.change.id,
  ]);
  const context = await runHook(f.binding, {
    session_id: f.session,
    hook_event_name: 'SessionStart',
  });
  expect(context.hookSpecificOutput?.additionalContext).toContain('"source":"branch"');
  expect(
    (await reviewWork(f.binding, f.session)).items.some((item) => item.id === f.change.id),
  ).toBe(true);
  const reviewed = await reviewWork(f.binding, f.session);
  await beginWork(f.binding, f.session, judgment(reviewed));
  expect(statSync(join(f.outbox.directory, 'work-bindings.json')).mode & 0o777).toBe(0o600);
  expect(
    resolveWorkSelection(opts, new SyncOutbox(f.outbox.credentialFile, f.dir, 'claude-code'), {})
      .selected.changeId,
  ).toBeUndefined();
  expect(
    resolveWorkSelection(
      opts,
      new SyncOutbox(join(f.dir, 'different-credential.json'), f.dir, 'codex'),
      {},
    ).selected.changeId,
  ).toBeUndefined();
  const { mkdirSync, copyFileSync } = await import('node:fs');
  const nested = join(f.dir, 'different-worktree');
  mkdirSync(nested);
  execFileSync('git', ['-C', nested, 'init', '-b', 'feature/unfamiliar-name'], { stdio: 'pipe' });
  const different = new SyncOutbox(f.outbox.credentialFile, nested, 'codex');
  copyFileSync(
    join(f.outbox.directory, 'work-bindings.json'),
    join(different.directory, 'work-bindings.json'),
  );
  expect(
    resolveWorkSelection({ ...opts, project: nested }, different, {}).selected.changeId,
  ).toBeUndefined();
  const other = f.streams.submit(f.actor, {
    title: 'Other goal',
    outcome: 'Another output',
    idempotencyKey: randomUUID(),
  });
  await expect(
    runWorkflow([
      'bind',
      '--binding',
      f.binding,
      '--branch',
      'feature/unfamiliar-name',
      '--stream-id',
      other.id,
    ]),
  ).rejects.toThrow('different work binding');
  await selectWork(f.binding, f.session, { streamId: other.id });
  expect(resolveWorkSelection(opts, f.outbox, readSession(f.outbox, f.session)).source).toBe(
    'session',
  );
  await useWorkBinding(f.binding, f.session);
  expect(
    resolveWorkSelection(opts, f.outbox, readSession(f.outbox, f.session)).selected.changeId,
  ).toBe(f.change.id);
  git('symbolic-ref', 'HEAD', 'refs/heads/unbound-branch');
  await expect(
    saveCheckpointValue(f.binding, { summary: 'Wrong branch' }, f.session),
  ).rejects.toThrow('selection required');
  expect(resolveWorkSelection(opts, f.outbox, {}).selected.changeId).toBeUndefined();
  git('symbolic-ref', 'HEAD', 'refs/heads/feature/unfamiliar-name');
  expect(
    (await runHook(f.binding, { session_id: 'brand-new-chat', hook_event_name: 'SessionStart' }))
      .hookSpecificOutput?.additionalContext,
  ).toContain(f.change.id);
  const { renameSync } = await import('node:fs');
  renameSync(join(f.dir, '.git'), join(f.dir, 'git-unavailable'));
  try {
    expect(() => resolveWorkSelection(opts, f.outbox, {})).toThrow('available Git metadata');
    await updateWorkLease(f.binding, f.session, true);
    expect(f.service.get(f.actor, f.change.id).tracking.claim?.state).toBe('released');
  } finally {
    renameSync(join(f.dir, 'git-unavailable'), join(f.dir, '.git'));
  }
  await runWorkflow(['unbind', '--binding', f.binding, '--branch', 'feature/unfamiliar-name']);
  expect(resolveWorkSelection(opts, f.outbox, {}).selected.changeId).toBeUndefined();
});

it('maintains only an acknowledged selected active helper lease near expiry without reclaiming or hiding stale readiness', async () => {
  const f = await fixture();
  const review = await reviewWork(f.binding, f.session);
  const begun = await beginWork(f.binding, f.session, judgment(review));
  expect(readSession(f.outbox, f.session).pendingIntent).toBe('working');
  const near = async () => {
    const at = Date.now() + 30_000;
    f.store.raw
      .prepare('UPDATE collaboration_claims SET expiresAt=? WHERE id=?')
      .run(at, begun.claim.id);
    await withSession(f.outbox, f.session, (s) => {
      s.begin!.expiresAt = at;
      delete s.maintenanceAfter;
    });
    return at;
  };
  expect(await maintainWorkLease(f.binding, f.session)).toBeUndefined();
  const before = await near();
  expect(await maintainWorkLease(f.binding, f.session)).toBe('renewed');
  expect(f.service.get(f.actor, f.change.id).tracking.claim!.expiresAt).toBeGreaterThan(before);
  expect(f.store.raw.prepare('SELECT count(*) n FROM collaboration_claims').get()).toEqual({
    n: 1,
  });
  await near();
  await withSession(f.outbox, f.session, (s) => {
    s.intent = 'reading';
    delete s.pendingIntent;
  });
  expect(await maintainWorkLease(f.binding, f.session)).toBeUndefined();
  await withSession(f.outbox, f.session, (s) => {
    s.intent = 'working';
    s.selected = { streamId: f.stream.id };
  });
  await expect(maintainWorkLease(f.binding, f.session)).rejects.toThrow('select a change');
  await withSession(f.outbox, f.session, (s) => {
    delete s.selected;
  });
  f.service.create(
    f.actor,
    createSchema.parse({
      title: 'New relevant work',
      objective: 'Reassess',
      streamId: f.stream.id,
    }),
  );
  expect(await maintainWorkLease(f.binding, f.session)).toContain('not renewed');
  await near();
  f.store.raw
    .prepare("UPDATE collaboration_claims SET state='expired' WHERE id=?")
    .run(begun.claim.id);
  expect(await maintainWorkLease(f.binding, f.session)).toBe('inactive');
  expect(f.store.raw.prepare('SELECT count(*) n FROM collaboration_claims').get()).toEqual({
    n: 1,
  });
  expect(f.service.get(f.actor, f.change.id).tracking.progress).not.toBe('delivered');
});
it('does not renew a foreign claim or continue after selection drifts during a lease lookup', async () => {
  const f = await fixture();
  const review = await reviewWork(f.binding, f.session);
  const begun = await beginWork(f.binding, f.session, judgment(review));
  await withSession(f.outbox, f.session, (s) => {
    s.begin!.expiresAt = Date.now() + 10_000;
  });
  f.store.raw
    .prepare('UPDATE collaboration_claims SET expiresAt=? WHERE id=?')
    .run(Date.now() + 10_000, begun.claim.id);
  const original = globalThis.fetch;
  let renews = 0;
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).includes('/api/claims/')) renews++;
    const response = await original(...args);
    if (String(args[0]).endsWith('/api/work/' + f.change.id))
      await withSession(f.outbox, f.session, (s) => {
        s.selected = { streamId: f.stream.id };
      });
    return response;
  });
  expect(await maintainWorkLease(f.binding, f.session)).toBeUndefined();
  expect(renews).toBe(0);
  vi.unstubAllGlobals();
  await withSession(f.outbox, f.session, (s) => {
    delete s.selected;
    s.begin!.sessionId = randomUUID();
  });
  expect(await maintainWorkLease(f.binding, f.session)).toBe('inactive');
});

it('promotes managed begin at Stop and renews only during live participation', async () => {
  const f = await fixture();
  const input = { session_id: f.session, hook_event_name: 'SessionStart' };
  await runHook(f.binding, input);
  expect(f.sync.session(f.actor, f.session)?.intent).toBe('reading');
  const review = await reviewWork(f.binding, f.session);
  const begun = await beginWork(f.binding, f.session, judgment(review));
  const at = Date.now() + 30_000;
  f.store.raw
    .prepare('UPDATE collaboration_claims SET expiresAt=? WHERE id=?')
    .run(at, begun.claim.id);
  await withSession(f.outbox, f.session, (s) => {
    s.begin!.expiresAt = at;
  });
  expect(await runHook(f.binding, { ...input, hook_event_name: 'Stop' })).toHaveProperty(
    'decision',
    'block',
  );
  expect(f.service.get(f.actor, f.change.id).tracking.claim!.expiresAt).toBe(at);
  await saveCheckpointValue(f.binding, { summary: 'Actual result and next step' }, f.session);
  const prompt = await runHook(f.binding, { ...input, hook_event_name: 'UserPromptSubmit' });
  expect(prompt.hookSpecificOutput?.additionalContext).toContain('renewed');
  expect(f.service.get(f.actor, f.change.id).tracking.claim!.expiresAt).toBeGreaterThan(at);
  await updateWorkLease(f.binding, f.session, true);
});
