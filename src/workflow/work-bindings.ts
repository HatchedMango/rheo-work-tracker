import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Binding } from './setup.js';
import { privateWrite, type SyncOutbox } from './outbox.js';
import { withSession, type SessionState } from './session-state.js';
import { apiClient, readCredential } from '../shared/client.js';
const selectionSchema = z
  .object({ streamId: z.uuid().optional(), changeId: z.uuid().optional() })
  .strict()
  .refine((s) => !!s.streamId || !!s.changeId, 'Explicit work selection required.');
const registrySchema = z.record(
  z.string(),
  z
    .object({
      worktree: z.string(),
      branch: z.string().min(1).max(300),
      selection: selectionSchema,
    })
    .strict(),
);
function registry(outbox: SyncOutbox) {
  const path = join(outbox.directory, 'work-bindings.json');
  if (!existsSync(path)) return { path, entries: {} as z.infer<typeof registrySchema> };
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 500000 || info.mode & 0o077)
    throw new Error('Work bindings must be a bounded private regular file.');
  return { path, entries: registrySchema.parse(JSON.parse(readFileSync(path, 'utf8'))) };
}
function git(binding: Binding, args: string[]) {
  return execFileSync('git', ['-C', binding.project, ...args], {
    encoding: 'utf8',
    timeout: 1000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function worktree(binding: Binding) {
  return realpathSync(git(binding, ['rev-parse', '--show-toplevel']));
}
export function resolveWorkSelection(binding: Binding, outbox: SyncOutbox, state: SessionState) {
  if (state.selected) return { selected: state.selected, source: 'session' as const };
  const { entries } = registry(outbox);
  if (Object.keys(entries).length) {
    let root: string;
    try {
      root = worktree(binding);
    } catch {
      throw new Error(
        'Recorded work bindings need available Git metadata. Select work explicitly for this session or restore the worktree.',
      );
    }
    let branch = '';
    try {
      branch = git(binding, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    } catch {
      /* Detached HEAD has no branch binding. */
    }
    const entry = entries[JSON.stringify([root, branch])];
    if (entry)
      return { selected: entry.selection, source: 'branch' as const, worktree: root, branch };
  }
  return {
    selected: { streamId: binding.streamId, changeId: binding.changeId },
    source: 'project' as const,
  };
}
export async function bindWork(
  binding: Binding,
  outbox: SyncOutbox,
  branch: string,
  selected?: { streamId?: string; changeId?: string },
) {
  if (!branch || branch.length > 300 || branch.startsWith('-'))
    throw new Error('Use an exact valid Git branch name.');
  git(binding, ['check-ref-format', '--branch', branch]);
  const root = worktree(binding);
  if (selected) {
    selectionSchema.parse(selected);
    // Validate IDs and membership with the existing fixed loopback service, not branch text.
    const request = apiClient(readCredential(binding.credentialFile));
    const context = await request<{ selectionRequired?: boolean }>(
      `/api/context?${new URLSearchParams({ ...Object.fromEntries(Object.entries(selected).filter(([, value]) => value !== undefined)), project: binding.project, limit: '1' })}`,
    );
    if (context.selectionRequired) throw new Error('Explicit work selection required.');
  }
  return withSession(outbox, 'operation-work-bindings', () => {
    const { path, entries } = registry(outbox),
      key = JSON.stringify([root, branch]);
    const previous = entries[key];
    if (selected) {
      if (
        previous &&
        (previous.selection.streamId !== selected.streamId ||
          previous.selection.changeId !== selected.changeId)
      )
        throw new Error(
          'This branch already has a different work binding. Remove it explicitly before replacing it.',
        );
      if (!previous && Object.keys(entries).length >= 1000)
        throw new Error('Too many work bindings; remove obsolete entries first.');
      entries[key] = { worktree: root, branch, selection: selected };
    } else delete entries[key];
    privateWrite(path, entries);
    return {
      worktree: root,
      branch,
      selection: selected ?? null,
      source: 'recorded-binding',
      executionAuthority: false,
    };
  });
}
