import { it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../src/db/index.js';
import { Auth } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { OversightService } from '../src/services/oversight.js';
import { SyncService } from '../src/services/sync.js';
import { WorkChatService } from '../src/services/work-chat.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
import { codexDraftLink } from '../src/shared/session-navigation.js';
import { conversationLink } from '../src/shared/conversation.js';
let store: ReturnType<typeof openStore>,
  streams: StreamService,
  sync: SyncService,
  chats: WorkChatService,
  agent: Actor,
  project: string;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
beforeEach(() => {
  store = openStore(':memory:');
  streams = new StreamService(new WorkService(store));
  sync = new SyncService(new OversightService(streams));
  chats = new WorkChatService(streams);
  const auth = new Auth(store);
  agent = auth.actor(auth.register('agent', 'Agent').secret, 'bearer');
  project = mkdtempSync(join(tmpdir(), "work chat ' $()-"));
});
afterEach(() => {
  store.close();
  rmSync(project, { recursive: true, force: true });
});
const stream = () =>
  streams.submit(agent, {
    title: 'Selected stream',
    outcome: 'Stay focused',
    idempotencyKey: randomUUID(),
  });
const change = (streamId?: string) =>
  streams.work.create(
    agent,
    createSchema.parse({
      title: 'Selected change',
      objective: 'Implement only this change',
      streamId,
    }),
  );
function start(
  streamId: string,
  changeId?: string,
  client: 'codex' | 'claude-code' = 'codex',
  sessionId = randomUUID(),
) {
  return sync.event(agent, {
    streamId,
    changeId,
    client,
    sessionId,
    project,
    turnId: 'one',
    event: 'start',
    occurredAt: Date.now(),
    eventId: randomUUID(),
  });
}
it('starts new changes fresh with current context and does not reuse another change’s thread or mutate work', () => {
  const s = stream(),
    first = change(s.id),
    next = change(s.id);
  start(s.id, first.id);
  const before = store.raw.prepare('SELECT * FROM workflow_sessions').all();
  const result = chats.prepare(owner, next.id);
  expect(result).toMatchObject({
    mode: 'start',
    destination: { project },
    sessionId: null,
    projectRequired: false,
  });
  expect(result.brief).toContain(next.id);
  expect(result.brief).not.toContain(first.id);
  expect(new URL(result.draftUrl!).searchParams.get('prompt')).toBe(result.brief);
  expect(new URL(result.draftUrl!).searchParams.get('path')).toBe(project);
  expect(streams.work.get(owner, next.id).tracking.progress).toBe('unreported');
  expect(store.raw.prepare('SELECT * FROM workflow_sessions').all()).toEqual(before);
  expect(
    store.raw.prepare('SELECT COUNT(*) n FROM session_work WHERE changeId=?').get(next.id),
  ).toEqual({ n: 0 });
});
it('resumes only the same change’s selected session, refreshes current reports and avoids revoked clients', () => {
  const s = stream(),
    w = change(s.id);
  const native = randomUUID();
  start(s.id, w.id, 'codex', native);
  streams.updateChange(agent, w.id, {
    revision: 1,
    progress: 'working',
    progressNote: 'Latest approach',
  });
  const result = chats.prepare(owner, w.id);
  expect(result).toMatchObject({
    mode: 'resume',
    sessionId: native,
    draftUrl: null,
    conversationUrl: `codex://threads/${native}`,
  });
  expect(result.brief).toContain('Latest approach');
  store.raw
    .prepare('UPDATE credentials SET revokedAt=? WHERE id=?')
    .run(Date.now(), agent.credentialId);
  expect(chats.prepare(owner, w.id)).toMatchObject({
    mode: 'start',
    sessionId: null,
    projectRequired: true,
  });
});
it('keeps ambiguous/missing project selection explicit and rejects unavailable or relative folders', () => {
  const s = stream(),
    w = change(s.id);
  expect(chats.prepare(owner, w.id).projectRequired).toBe(true);
  expect(() => chats.prepare(owner, w.id, { project: './repo' })).toThrow('absolute');
  expect(() => chats.prepare(owner, w.id, { project: '/not-present-project-7f8127' })).toThrow(
    'unavailable',
  );
  expect(chats.prepare(owner, w.id, { project, client: 'codex' }).draftUrl).toContain(
    'codex://new?',
  );
  expect(() => chats.prepare(agent, w.id)).toThrow('Only the owner');
  streams.updateChange(agent, w.id, { revision: 1, progress: 'delivered' });
  expect(() => chats.prepare(owner, w.id)).toThrow('already finished');
});
it('prepares safely quoted Claude commands for fresh and same-task resume, with no shell execution', () => {
  const s = stream(),
    a = change(s.id),
    b = change(s.id);
  start(s.id, a.id, 'claude-code');
  const fresh = chats.prepare(owner, b.id);
  expect(fresh.mode).toBe('start');
  expect(fresh.command).toContain('cd -- ');
  expect(fresh.command).toContain("'\\''");
  expect(fresh.command).not.toContain('--resume');
  const resume = chats.prepare(owner, a.id);
  expect(resume.command).toContain('--resume');
  expect(resume.draftUrl).toBeNull();
});
it('keeps draft links separate from stored content links and round-trips hostile-looking prompt text', () => {
  const prompt = 'Explain $(touch nope) & <script> x " \'\n# question';
  const link = codexDraftLink(prompt, project)!;
  expect(new URL(link).searchParams.get('prompt')).toBe(prompt);
  expect(conversationLink(link)).toBeNull();
  expect(codexDraftLink('x', 'relative')).toBeNull();
  expect(codexDraftLink('x'.repeat(8001), project)).toBeNull();
});

it('starts fresh after a chat switches to different work and rejects session IDs that look like CLI options', () => {
  const s = stream(),
    a = change(s.id),
    b = change(s.id),
    native = randomUUID();
  const first = start(s.id, a.id, 'codex', native);
  sync.event(agent, {
    streamId: s.id,
    changeId: b.id,
    sessionId: native,
    project,
    client: 'codex',
    turnId: 'two',
    event: 'start',
    eventId: randomUUID(),
    occurredAt: first.session.lastEventAt + 1,
  });
  expect(chats.prepare(owner, a.id).mode).toBe('start');
  start(s.id, a.id, 'claude-code', '--dangerous-option' as ReturnType<typeof randomUUID>);
  expect(chats.prepare(owner, a.id)).toMatchObject({ mode: 'start', sessionId: null });
});
it('does not guess a project when the stream spans multiple project folders', () => {
  const s = stream(),
    a = change(s.id),
    b = change(s.id);
  start(s.id, a.id);
  const second = mkdtempSync(join(tmpdir(), 'work-chat-second-'));
  try {
    sync.event(agent, {
      streamId: s.id,
      client: 'codex',
      sessionId: randomUUID(),
      project: second,
      turnId: 'one',
      event: 'start',
      eventId: randomUUID(),
      occurredAt: Date.now(),
    });
    expect(chats.prepare(owner, b.id)).toMatchObject({
      mode: 'start',
      projectRequired: true,
      draftUrl: null,
    });
  } finally {
    rmSync(second, { recursive: true, force: true });
  }
});
it('protects both handoff endpoints from agent credentials and requires browser-origin protection for preparation', async () => {
  const { createApp } = await import('../src/server/app.js');
  const {
    app,
    auth,
    streams: otherStreams,
  } = await createApp(store, { origin: 'http://127.0.0.1:4310' });
  try {
    const credential = auth.register('agent', 'API agent');
    const source = auth.actor(credential.secret, 'bearer');
    const w = otherStreams.work.create(
      source,
      createSchema.parse({ title: 'API work', objective: 'Start safely' }),
    );
    const headers = {
      host: '127.0.0.1:4310',
      authorization: `Bearer ${credential.secret}`,
      'content-type': 'application/json',
    };
    expect((await app.inject({ url: `/api/work/${w.id}/chat`, headers })).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/work/${w.id}/chat`,
          headers,
          payload: { project, client: 'codex' },
        })
      ).statusCode,
    ).toBe(403);
    const session = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: {
        host: headers.host,
        origin: 'http://127.0.0.1:4310',
        'content-type': 'application/json',
      },
      payload: {},
    });
    const cookie = session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/work/${w.id}/chat`,
          headers: { host: headers.host, cookie, 'content-type': 'application/json' },
          payload: { project },
        })
      ).statusCode,
    ).toBe(403);
    const result = await app.inject({
      method: 'POST',
      url: `/api/work/${w.id}/chat`,
      headers: {
        host: headers.host,
        cookie,
        origin: 'http://127.0.0.1:4310',
        'content-type': 'application/json',
      },
      payload: { project, client: 'codex' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().mode).toBe('start');
  } finally {
    await app.close();
  }
});
