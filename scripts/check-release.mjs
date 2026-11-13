import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
const root = resolve(process.argv[2] ?? 'release');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const stem = `Work-Inbox-${pkg.version}-macOS-arm64`;
const names = [`${stem}.zip`, `${stem}.dmg`, `${stem}.build.json`];
const manifest = readFileSync(join(root, 'SHA256SUMS'), 'utf8').trim().split('\n');
if (manifest.length !== names.length) throw new Error('Unexpected checksum manifest entries.');
for (const name of names) {
  const digest = createHash('sha256')
    .update(readFileSync(join(root, name)))
    .digest('hex');
  if (!manifest.includes(`${digest}  ${name}`)) throw new Error(`Checksum mismatch: ${name}`);
}
const metadata = JSON.parse(readFileSync(join(root, `${stem}.build.json`), 'utf8'));
if (
  metadata.version !== pkg.version ||
  metadata.architecture !== 'arm64' ||
  metadata.platform !== 'darwin' ||
  metadata.minimumMacOS !== '13.0'
)
  throw new Error('Unexpected release target/version.');
if (metadata.sourceDirty !== false || !/^[a-f0-9]{40}$/.test(metadata.sourceCommit ?? ''))
  throw new Error('Publish only a clean Git checkout with known source provenance.');
if (
  metadata.sourceCommit !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
)
  throw new Error('Release source differs from this checkout.');
if (metadata.node !== 'v' + readFileSync('.nvmrc', 'utf8').trim())
  throw new Error('Release runtime does not match .nvmrc.');
const resources = join(root, 'Work Inbox.app/Contents/Resources');
if (
  JSON.stringify(JSON.parse(readFileSync(join(resources, 'BUILD_INFO.json'), 'utf8'))) !==
  JSON.stringify(metadata)
)
  throw new Error('Bundled/sibling build metadata differ.');
let files = 0;
function inspect(directory) {
  for (const item of readdirSync(directory)) {
    const path = join(directory, item),
      rel = relative(resources, path),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Unexpected packaged symlink: ${rel}`);
    if (
      /^(\.data|\.work-inbox|\.codex|\.claude|\.agents|backups)$/.test(item) ||
      /^\.env(?:\.|$)/.test(item) ||
      /\.(?:sqlite(?:-wal|-shm)?|pem|key|map)$/.test(item)
    )
      throw new Error(`Private/source-map content in package: ${rel}`);
    if (stat.isDirectory()) inspect(path);
    else files++;
  }
}
inspect(resources);
if (
  !existsSync(join(resources, 'runtime/LICENSE')) ||
  !existsSync(join(resources, 'THIRD_PARTY_LICENSES.txt'))
)
  throw new Error('Missing runtime/dependency notices.');
execFileSync(
  '/usr/bin/codesign',
  ['--verify', '--deep', '--strict', join(root, 'Work Inbox.app')],
  { stdio: 'inherit' },
);
console.log(
  `Release ${pkg.version}: ${names.length} checksummed assets; clean source ${metadata.sourceCommit}; ${files} packaged files inspected; ${metadata.signing}, notarized=${metadata.notarized}.`,
);
