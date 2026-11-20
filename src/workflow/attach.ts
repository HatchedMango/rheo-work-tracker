import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bindingSchema, workflowSetup } from './setup.js';
import { WORKFLOW_VERSION } from '../shared/streams.js';

// Attach an existing checkout; never create a worktree or copy private connection/session data.
export function attachWorktree(
  bindingPath: string,
  targetPath: string,
  operation: 'preview' | 'install',
) {
  if (lstatSync(bindingPath).isSymbolicLink()) throw new Error('Refusing a symlink binding.');
  const source = bindingSchema.parse(JSON.parse(readFileSync(bindingPath, 'utf8')));
  if (source.version !== WORKFLOW_VERSION) throw new Error('Update the source workflow first.');
  const sourceRoot = realpathSync(source.project),
    target = realpathSync(resolve(targetPath));
  const git = (path: string, arg: string) =>
    realpathSync(
      execFileSync('git', ['-C', path, 'rev-parse', '--path-format=absolute', arg], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    );
  if (
    git(sourceRoot, '--show-toplevel') !== sourceRoot ||
    git(target, '--show-toplevel') !== target ||
    sourceRoot === target ||
    git(sourceRoot, '--git-common-dir') !== git(target, '--git-common-dir')
  )
    throw new Error('Choose a different existing linked worktree of the same Git repository.');
  const targetBinding = join(target, '.work-inbox', `${source.client}.json`);
  if (existsSync(targetBinding)) {
    if (lstatSync(targetBinding).isSymbolicLink()) throw new Error('Refusing a symlink binding.');
    const old = bindingSchema.parse(JSON.parse(readFileSync(targetBinding, 'utf8')));
    if (old.credentialFile !== source.credentialFile || old.serverName !== source.serverName)
      throw new Error('The target already uses a different connection; no changes made.');
    // An already configured target keeps its own selection and policy.
    return workflowSetup(operation, { ...old, project: target });
  }
  return workflowSetup(operation, {
    project: target,
    client: source.client,
    credentialFile: source.credentialFile,
    helper: source.helper,
    helperNode: source.helperNode,
    serverName: source.serverName,
    scope: 'personal',
    stopPolicy: source.stopPolicy,
    defaultIntent: source.defaultIntent ?? 'working',
  });
}
