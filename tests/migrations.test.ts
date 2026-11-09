import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/db/index.js';
import { Auth } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { createSchema, listSchema, type Actor } from '../src/shared/contracts.js';

it('recovers legacy undecided intake once while preserving decisions, closed work, and history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'work-inbox-migration-'));
  const path = join(dir, 'work.sqlite');
  let store = openStore(path);
  const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
  try {
    const auth = new Auth(store);
    const source = auth.actor(auth.register('agent', 'Legacy source').secret, 'bearer');
    const service = new WorkService(store);
    const create = (title: string) =>
      service.create(source, createSchema.parse({ title, objective: title }));
    const bypassed = create('Legacy backlog');
    const blocked = create('Blocked legacy backlog');
    const existingInbox = create('Already in inbox');
    const accepted = create('Accepted');
    const declined = create('Declined');
    const completed = create('Completed');
    const cancelled = create('Cancelled');
    const resolved = create('Previously resolved attention');
    const action = (id: string, action: 'accept' | 'decline' | 'complete' | 'cancel') =>
      service.action(owner, id, { action, revision: service.get(owner, id).revision, message: '' });
    action(accepted.id, 'accept');
    action(declined.id, 'decline');
    action(completed.id, 'accept');
    action(completed.id, 'complete');
    action(cancelled.id, 'cancel');
    // Recreate the old storage state without rewriting append-only event history.
    store.raw.prepare('DELETE FROM attention WHERE workId = ?').run(bypassed.id);
    store.raw.prepare('DELETE FROM attention WHERE workId = ?').run(blocked.id);
    store.raw.prepare("UPDATE work SET lifecycle = 'blocked' WHERE id = ?").run(blocked.id);
    store.raw.prepare('UPDATE attention SET resolvedAt = 1000 WHERE workId = ?').run(resolved.id);
    const originalEvents = service.get(owner, bypassed.id).events;
    const untouched = [existingInbox, accepted, declined, completed, cancelled, resolved].map((w) =>
      service.get(owner, w.id),
    );
    store.raw.prepare('DELETE FROM schema_migrations WHERE name = ?').run('0004_inbox_intake.sql');
    store.close();
    store = openStore(path);
    const migrated = new WorkService(store);
    expect(
      migrated
        .list(owner, listSchema.parse({ view: 'inbox' }))
        .items.map((w) => w.id)
        .sort(),
    ).toEqual([bypassed.id, blocked.id, existingInbox.id].sort());
    for (const w of [bypassed, blocked]) {
      const detail = migrated.get(owner, w.id);
      expect(detail.attention).toHaveLength(1);
      expect(detail.assignment?.state).toBe('proposed');
      expect(detail.ownerId).toBeNull();
      expect(detail.revision).toBe(2);
      expect(detail.events.filter((e) => e.type === 'assignment_requested')).toHaveLength(1);
      expect(detail.events[0].actorName).toBe('Work Inbox');
    }
    expect(migrated.get(owner, bypassed.id).events).toEqual(expect.arrayContaining(originalEvents));
    for (const detail of untouched) expect(migrated.get(owner, detail.id)).toEqual(detail);
    store.close();
    store = openStore(path);
    expect(new WorkService(store).get(owner, bypassed.id).attention).toHaveLength(1);
    expect(new WorkService(store).get(owner, bypassed.id).events).toHaveLength(
      originalEvents.length + 1,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
