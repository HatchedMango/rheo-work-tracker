import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  cpSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openStore } from '../dist/db/index.js';
import { Auth } from '../dist/services/auth.js';
import { WorkService } from '../dist/services/work.js';
import { ConnectionService } from '../dist/services/connections.js';
import { shellQuote } from '../dist/services/connections.js';
import { createSchema } from '../dist/shared/contracts.js';

if (process.platform !== 'darwin') throw new Error('Run desktop verification on macOS.');
const keychainFixture = mkdtempSync(join(tmpdir(), 'rheo-keychain-verify-'));
try {
  const helper = join(keychainFixture, 'rheo-keychain');
  execFileSync(
    'xcrun',
    ['swiftc', '-D', 'RHEO_TEST_KEYCHAIN', 'desktop/Keychain.swift', '-o', helper],
    { stdio: 'pipe' },
  );
  execFileSync('/usr/bin/swift', ['desktop/VerifyKeychain.swift', keychainFixture, helper], {
    stdio: 'inherit',
  });
} finally {
  rmSync(keychainFixture, { recursive: true, force: true });
}
// Exercise the exact native navigation validator, including the narrow unsent-draft route.
const nativeValidator = readFileSync('desktop/InboxWindow.swift', 'utf8').split(
  '// Only the loopback application',
)[0];
execFileSync(
  '/usr/bin/swift',
  [
    '-e',
    nativeValidator +
      `
let valid = "codex://new?prompt=Start%20this%20work&path=%2Ftmp"
assert(allowedChatDestination(URL(string:valid)!))
assert(allowedChatDestination(URL(string:"codex://threads/00000000-0000-4000-8000-000000000000")!))
for rejected in ["codex://settings", "codex://new?prompt=x&path=relative", "codex://new?prompt=x&path=%2Ftmp&command=run", "codex://new?prompt=x&prompt=y", "codex://new?prompt=x&path=%2Ftmp#run", "codex://threads/00000000-0000-4000-8000-000000000000?prompt=run"] {
 assert(!allowedChatDestination(URL(string:rejected)!))
}
`,
  ],
  { stdio: 'pipe' },
);
console.log('PASS: native existing-chat and unsent-draft allowlist rejects other routes.');
const app = resolve('release/Rheo.app');
assert(existsSync(app), 'Build the desktop app first.');
assert(existsSync(join(app, 'Contents/Resources/app/dist/native/rheo-keychain')));
for (const name of ['LICENSE', 'NOTICE']) {
  const source = readFileSync(name, 'utf8');
  for (const directory of ['Contents/Resources', 'Contents/Resources/app'])
    assert.equal(
      readFileSync(join(app, directory, name), 'utf8'),
      source,
      `Preserve project ${name}.`,
    );
}
assert.equal(
  JSON.parse(readFileSync(join(app, 'Contents/Resources/app/package.json'), 'utf8')).license,
  JSON.parse(readFileSync('package.json', 'utf8')).license,
);
for (const [name, version] of [
  ['abstract-logging', '2.0.1'],
  ['drizzle-orm', '0.45.4'],
]) {
  const source = readFileSync(join('third-party-notices', `${name}-${version}`, 'LICENSE'), 'utf8');
  for (const path of [`licenses/${name}-${version}/LICENSE`, `app/node_modules/${name}/LICENSE`])
    assert.equal(readFileSync(join(app, 'Contents/Resources', path), 'utf8'), source);
}
for (const [name, version] of [
  ['emoji-regex', '10.6.0'],
  ['jsesc', '3.1.0'],
])
  assert.equal(
    readFileSync(
      join(app, 'Contents/Resources/licenses', `${name}-${version}`, 'LICENSE-MIT.txt'),
      'utf8',
    ),
    readFileSync(join('node_modules', name, 'LICENSE-MIT.txt'), 'utf8'),
  );
