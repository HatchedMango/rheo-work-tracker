import Database from 'better-sqlite3';
import {
  chmodSync,
  existsSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { openStore } from '../db/index.js';
import { credentialSchema } from '../shared/client.js';
import { shellQuote } from '../services/connections.js';

export class DesktopError extends Error {}
export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
export function privateJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export function recoverImport(root: string) {
  const marker = join(dirname(root), 'import-transaction.json');
  if (!existsSync(marker)) return;
  const { stage, backup } = JSON.parse(readFileSync(marker, 'utf8')) as {
    stage: string;
    backup: string;
  };
  if (
    dirname(stage) !== dirname(root) ||
    !stage.startsWith(join(dirname(root), '.import-')) ||
    dirname(backup) !== join(dirname(root), 'backups')
  )
    throw new DesktopError(
      'Import recovery metadata is invalid. Restore the previous data backup.',
    );
  if (!existsSync(root)) {
    if (existsSync(join(stage, 'work.sqlite'))) renameSync(stage, root);
    else if (existsSync(backup)) renameSync(backup, root);
    else
      throw new DesktopError(
        'Import could not be recovered. The original data folder is unchanged.',
      );
  }
  rmSync(stage, { recursive: true, force: true });
  rmSync(marker);
}

// Stage a consistent SQLite snapshot and all managed credentials before changing
// the destination. The original database, WAL, and credential files stay intact.
export async function importData(root: string, source: string, origin: string) {
  root = resolve(root);
  source = resolve(source);
  if (!existsSync(join(source, 'work.sqlite')))
    throw new DesktopError('That folder does not contain a Work Inbox database.');
  source = realpathSync(source);
  if (root === source || root.startsWith(`${source}${sep}`) || source.startsWith(`${root}${sep}`))
    throw new DesktopError('Choose the previous data folder, not this installation.');
  recoverImport(root);
  privateDirectory(root);
  const destination = join(root, 'work.sqlite');
  if (existsSync(destination)) {
    const current = openStore(destination);
    try {
      const occupied = current.raw
        .prepare(
          `SELECT
        (SELECT count(*) FROM work) + (SELECT count(*) FROM agent_connections) +
        (SELECT count(*) FROM credentials WHERE scope IN ('agent', 'worker')) AS n`,
        )
        .get() as { n: number };
      if (occupied.n)
        throw new DesktopError(
          'This installation already contains work or connections. Import requires an empty installation.',
        );
    } finally {
      current.close();
    }
  }
  const stage = mkdtempSync(join(dirname(root), '.import-'));
  try {
    const original = new Database(join(source, 'work.sqlite'), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      await original.backup(join(stage, 'work.sqlite'));
    } finally {
      original.close();
    }
    const imported = openStore(join(stage, 'work.sqlite'));
    try {
      const rows = imported.raw
        .prepare('SELECT id, credentialPath FROM agent_connections')
        .all() as { id: string; credentialPath: string }[];
      for (const row of rows) {
        // Revoked/cancelled drafts may intentionally have no remaining file.
        if (!existsSync(row.credentialPath)) {
          const credential = imported.raw
            .prepare(
              'SELECT c.revokedAt FROM credentials c JOIN agent_connections a ON a.credentialId=c.id WHERE a.id=?',
            )
            .get(row.id) as { revokedAt: number | null };
          if (credential.revokedAt === null)
            throw new DesktopError(
              'An active connection credential is missing. Restore it before importing.',
            );
          continue;
        }
        let value: Record<string, unknown>;
        try {
          value = JSON.parse(readFileSync(row.credentialPath, 'utf8'));
          credentialSchema.parse(value);
        } catch {
          throw new DesktopError(
            'A connection credential could not be read. The original data has not been changed.',
          );
        }
        privateDirectory(join(stage, 'connections'));
        privateJson(join(stage, 'connections', `${row.id}.json`), { ...value, url: origin });
        imported.raw
          .prepare('UPDATE agent_connections SET credentialPath=? WHERE id=?')
          .run(join(root, 'connections', `${row.id}.json`), row.id);
      }
      if (existsSync(join(source, 'agent.json'))) {
        let value: Record<string, unknown>;
        try {
          value = JSON.parse(readFileSync(join(source, 'agent.json'), 'utf8'));
          credentialSchema.parse(value);
        } catch {
          throw new DesktopError('The previous agent credential could not be read.');
        }
        privateJson(join(stage, 'agent.json'), { ...value, url: origin });
      }
      imported.raw.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      imported.close();
    }
    privateJson(join(stage, 'import.json'), { source, importedAt: Date.now() });
    const backups = join(dirname(root), 'backups');
    privateDirectory(backups);
    const backup = join(backups, `before-import-${Date.now()}`);
    // Swap the database and credentials together. The recovery marker handles a
    // crash between directory renames, without consulting or editing the source.
    const marker = join(dirname(root), 'import-transaction.json');
    privateJson(marker, { stage, backup });
    renameSync(root, backup);
    try {
      renameSync(stage, root);
    } catch (error) {
      renameSync(backup, root);
      throw error;
    }
    rmSync(marker);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function installMcpLauncher(root: string, resources: string) {
  privateDirectory(join(root, 'bin'));
  // One atomic pointer allows app replacement/movement without changing clients.
  const temporary = join(root, `current.${process.pid}`);
  rmSync(temporary, { force: true });
  symlinkSync(resources, temporary);
  renameSync(temporary, join(root, 'current'));
  const launcher = join(root, 'bin', 'work-inbox-mcp');
  const script = `#!/bin/sh\nunset NODE_OPTIONS NODE_PATH\nexport WORK_INBOX_DATA_DIR=${shellQuote(join(root, 'data'))}\nexec ${shellQuote(join(root, 'current/runtime/node'))} ${shellQuote(join(root, 'current/app/dist/mcp/index.js'))} "$@"\n`;
  const pending = `${launcher}.${process.pid}`;
  writeFileSync(pending, script, { mode: 0o700 });
  chmodSync(pending, 0o700);
  renameSync(pending, launcher);
  const workflowLauncher = join(root, 'bin', 'work-inbox-workflow');
  const workflowScript = `#!/bin/sh\nunset NODE_OPTIONS NODE_PATH\nexec ${shellQuote(join(root, 'current/runtime/node'))} ${shellQuote(join(root, 'current/app/dist/workflow/index.js'))} "$@"\n`;
  writeFileSync(`${workflowLauncher}.${process.pid}`, workflowScript, { mode: 0o700 });
  chmodSync(`${workflowLauncher}.${process.pid}`, 0o700);
  renameSync(`${workflowLauncher}.${process.pid}`, workflowLauncher);
  return launcher;
}
