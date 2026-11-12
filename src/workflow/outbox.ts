import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { hash } from '../services/auth.js';
import { ApiError, apiClient, readCredential } from '../shared/client.js';
import { syncEventSchema } from '../shared/sync.js';
import type { z } from 'zod';
export function privateDirectory(path: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error('Sync storage cannot be a symlink.');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}
export function privateWrite(path: string, value: unknown) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error('Sync storage cannot be a symlink.');
  const temp = path + '.' + randomUUID() + '.tmp';
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  // macOS/Linux need the directory entry flushed as well as the file contents.
  if (process.platform !== 'win32') {
    const dir = openSync(dirname(path), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
}
export class SyncOutbox {
  directory: string;
  constructor(
    public credentialFile: string,
    project: string,
    client: string,
    root = process.env.WORK_INBOX_SYNC_HOME ||
      join(homedir(), '.local', 'state', 'work-inbox', 'sync'),
  ) {
    this.directory = privateDirectory(
      join(privateDirectory(root), hash(JSON.stringify([credentialFile, project, client]))),
    );
  }
  path(id: string) {
    return join(this.directory, `${id}.json`);
  }
  enqueue(input: z.input<typeof syncEventSchema>) {
    const event = syncEventSchema.parse(input),
      path = this.path(event.eventId);
    for (const id of event.checkpoint?.reconciles ?? []) {
      const file = join(this.directory, `${id}.conflict`);
      if (existsSync(file)) {
        const old = syncEventSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
        if (
          old.sessionId !== event.sessionId ||
          old.streamId !== event.streamId ||
          old.changeId !== event.changeId
        )
          throw new Error('A reconciliation must belong to the same session and selected work.');
      }
    }
    if (existsSync(path)) {
      if (JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(event))
        throw new Error('Pending event ID has different content.');
    } else privateWrite(path, event);
    return event;
  }
  pending() {
    const order = { start: 0, prompt: 1, compact: 2, checkpoint: 3, stop: 4, interrupt: 5 };
    return readdirSync(this.directory)
      .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
      .map((n) => syncEventSchema.parse(JSON.parse(readFileSync(join(this.directory, n), 'utf8'))))
      .sort(
        (a, b) =>
          a.occurredAt - b.occurredAt ||
          order[a.event] - order[b.event] ||
          a.eventId.localeCompare(b.eventId),
      );
  }
  conflicts() {
    return readdirSync(this.directory)
      .filter((n) => n.endsWith('.conflict'))
      .map((n) => syncEventSchema.parse(JSON.parse(readFileSync(join(this.directory, n), 'utf8'))));
  }
  async flush(
    options: { timeoutMs?: number; budgetMs?: number } = {},
  ): Promise<{ pending: number; busy: boolean; results: unknown[]; conflicts: string[] }> {
    const lock = join(this.directory, 'flush.lock');
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeFileSync(join(lock, 'pid'), String(process.pid), { mode: 0o600 });
    } catch {
      // A crashed helper must not strand the queue. Never steal a live flush.
      try {
        const pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error();
        process.kill(pid, 0);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === 'ESRCH' ||
          Date.now() - statSync(lock).mtimeMs > 30_000
        ) {
          rmSync(lock, { recursive: true, force: true });
          return this.flush(options);
        }
      }
      return {
        pending: this.pending().length,
        busy: true,
        results: [] as unknown[],
        conflicts: this.conflicts().map((e) => e.eventId),
      };
    }
    const results: unknown[] = [],
      conflicts: string[] = [],
      start = Date.now();
    try {
      const request = apiClient(readCredential(this.credentialFile), {
        timeoutMs: options.timeoutMs ?? 1000,
      });
      for (const event of this.pending()) {
        if (Date.now() - start > (options.budgetMs ?? 3500)) break;
        try {
          results.push(await request('/api/sync/events', event));
          for (const id of event.checkpoint?.reconciles ?? []) {
            const file = join(this.directory, `${id}.conflict`);
            if (existsSync(file)) renameSync(file, join(this.directory, `${id}.resolved`));
          }
          rmSync(this.path(event.eventId));
        } catch (error) {
          if (error instanceof ApiError && [400, 403, 404, 409].includes(error.status)) {
            // Preserve rejected content for agent reconciliation; never rebase a
            // stale human decision or silently apply it to a newer request.
            conflicts.push(event.eventId);
            renameSync(this.path(event.eventId), join(this.directory, `${event.eventId}.conflict`));
            continue;
          }
          break;
        }
      }
      const pending = this.pending(),
        rejected = this.conflicts();
      const sessionIds = new Set([
        ...pending.map((e) => e.sessionId),
        ...rejected.map((e) => e.sessionId),
        ...results.map((r) => (r as { session: { sessionId: string } }).session.sessionId),
      ]);
      for (const sessionId of sessionIds) {
        if (Date.now() - start > (options.budgetMs ?? 3500)) break;
        try {
          await request('/api/sync/queue', {
            sessionId,
            pendingWrites: [...pending, ...rejected].filter((e) => e.sessionId === sessionId)
              .length,
            observedAt: Date.now(),
          });
        } catch {
          break;
        }
      }
      return {
        pending: pending.length,
        conflicts: rejected.map((e) => e.eventId),
        busy: false,
        results,
      };
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }
}
