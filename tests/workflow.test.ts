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
  };
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
