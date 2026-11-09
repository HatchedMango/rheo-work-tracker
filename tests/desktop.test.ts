import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { Auth } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { ConnectionService, connectionConfiguration } from '../src/services/connections.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
import {
  importData,
  recoverImport,
  privateDirectory,
  privateJson,
} from '../src/desktop/storage.js';

let dir: string;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
const origin = 'http://127.0.0.1:4310';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'work-inbox-desktop-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function fixture(root: string) {
  const store = openStore(join(root, 'work.sqlite'));
  const auth = new Auth(store);
  const connections = new ConnectionService(store, {
    origin,
    directory: join(root, 'connections'),
    entry: resolve('dist/mcp/index.js'),
  });
  const setup = connections.create(owner, {
    client: 'codex',
    name: 'Existing agent',
    idempotencyKey: randomUUID(),
  });
  const credentialPath = setup.launch.env.WORK_INBOX_CREDENTIAL_FILE;
  const file = readFileSync(credentialPath, 'utf8');
  const credential = JSON.parse(file);
  const service = new WorkService(store);
  const work = service.create(
    auth.actor(credential.token, 'bearer'),
    createSchema.parse({ title: 'Existing work', objective: 'Preserve the context.' }),
  );
  service.note(owner, work.id, 'Keep this decision.', []);
  return { store, setup, credential, credentialPath, file, work: service.get(owner, work.id) };
}

it('imports work, history, scoped credentials, and connection state without modifying the source', async () => {
  const source = join(dir, 'old .data');
  const root = join(dir, 'new app', 'data');
  privateDirectory(join(dir, 'new app'));
  const f = fixture(source);
  f.store.close();
  const originalDatabase = readFileSync(join(source, 'work.sqlite'));
  await importData(root, source, origin);
  const migrated = openStore(join(root, 'work.sqlite'));
  try {
    expect(new WorkService(migrated).get(owner, f.work.id)).toEqual(f.work);
    expect(new Auth(migrated).actor(f.credential.token, 'bearer').scope).toBe('agent');
    const path = join(root, 'connections', `${f.setup.id}.json`);
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(JSON.parse(f.file)));
    expect(statSync(path).mode & 0o077).toBe(0);
    expect(statSync(root).mode & 0o077).toBe(0);
    expect(
      migrated.raw
        .prepare('SELECT credentialPath FROM agent_connections WHERE id=?')
        .get(f.setup.id),
    ).toEqual({ credentialPath: path });
    expect(readFileSync(f.credentialPath, 'utf8')).toBe(f.file);
    expect(readFileSync(join(source, 'work.sqlite'))).toEqual(originalDatabase);
  } finally {
    migrated.close();
  }
});

it('refuses to overwrite existing work or connections and leaves both installations intact', async () => {
  const source = fixture(join(dir, 'source'));
  const destination = fixture(join(dir, 'destination', 'data'));
  source.store.close();
  destination.store.close();
  await expect(
    importData(join(dir, 'destination', 'data'), join(dir, 'source'), origin),
  ).rejects.toThrow('empty installation');
  const store = openStore(join(dir, 'destination', 'data', 'work.sqlite'));
  try {
    expect(new WorkService(store).get(owner, destination.work.id)).toEqual(destination.work);
  } finally {
    store.close();
  }
});

it('aborts a staged import with a missing active credential before replacing the empty destination', async () => {
  const f = fixture(join(dir, 'source'));
  f.store.close();
  rmSync(f.credentialPath);
  const target = join(dir, 'new', 'data');
  const empty = openStore(join(target, 'work.sqlite'));
  empty.close();
  await expect(importData(target, join(dir, 'source'), origin)).rejects.toThrow(
    'credential is missing',
  );
  expect(existsSync(join(target, 'work.sqlite'))).toBe(true);
  expect(existsSync(join(dir, 'new', 'import-transaction.json'))).toBe(false);
  const store = openStore(join(target, 'work.sqlite'));
  try {
    expect(store.raw.prepare('SELECT count(*) AS n FROM work').get()).toEqual({ n: 0 });
  } finally {
    store.close();
  }
});

it('recovers an interrupted directory swap with database and credentials together', () => {
  const root = join(dir, 'data');
  const stage = join(dir, '.import-interrupted');
  const backup = join(dir, 'backups', 'old-empty-data');
  privateDirectory(join(dir, 'backups'));
  const f = fixture(stage);
  f.store.close();
  privateDirectory(root);
  privateJson(join(dir, 'import-transaction.json'), { stage, backup });
  renameSync(root, backup);
  recoverImport(root);
  expect(existsSync(join(root, 'work.sqlite'))).toBe(true);
  expect(existsSync(join(root, 'connections', `${f.setup.id}.json`))).toBe(true);
  expect(existsSync(stage)).toBe(false);
  expect(existsSync(join(dir, 'import-transaction.json'))).toBe(false);
  recoverImport(root);
});

it('generates standalone desktop MCP configuration without depending on an external Node path', () => {
  const configuration = connectionConfiguration(
    'codex',
    '12345678-1234',
    '/unused/node',
    "/User's files/Work Inbox/bin/work-inbox-mcp",
    '/protected/connection.json',
    true,
  );
  expect(configuration.launch.command).toBe("/User's files/Work Inbox/bin/work-inbox-mcp");
  expect(configuration.launch.args).toEqual([]);
  expect(configuration.configuration).toContain('args = []');
  expect(configuration.setupPrompt).not.toContain('/unused/node');
  expect(configuration.command).toContain("'/User'\\''s files/Work Inbox/bin/work-inbox-mcp'");
});