const bundleInfo = JSON.parse(
  execFileSync(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ),
);
assert.equal(bundleInfo.CFBundleDisplayName, 'Rheo');
assert.equal(
  bundleInfo.CFBundleIdentifier,
  'com.workinbox.desktop',
  'Retain the installed app identity across the rename.',
);
assert.equal(bundleInfo.CFBundleExecutable, 'Rheo');
assert(existsSync(join(app, 'Contents/Resources/Rheo.icns')));
assert.deepEqual(
  JSON.parse(readFileSync(join(app, 'Contents/Resources/RheoBrand.json'), 'utf8')),
  JSON.parse(readFileSync('src/shared/brand.json', 'utf8')),
);
const temporary = mkdtempSync(join(tmpdir(), "Work Inbox's verification "));
const source = join(temporary, 'legacy .data');
const desktop = join(temporary, 'Application Support', 'Work Inbox');
const port = await new Promise((done) => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1', () => {
    const { port } = reservation.address();
    reservation.close(() => done(port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const owner = { id: 'owner', scope: 'owner', ownerId: 'owner' };
const store = openStore(join(source, 'work.sqlite'));
store.raw.prepare("UPDATE actors SET name='Work Inbox' WHERE id='system'").run();
const auth = new Auth(store);
const connections = new ConnectionService(store, {
  origin,
  directory: join(source, 'connections'),
  entry: resolve('dist/mcp/index.js'),
});
const setup = connections.create(owner, {
  client: 'codex',
  name: 'Desktop verification agent',
  idempotencyKey: randomUUID(),
});
const originalCredential = JSON.parse(
  readFileSync(setup.launch.env.WORK_INBOX_CREDENTIAL_FILE, 'utf8'),
);
const work = new WorkService(store).create(
  auth.actor(originalCredential.token, 'bearer'),
  createSchema.parse({
    title: 'Desktop migration fixture',
    objective: 'Preserve this isolated test fixture.',
  }),
);
store.close();
const sourceSnapshot = readFileSync(join(source, 'work.sqlite'));
const children = new Set();
function start(bundle, root = desktop, extra = [], nativeEventLoop = false) {
  const child = spawn(
    join(bundle, 'Contents/MacOS/Rheo'),
    [nativeEventLoop ? '--background' : '--headless', ...extra],
    {
      cwd: tmpdir(),
      // No developer PATH, nvm, repository CWD, or external Node installation.
      env: {
        HOME: homedir(),
        PATH: '/usr/bin:/bin',
        TMPDIR: tmpdir(),
        WORK_INBOX_DESKTOP_HOME: root,
        WORK_INBOX_DESKTOP_PORT: String(port),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(75);
  }
  throw new Error(message);
}
function status(root = desktop) {
  try {
    return JSON.parse(readFileSync(join(root, 'desktop-status.json'), 'utf8'));
  } catch {
    return {};
  }
}
async function ready(child, root = desktop) {
  await until(() => {
    if (child.exitCode !== null) {
      const record = status(root);
      throw new Error(`Desktop exited before readiness: ${record.message || child.exitCode}`);
    }
    return status(root).state === 'ready';
  }, 'Bundled service did not become ready.');
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    pause(10000).then(() => {
      throw new Error('Native shutdown timed out.');
    }),
  ]);
}
async function ownerRequest(path, body) {
  const bootstrap = await fetch(`${origin}/api/session`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(bootstrap.status, 200);
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      Cookie: bootstrap.headers.get('set-cookie').split(';')[0],
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert(response.ok, `HTTP ${response.status} for ${path}`);
  return response.json();
}
async function verifyMcp(launch, expectedIds) {
  const client = new Client({ name: 'packaged-desktop-check', version: '1.0' });
  try {
    await client.connect(
      new StdioClientTransport({
        ...launch,
        cwd: tmpdir(),
        env: { ...launch.env, PATH: '/usr/bin:/bin', NODE_OPTIONS: '--invalid-inherited-option' },
        stderr: 'pipe',
      }),
    );
    assert.equal(
      client.getServerVersion()?.version,
      JSON.parse(readFileSync('package.json', 'utf8')).version,
    );
    const result = await client.callTool({ name: 'list_work', arguments: { view: 'all' } });
    assert(!result.isError, 'Packaged MCP list_work failed.');
    const listed = JSON.parse(result.content[0].text);
    assert.deepEqual(listed.items.map((w) => w.id).sort(), expectedIds.sort());
  } finally {
    await client.close();
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
try {
  let native = start(app, desktop, ['--import-data', source]);
  await ready(native);
  const initialPid = status().pid;
  const response = await fetch(`${origin}/api/work?view=all`, {
    headers: { Authorization: `Bearer ${originalCredential.token}` },
  });
  assert.equal(response.status, 200, 'Existing credentials stopped working.');
  assert.equal((await response.json()).items[0].id, work.id);
  const migratedSetup = await ownerRequest(`/api/connections/${setup.id}/setup`);
  assert.equal(migratedSetup.launch.command, join(desktop, 'bin/work-inbox-mcp'));
  assert.deepEqual(migratedSetup.launch.args, []);
  assert.equal(statSync(migratedSetup.launch.env.WORK_INBOX_CREDENTIAL_FILE).mode & 0o077, 0);
  await verifyMcp(migratedSetup.launch, [work.id]);
  console.log('PASS: bundled Node/SQLite, migration, protected credentials, and actual stdio MCP.');
  const streamResponse = await fetch(`${origin}/api/streams`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${originalCredential.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Packaged stream',
      outcome: 'Keep the current outcome across app restarts.',
      idempotencyKey: 'packaged-stream',
    }),
  });
  assert.equal(streamResponse.status, 201);
  const fixtureStream = await streamResponse.json();
  await ownerRequest(`/api/streams/${fixtureStream.id}/actions`, { revision: 1, action: 'accept' });
  const project = join(temporary, 'Project'),
    helper = join(desktop, 'bin/work-inbox-workflow');
  mkdirSync(project);
  writeFileSync(join(project, 'CLAUDE.md'), '# Existing project instructions\n');
  execFileSync('/usr/bin/git', ['-C', project, 'init', '-b', 'fixture-work'], { stdio: 'pipe' });
  const claudeSetup = await ownerRequest('/api/connections', {
    client: 'claude-code',
    name: 'Packaged existing-project agent',
    idempotencyKey: randomUUID(),
  });
  await verifyMcp(claudeSetup.launch, [work.id]);
  await ownerRequest(`/api/connections/${claudeSetup.id}/complete`, {});
  const adoption = await ownerRequest(`/api/connections/${claudeSetup.id}/existing-work`, {
    projects: [project, project],
  });
  assert.equal(adoption.projects.length, 1);
  assert(adoption.projects[0].prompt.includes(claudeSetup.serverName));
  assert(
    adoption.projects[0].prompt.includes(shellQuote(join(desktop, 'bin/work-inbox-workflow'))),
  );
  const adoptionStatus = await ownerRequest(
    `/api/connections/${claudeSetup.id}/existing-work/status`,
    {
      projects: [project],
      since: adoption.preparedAt,
    },
  );
  assert.equal(adoptionStatus.projects[0].contextAt, null);
  assert.equal(adoptionStatus.projects[0].checkpointAt, null);
  assert.equal(
    readFileSync(join(project, 'CLAUDE.md'), 'utf8'),
    '# Existing project instructions\n',
  );
  await ownerRequest(`/api/connections/${claudeSetup.id}/disconnect`, {});
  console.log(
    'PASS: packaged Claude Code connection and existing-project handoff without automatic work or file changes.',
  );
  const workflowArgs = [
    '--project',
    project,
    '--client',
    'claude-code',
    '--credential-file',
    migratedSetup.launch.env.WORK_INBOX_CREDENTIAL_FILE,
    '--helper',
    helper,
    '--server-name',
    migratedSetup.serverName,
    '--stream-id',
    fixtureStream.id,
  ];
  async function workflow(args, input) {
    const child = spawn(helper, args, {
      cwd: tmpdir(),
      env: {
        PATH: '/usr/bin:/bin',
        NODE_OPTIONS: '--invalid-inherited-option',
        WORK_INBOX_SYNC_HOME: join(temporary, 'private-sync'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
    let output = '',
      error = '';
    child.stdout.on('data', (x) => (output += x));
    child.stderr.on('data', (x) => (error += x));
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, error);
    return output;
  }
  const installed = JSON.parse(await workflow(['install', ...workflowArgs]));
  assert(installed.current);
  assert.equal(installed.scope, 'personal');
  assert.equal(installed.defaultIntent, 'reading');
  assert.equal(
    readFileSync(join(project, 'CLAUDE.md'), 'utf8'),
    '# Existing project instructions\n',
    'Personal setup must preserve shared instructions while installed.',
  );
  assert(!installed.workflowVerified);
  const hookSettings = JSON.parse(
    readFileSync(join(project, '.claude/settings.local.json'), 'utf8'),
  );
  assert.equal(hookSettings.hooks.SessionStart.length, 1);
  const context = await workflow([
    'context',
    '--binding',
    join(project, '.work-inbox/claude-code.json'),
  ]);
  assert(context.includes(fixtureStream.outcome));
  assert(!context.includes(originalCredential.token));
  assert(JSON.parse(await workflow(['check', ...workflowArgs])).current);
  assert.equal(hookSettings.hooks.Stop.length, 1);
  const binding = join(project, '.work-inbox/claude-code.json');
  const bound = JSON.parse(
    await workflow([
      'bind',
      '--binding',
      binding,
      '--branch',
      'fixture-work',
      '--stream-id',
      fixtureStream.id,
    ]),
  );
  assert.equal(bound.executionAuthority, false);
  const session = { session_id: 'packaged-native-session' };
  const startHook = JSON.parse(
    await workflow(['hook', '--binding', binding], {
      ...session,
      hook_event_name: 'SessionStart',
      source: 'startup',
    }),
  );
  assert(startHook.hookSpecificOutput.additionalContext.includes(fixtureStream.outcome));
  assert(startHook.hookSpecificOutput.additionalContext.includes('Use the work-inbox skill'));
  assert(startHook.hookSpecificOutput.additionalContext.includes('"source":"branch"'));
  const readingStop = JSON.parse(
    await workflow(['hook', '--binding', binding], { ...session, hook_event_name: 'Stop' }),
  );
  assert.deepEqual(readingStop, {});
  await workflow([
    'mode',
    '--binding',
    binding,
    '--session-id',
    session.session_id,
    '--intent',
    'working',
  ]);
  execFileSync(
    '/usr/bin/git',
    [
      '-C',
      project,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--allow-empty',
      '-qm',
      'Fixture',
    ],
    { stdio: 'pipe' },
  );
  const linked = join(temporary, 'Linked checkout');
  execFileSync('/usr/bin/git', ['-C', project, 'worktree', 'add', '-qb', 'linked-check', linked], {
    stdio: 'pipe',
  });
  const attached = JSON.parse(
    await workflow(['attach', '--binding', binding, '--project', linked, '--operation', 'install']),
  );
  assert(attached.current);
  const attachedBinding = JSON.parse(
    readFileSync(join(linked, '.work-inbox/claude-code.json'), 'utf8'),
  );
  assert.equal(attachedBinding.streamId, undefined);
  assert.equal(attachedBinding.credentialFile, migratedSetup.launch.env.WORK_INBOX_CREDENTIAL_FILE);
  const missingCheckpoint = JSON.parse(
    await workflow(['hook', '--binding', binding], { ...session, hook_event_name: 'Stop' }),
  );
  assert.equal(missingCheckpoint.decision, 'block');
  const repeatedStop = JSON.parse(
    await workflow(['hook', '--binding', binding], { ...session, hook_event_name: 'Stop' }),
  );
  assert.equal(
    repeatedStop.decision,
    undefined,
    'A new helper process must retain reminder suppression',
  );
  const checkpoint = JSON.parse(
    await workflow([
      'checkpoint',
      '--binding',
      binding,
      '--summary',
      'Packaged lifecycle checkpoint verified; no execution started.',
      '--session-id',
      session.session_id,
    ]),
  );
  assert(checkpoint.recorded);
  assert.deepEqual(
    JSON.parse(
      await workflow(['hook', '--binding', binding], { ...session, hook_event_name: 'Stop' }),
    ),
    {},
  );
  await workflow([
    'mode',
    '--binding',
    binding,
    '--session-id',
    session.session_id,
    '--stop-policy',
    'observe',
  ]);
  const promptRefresh = JSON.parse(
    await workflow(['hook', '--binding', binding], {
      ...session,
      hook_event_name: 'UserPromptSubmit',
      turn_id: 'runner-turn',
    }),
  );
  assert(promptRefresh.hookSpecificOutput.additionalContext.includes('"mode":"compact"'));
  const runnerStop = JSON.parse(
    await workflow(['hook', '--binding', binding], {
      ...session,
      hook_event_name: 'Stop',
      turn_id: 'runner-turn',
    }),
  );
  assert.equal(runnerStop.decision, undefined);
  assert.equal(runnerStop.continue, undefined);
  await workflow(['remove', ...workflowArgs]);
  assert.equal(
    readFileSync(join(project, 'CLAUDE.md'), 'utf8'),
    '# Existing project instructions\n',
  );
  console.log(
    'PASS: packaged workflow setup/check/context, lifecycle/checkpoint/recovery and removal with preserved guidance and no external Node.',
  );

  const duplicate = start(app);
  await once(duplicate, 'exit');
  assert.equal(duplicate.exitCode, 0);
  assert.equal(status().pid, initialPid);
  assert(alive(initialPid));
  const conflictingRoot = join(temporary, 'Other installation');
  const conflict = start(app, conflictingRoot);
  await once(conflict, 'exit');
  assert.equal(conflict.exitCode, 1);
  assert.match(status(conflictingRoot).message, /already in use/);
  assert(!existsSync(join(conflictingRoot, 'data/work.sqlite')));
  assert(alive(initialPid));
  await stop(native);
  await until(() => !alive(initialPid), 'Server survived normal native shutdown.');
  assert(!existsSync(join(desktop, 'service.lock')));
  console.log('PASS: duplicate prevention, port-conflict isolation, and clean shutdown.');
  const moved = join(temporary, 'Moved Applications', 'Rheo.app');
  mkdirSync(join(temporary, 'Moved Applications'));
  cpSync(app, moved, { recursive: true });
  native = start(moved);
  await ready(native);
  await verifyMcp(migratedSetup.launch, [work.id]);
  assert.equal(
    (await ownerRequest(`/api/streams/${fixtureStream.id}`)).outcome,
    fixtureStream.outcome,
  );
  const restartedPid = status().pid;
  const nativeExit = once(native, 'exit');
  native.kill('SIGKILL');
  await nativeExit;
  await until(() => !alive(restartedPid), 'Native crash left an orphaned backend.');
  native = start(moved);
  await ready(native);
  await verifyMcp(migratedSetup.launch, [work.id]);
  await stop(native);
  console.log(
    'PASS: persistent work, stable MCP launcher after app movement, parent-crash cleanup, and recovery.',
  );
  const cleanRoot = join(temporary, 'Clean user data');
  native = start(moved, cleanRoot);
  await ready(native, cleanRoot);
  assert.equal((await ownerRequest('/api/work')).total, 0);
  const cleanSetup = await ownerRequest('/api/connections', {
    client: 'codex',
    name: 'Clean install check',
    idempotencyKey: randomUUID(),
  });
  await verifyMcp(cleanSetup.launch, []);
  await stop(native);
  native = start(moved, cleanRoot, [], true);
  await ready(native, cleanRoot);
  const guiChildPid = status(cleanRoot).pid;
  await stop(native);
  await until(() => !alive(guiChildPid), 'AppKit shutdown left the backend running.');
  console.log(
    'PASS: native AppKit background launch and asynchronous Quit complete without a main-queue deadlock.',
  );
  assert.deepEqual(readFileSync(join(source, 'work.sqlite')), sourceSnapshot);
  console.log(
    'PASS: clean first launch and agent setup with no repository or external runtime dependency.',
  );
} finally {
  for (const child of children) await stop(child).catch(() => child.kill('SIGKILL'));
  rmSync(temporary, { recursive: true, force: true });
}
