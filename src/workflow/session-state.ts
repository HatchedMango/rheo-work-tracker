import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { hash } from '../services/auth.js';
import { privateDirectory, privateWrite, type SyncOutbox } from './outbox.js';
export type SessionIntent = 'reading' | 'working';
export type StopPolicy = 'checkpoint-once' | 'observe';
export type SessionState = {
  turnId?: string;
  occurredAt?: number;
  selected?: { streamId?: string; changeId?: string };
  stopPolicy?: StopPolicy;
  intent?: SessionIntent;
  intentInitialized?: boolean;
  pendingIntent?: SessionIntent;
  recoveryPrompts?: number;
  maintenanceAfter?: number;
  fullContextLoaded?: boolean;
  selectionKey?: string;
  refresh?: Record<string, string>;
  reminder?: { turnId: string; checkpointAt: number | null };
  begin?: {
    reviewId: string;
    inputHash: string;
    reportId: string;
    sessionId: string;
    token: string;
    changeId: string;
    claimId?: string;
    expiresAt?: number;
  };
};
// Separate private files prevent unrelated chats from overwriting each other.
export function sessionPath(outbox: SyncOutbox, sessionId: string) {
  if (!sessionId || sessionId.length > 200) throw new Error('Invalid client session identity.');
  return join(privateDirectory(join(outbox.directory, 'sessions')), hash(sessionId) + '.json');
}
export function readSession(outbox: SyncOutbox, sessionId: string): SessionState {
  const path = sessionPath(outbox, sessionId);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  // Read-only migration: never rewrite a shared legacy file during parallel hooks.
  const legacy = (file: string) => {
    const path = join(outbox.directory, file);
    const values = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    return Object.hasOwn(values, sessionId) ? values[sessionId] : undefined;
  };
  return { ...legacy('sessions.json'), selected: legacy('selection.json') };
}
export async function withSession<T>(
  outbox: SyncOutbox,
  sessionId: string,
  operation: (state: SessionState) => T | Promise<T>,
): Promise<T> {
  const path = sessionPath(outbox, sessionId),
    lock = path + '.lock',
    deadline = Date.now() + 250;
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeFileSync(join(lock, 'pid'), String(process.pid), { mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Incomplete lock');
        try {
          process.kill(pid, 0);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
            rmSync(lock, { recursive: true, force: true });
            continue;
          }
        }
      } catch {
        // Allow an interrupted lock initialization to recover, never a live owner.
        try {
          if (Date.now() - statSync(lock).mtimeMs > 30_000) {
            rmSync(lock, { recursive: true, force: true });
            continue;
          }
        } catch (error) {
          // The owner may release between our failed read and stat. Retry acquisition.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
      }
      if (Date.now() >= deadline) throw new Error('Session state is busy; retry the helper.');
      await setTimeout(10);
    }
  }
  try {
    const state = readSession(outbox, sessionId);
    const result = await operation(state);
    privateWrite(path, state);
    return result;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
export function eventTime(state: SessionState) {
  return (state.occurredAt = Math.max(Date.now(), (state.occurredAt ?? 0) + 1));
}
