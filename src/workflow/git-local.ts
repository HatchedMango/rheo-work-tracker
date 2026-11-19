import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

// Personal integration belongs to this checkout, never the team's .gitignore.
export function localExclusions(project: string, paths: string[]) {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', project, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  let root: string;
  try {
    root = git(['rev-parse', '--show-toplevel']);
  } catch {
    return { repository: false, tracked: [], current: true, path: null, content: null };
  }
  const targets = [...new Set(paths)];
  const tracked = targets.filter((path) => {
    try {
      return !!git(['ls-files', '--', path]);
    } catch {
      return false;
    }
  });
  const current = targets.every((path) => {
    try {
      git(['check-ignore', '--no-index', '--', path]);
      return true;
    } catch {
      return false;
    }
  });
  const location = git(['rev-parse', '--git-path', 'info/exclude']);
  const path = isAbsolute(location) ? location : resolve(project, location);
  if (
    (existsSync(path) && lstatSync(path).isSymbolicLink()) ||
    (existsSync(dirname(path)) && lstatSync(dirname(path)).isSymbolicLink())
  )
    throw new Error('Refusing a symlink at the local Git excludes file.');
  const old = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const patterns = targets.map((target) => {
    const rel = relative(root, resolve(project, target));
    if (rel.startsWith('..') || isAbsolute(rel) || /[\r\n]/.test(rel))
      throw new Error('Personal setup paths must stay within the Git worktree.');
    return '/' + rel.replace(/[\\*?[\] ]/g, '\\$&');
  });
  const added = patterns.filter((pattern) => !old.split('\n').includes(pattern));
  return {
    repository: true,
    tracked,
    current,
    path,
    content: current ? old : `${old}${old && !old.endsWith('\n') ? '\n' : ''}${added.join('\n')}\n`,
  };
}
