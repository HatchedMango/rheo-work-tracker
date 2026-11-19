import { afterEach, beforeEach, it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { workflowSetup, type SetupOptions } from '../src/workflow/setup.js';
let dir: string, o: SetupOptions;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "work-inbox-workflow's "));
  o = {
    project: dir,
    client: 'codex',
    credentialFile: join(dir, 'protected.json'),
    helper: resolve('dist/workflow/index.js'),
    helperNode: process.execPath,
    serverName: 'work-inbox-test',
    scope: 'project',
  };
});
it('personal setup preserves shared instructions and a clean Git diff, including subprojects and worktrees', () => {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.com');
  const original = '# Team rules\nPreserve every instruction.\n';
  writeFileSync(join(dir, 'AGENTS.md'), original);
  writeFileSync(join(dir, 'CLAUDE.md'), original);
  git('add', '.');
  git('commit', '-qm', 'Fixture');
  const project = join(dir, 'packages', 'API [one]');
  mkdirSync(project, { recursive: true });
  for (const client of ['claude-code', 'codex'] as const) {
    const opts = { ...o, project, client, scope: 'personal' as const };
    const before = git('status', '--porcelain', '--untracked-files=all');
    expect(workflowSetup('preview', opts).scope).toBe('personal');
    expect(workflowSetup('install', opts).current).toBe(true);
    expect(workflowSetup('check', opts).current).toBe(true);
    expect(git('status', '--porcelain', '--untracked-files=all')).toBe(before);
    expect(existsSync(join(project, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(project, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(project, 'CLAUDE.local.md'))).toBe(false);
    workflowSetup('remove', opts);
  }
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(original);
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(original);
  const worktree = join(dir, 'linked');
  git('worktree', 'add', '-qb', 'linked', worktree);
  const opts = { ...o, project: worktree, scope: 'personal' as const };
  expect(workflowSetup('install', opts).current).toBe(true);
  expect(execFileSync('git', ['-C', worktree, 'status', '--porcelain'], { encoding: 'utf8' })).toBe(
    '',
  );
  workflowSetup('remove', opts);
  git('worktree', 'remove', '--force', worktree);
});
it('defaults new installs to personal and retains the legacy loading strategy until explicitly migrated', () => {
  const opts = { ...o, scope: undefined };
  expect(workflowSetup('install', opts).scope).toBe('personal');
  expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
  workflowSetup('remove', opts);
  const original = '# Team rules\n';
  writeFileSync(join(dir, 'AGENTS.md'), original);
  workflowSetup('install', o);
  const manifest = join(dir, '.work-inbox/codex.json');
  const legacy = JSON.parse(readFileSync(manifest, 'utf8'));
  delete legacy.scope;
  writeFileSync(manifest, JSON.stringify(legacy));
  expect(workflowSetup('check', opts).scope).toBe('project');
  expect(workflowSetup('install', opts).scope).toBe('project');
  expect(workflowSetup('install', { ...opts, scope: 'personal' }).scope).toBe('personal');
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(original);
  expect(workflowSetup('check', opts).current).toBe(true);
});
it('refuses tracked personal settings instead of hiding or editing them', () => {
  execFileSync('git', ['init', '-q', dir]);
  mkdirSync(join(dir, '.claude'));
  const path = join(dir, '.claude/settings.local.json');
  const original = '{"permissions":{"deny":["Bash(rm *)"]}}';
  writeFileSync(path, original);
  execFileSync('git', ['-C', dir, 'add', '.claude/settings.local.json']);
  const opts = { ...o, client: 'claude-code' as const, scope: 'personal' as const };
  expect(workflowSetup('preview', opts).conflicts.join()).toContain('tracked files');
  expect(() => workflowSetup('install', opts)).toThrow('No changes made');
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(existsSync(join(dir, '.work-inbox/claude-code.json'))).toBe(false);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
it('installs, checks, updates selection, and removes only managed Codex guidance', () => {
  const original = '# Existing instructions\n\nKeep the release process.\n';
  writeFileSync(join(dir, 'AGENTS.md'), original);
  expect(workflowSetup('preview', o).installed).toBe(false);
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(original);
  expect(workflowSetup('install', o).current).toBe(true);
  const installed = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  expect(workflowSetup('check', o)).toMatchObject({
    current: true,
    connectionVerified: false,
    workflowVerified: false,
  });
  workflowSetup('install', o);
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(installed);
  writeFileSync(join(dir, 'AGENTS.md'), '# Human addition\n\n' + installed);
  workflowSetup('install', { ...o, serverName: 'work-inbox-new' });
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('# Human addition');
  workflowSetup('remove', { ...o, serverName: 'work-inbox-new' });
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# Human addition\n\n' + original);
  expect(existsSync(join(dir, '.agents/skills/work-inbox/SKILL.md'))).toBe(false);
});
it('refuses edited sections and files without touching unrelated content', () => {
  workflowSetup('install', o);
  const path = join(dir, '.agents/skills/work-inbox/SKILL.md');
  writeFileSync(path, readFileSync(path, 'utf8') + '\nHuman edits');
  expect(workflowSetup('check', o).conflicts).toHaveLength(1);
  const before = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  expect(() => workflowSetup('install', o)).toThrow('No changes made');
  expect(() => workflowSetup('remove', o)).toThrow('No changes made');
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before);
});
it('merges Claude local hooks and preserves later unrelated settings on update/remove', () => {
  o.client = 'claude-code';
  mkdirSync(join(dir, '.claude'));
  const path = join(dir, '.claude/settings.local.json');
  const existing = {
    permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      SessionStart: [
        { matcher: 'startup', hooks: [{ type: 'command', command: 'echo existing' }] },
      ],
      Stop: [{ hooks: [{ type: 'command', command: 'echo stopped' }] }],
    },
  };
  writeFileSync(path, JSON.stringify(existing));
  workflowSetup('install', o);
  let settings = JSON.parse(readFileSync(path, 'utf8'));
  expect(settings.hooks.SessionStart).toHaveLength(2);
  expect(settings.hooks.Stop).toHaveLength(2);
  expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  expect(settings.permissions).toEqual(existing.permissions);
  settings.model = 'human choice';
  writeFileSync(path, JSON.stringify(settings));
  workflowSetup('install', o);
  settings = JSON.parse(readFileSync(path, 'utf8'));
  expect(settings.hooks.SessionStart).toHaveLength(2);
  expect(settings.model).toBe('human choice');
  expect(settings.hooks.SessionStart[1].hooks[0].command).toContain("'\\''");
  workflowSetup('remove', o);
  settings = JSON.parse(readFileSync(path, 'utf8'));
  expect(settings).toEqual({ ...existing, model: 'human choice' });
  expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
});
it('merges Codex hook events without replacing other integrations and detects changed checkpoint hooks', () => {
  mkdirSync(join(dir, '.codex'));
  const path = join(dir, '.codex/hooks.json');
  const original = {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-herdr' }] }] },
    extra: 'preserve',
  };
  writeFileSync(path, JSON.stringify(original));
  workflowSetup('install', o);
  let cfg = JSON.parse(readFileSync(path, 'utf8'));
  expect(cfg.hooks.Stop).toHaveLength(2);
  expect(cfg.hooks.Interrupt).toHaveLength(1);
  expect(cfg.hooks.Interrupt[0].hooks[0].timeout).toBe(3);
  expect(cfg.extra).toBe('preserve');
  workflowSetup('install', o);
  expect(JSON.parse(readFileSync(path, 'utf8')).hooks.Stop).toHaveLength(2);
  cfg.hooks.Stop[1].hooks[0].command = 'edited';
  writeFileSync(path, JSON.stringify(cfg));
  expect(() => workflowSetup('install', o)).toThrow('Stop hook');
  cfg.hooks.Stop[1].hooks[0].command = JSON.parse(
    readFileSync(join(dir, '.work-inbox/codex.json'), 'utf8'),
  ).hooks.find((h: { event: string }) => h.event === 'Stop').entry.hooks[0].command;
  writeFileSync(path, JSON.stringify(cfg));
  workflowSetup('remove', o);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(original);
});
it('does not overwrite a modified hook or follow project symlinks', () => {
  o.client = 'claude-code';
  workflowSetup('install', o);
  const path = join(dir, '.claude/settings.local.json'),
    settings = JSON.parse(readFileSync(path, 'utf8'));
  settings.hooks.SessionStart[0].hooks[0].command = 'human edit';
  writeFileSync(path, JSON.stringify(settings));
  expect(() => workflowSetup('remove', o)).toThrow('hook');
  const outside = mkdtempSync(join(tmpdir(), 'work-inbox-outside-'));
  try {
    symlinkSync(outside, join(dir, '.agents'));
    expect(() => workflowSetup('install', { ...o, client: 'codex' })).toThrow('symlink');
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
