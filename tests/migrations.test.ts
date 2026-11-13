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
    store.raw
      .prepare("UPDATE assignments SET state='proposed' WHERE workId IN (?,?,?,?)")
      .run(bypassed.id, blocked.id, existingInbox.id, resolved.id);
    service.notify(existingInbox.id, 'assignment');
    service.notify(resolved.id, 'assignment');
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
    ).toEqual([]);
    for (const w of [bypassed, blocked]) {
      const detail = migrated.get(owner, w.id);
      expect(detail.attention).toHaveLength(0);
      expect(detail.assignment?.state).toBe('proposed');
      expect(detail.ownerId).toBeNull();
      expect(detail.revision).toBe(2);
      expect(detail.events.filter((e) => e.type === 'assignment_requested')).toHaveLength(1);
      // Creation and migration can share a millisecond; inspect provenance of
      // the migration event without assuming its position among tied events.
      expect(detail.events.find((e) => e.type === 'assignment_requested')?.actorName).toBe(
        'Work Inbox',
      );
    }
    expect(migrated.get(owner, bypassed.id).events).toEqual(expect.arrayContaining(originalEvents));
    for (const detail of untouched) expect(migrated.get(owner, detail.id)).toEqual(detail);
    store.close();
    store = openStore(path);
    expect(new WorkService(store).get(owner, bypassed.id).attention).toHaveLength(0);
    expect(new WorkService(store).get(owner, bypassed.id).events).toHaveLength(
      originalEvents.length + 1,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('adds unknown, ungrouped tracking to legacy work without changing IDs, credentials or history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'work-inbox-stream-migration-')),
    path = join(dir, 'work.sqlite');
  let store = openStore(path);
  const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
  try {
    const auth = new Auth(store),
      credential = auth.register('agent', 'Existing agent'),
      agent = auth.actor(credential.secret, 'bearer'),
      service = new WorkService(store);
    const old = service.create(
      agent,
      createSchema.parse({
        title: 'Existing work',
        objective: 'Keep this work and history.',
        idempotencyKey: 'legacy',
      }),
    );
    service.note(agent, old.id, 'An existing note.', []);
    store.raw.prepare("UPDATE assignments SET state='proposed' WHERE workId=?").run(old.id);
    const before = service.get(owner, old.id);
    // Recreate the pre-stream schema after capturing real legacy records.
    store.raw.pragma('foreign_keys=OFF');
    store.raw.exec('DROP TRIGGER changes_node');
    for (const table of [
      'stream_outputs',
      'flow_dependencies',
      'oversight_nodes',
      'human_actions',
      'stream_approvals',
      'workflow_reads',
      'collaboration_claims',
      'change_outputs',
      'stream_context',
      'change_dependencies',
      'change_meta',
      'stream_events',
      'streams',
    ])
      store.raw.exec(`DROP TABLE ${table}`);
    store.raw.prepare('DELETE FROM schema_migrations WHERE name=?').run('0005_streams.sql');
    store.raw.prepare('DELETE FROM schema_migrations WHERE name=?').run('0006_oversight.sql');
    store.raw.prepare('DELETE FROM schema_migrations WHERE name=?').run('0008_simple_tracking.sql');
    store.close();
    store = openStore(path);
    const after = new WorkService(store).get(owner, old.id);
    const { tracking, ...unchanged } = after;
    const { tracking: _, ...original } = before;
    expect(unchanged).toEqual(original);
    expect(tracking).toMatchObject({
      streamId: null,
      assessmentState: 'unknown',
      outputs: [],
      claim: null,
    });
    expect(new Auth(store).actor(credential.secret, 'bearer').id).toBe(agent.id);
    expect(store.raw.prepare('SELECT count(*) n FROM streams').get()).toEqual({ n: 0 });
    expect(
      new WorkService(store).create(
        agent,
        createSchema.parse({
          title: 'Existing work',
          objective: 'Keep this work and history.',
          idempotencyKey: 'legacy',
        }),
      ).id,
    ).toBe(old.id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('upgrades a real v5 schema preserving legacy rows and credentials without inventing approvals', async () => {
  const { default: Database } = await import('better-sqlite3'),
    { readFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'work-inbox-v5-')),
    path = join(dir, 'work.sqlite');
  let raw = new Database(path);
  let migrated: ReturnType<typeof openStore> | undefined;
  try {
    raw.pragma('foreign_keys=ON');
    raw.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)');
    for (const name of [
      '0001_initial.sql',
      '0002_agent_connections.sql',
      '0003_connection_completion.sql',
      '0004_inbox_intake.sql',
      '0005_streams.sql',
    ]) {
      raw.exec(readFileSync(new URL('../src/db/migrations/' + name, import.meta.url), 'utf8'));
      raw.prepare('INSERT INTO schema_migrations VALUES (?)').run(name);
    }
    raw.exec(
      "INSERT INTO workspaces VALUES ('local','Local');INSERT INTO actors(id,workspaceId,kind,name,ownerId) VALUES ('owner','local','person','You','owner'),('fixture','local','agent','Fixture','owner')",
    );
    raw.exec(
      "INSERT INTO work(id,workspaceId,createdBy,ownerId,title,objective,acceptanceCriteria,priority,lifecycle,revision,createdAt,updatedAt) VALUES ('legacy','local','fixture','owner','Existing output','Preserve content','[]','normal','open',4,100,200);INSERT INTO assignments VALUES ('assignment','legacy','owner','accepted',150);INSERT INTO change_meta(workId) VALUES ('legacy');INSERT INTO streams(id,workspaceId,createdBy,title,outcome,constraints,context,state,createdAt,updatedAt) VALUES ('old-stream','local','fixture','Existing stream','Outcome','','','active',100,200);INSERT INTO credentials VALUES ('credential','fixture','retained-hash','agent',100,NULL,NULL);INSERT INTO events VALUES ('event','legacy','fixture','created','Preserve history','{}','[]',100)",
    );
    const tables = ['work', 'assignments', 'credentials', 'events'];
    const before = tables.map((t) => raw.prepare(`SELECT * FROM ${t}`).all());
    raw.close();
    migrated = openStore(path);
    for (let i = 0; i < tables.length; i++)
      expect(migrated.raw.prepare(`SELECT * FROM ${tables[i]}`).all()).toEqual(before[i]);
    expect(migrated.raw.prepare('SELECT count(*) n FROM stream_approvals').get()).toEqual({ n: 0 });
    expect(
      migrated.raw.prepare('SELECT parentId,approvalId,coverageApprovalId FROM streams').get(),
    ).toEqual({ parentId: null, approvalId: null, coverageApprovalId: null });
    expect(migrated.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    if (raw.open) raw.close();
    migrated?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('preserves every existing column and historical decision when adding simple tracking and chat links', () => {
  const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
  const dir = mkdtempSync(join(tmpdir(), 'work-inbox-tracking-migration-')),
    path = join(dir, 'work.sqlite');
  let store = openStore(path);
  try {
    const auth = new Auth(store),
      agent = auth.actor(auth.register('agent', 'Existing agent').secret, 'bearer');
    const work = new WorkService(store);
    const rows = ['proposed', 'accepted', 'declined'].map((state) => {
      const w = work.create(
        agent,
        createSchema.parse({ title: state, objective: 'Preserve this decision' }),
      );
      store.raw.prepare('UPDATE assignments SET state=? WHERE workId=?').run(state, w.id);
      return w;
    });
    store.raw.exec(
      'ALTER TABLE stream_context DROP COLUMN conversationUrl; ALTER TABLE human_actions DROP COLUMN conversationUrl',
    );
    store.raw.prepare('DELETE FROM schema_migrations WHERE name=?').run('0008_simple_tracking.sql');
    const names = (
      store.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='schema_migrations'",
        )
        .all() as { name: string }[]
    ).map((x) => x.name);
    const snapshots = names.map((name) => ({
      name,
      columns: (store.raw.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
      rows: store.raw.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    }));
    store.close();
    store = openStore(path);
    for (const snapshot of snapshots)
      expect(
        store.raw
          .prepare(
            `SELECT ${snapshot.columns.map((c) => '"' + c + '"').join(',')} FROM "${snapshot.name}" ORDER BY rowid`,
          )
          .all(),
      ).toEqual(snapshot.rows);
    expect(store.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(store.raw.prepare('SELECT count(*) n FROM stream_approvals').get()).toEqual({ n: 0 });
    expect(new WorkService(store).get(owner, rows[0].id).assignment?.state).toBe('proposed');
    store.close();
    store = openStore(path);
    expect(new WorkService(store).get(owner, rows[1].id).assignment?.state).toBe('accepted');
    expect(new WorkService(store).get(owner, rows[2].id).assignment?.state).toBe('declined');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('adds explicit assessment storage without rewriting old work, claims, credentials or legacy assessments', async () => {
  const { createHash } = await import('node:crypto');
  const { StreamService } = await import('../src/services/streams.js');
  const dir = mkdtempSync(join(tmpdir(), 'work-inbox-assessment-migration-')),
    path = join(dir, 'work.sqlite');
  let store = openStore(path);
  try {
    const auth = new Auth(store),
      agent = auth.actor(auth.register('agent', 'Existing source').secret, 'bearer'),
      work = new WorkService(store),
      streams = new StreamService(work);
    const s = streams.submit(agent, {
      title: 'Existing stream',
      outcome: 'Existing goal',
      idempotencyKey: 'existing',
    });
    const w = work.create(
      agent,
      createSchema.parse({
        title: 'Existing change',
        objective: 'Existing purpose',
        streamId: s.id,
      }),
    );
    streams.updateChange(agent, w.id, {
      revision: 1,
      assessDependencies: true,
      assessmentFingerprint: w.tracking.assessmentFingerprint,
    });
    store.raw.exec('DROP TABLE implementation_claims; DROP TABLE dependency_assessments');
    store.raw
      .prepare('DELETE FROM schema_migrations WHERE name=?')
      .run('0009_dependency_assessments.sql');
    const names = (
      store.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='schema_migrations'",
        )
        .all() as { name: string }[]
    ).map((x) => x.name);
    const digest = (name: string) =>
      createHash('sha256')
        .update(
          JSON.stringify(store.raw.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()),
        )
        .digest('hex');
    const before = new Map(names.map((n) => [n, digest(n)]));
    store.close();
    store = openStore(path);
    for (const [name, hash] of before) expect(digest(name)).toBe(hash);
    expect(store.raw.prepare('SELECT count(*) n FROM dependency_assessments').get()).toEqual({
      n: 0,
    });
    expect(new WorkService(store).get(agent, w.id).tracking.dependencyAssessment.state).toBe(
      'legacy',
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
