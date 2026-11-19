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
import { reviewWork, beginWork, updateWorkLease } from '../src/workflow/operations.js';
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
