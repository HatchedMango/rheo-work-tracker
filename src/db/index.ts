import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, readFileSync, chmodSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as schema from './schema.js';
export function openStore(path: string) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
  }
  const raw = new Database(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  raw.pragma('foreign_keys = ON');
  raw.pragma('journal_mode = WAL');
  raw.pragma('busy_timeout = 5000');
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  const migrationDir = new URL('./migrations/', import.meta.url);
  raw
    .transaction(() => {
      for (const name of readdirSync(migrationDir)
        .filter((n) => n.endsWith('.sql'))
        .sort()) {
        if (!raw.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name)) {
          raw.exec(readFileSync(new URL(name, migrationDir), 'utf8'));
          raw.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(name);
        }
      }
    })
    .immediate();
  const db = drizzle(raw, { schema });
  db.insert(schema.workspaces)
    .values({ id: 'local', name: 'Personal workspace' })
    .onConflictDoNothing()
    .run();
  db.insert(schema.actors)
    .values({ id: 'owner', workspaceId: 'local', ownerId: 'owner', kind: 'person', name: 'You' })
    .onConflictDoNothing()
    .run();
  db.insert(schema.actors)
    .values({
      id: 'system',
      workspaceId: 'local',
      ownerId: 'owner',
      kind: 'integration',
      name: 'Work Inbox',
    })
    .onConflictDoNothing()
    .run();
  return { db, raw, close: () => raw.close() };
}
export type Store = ReturnType<typeof openStore>;
