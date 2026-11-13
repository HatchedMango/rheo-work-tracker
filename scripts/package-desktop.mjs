import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

if (process.platform !== 'darwin') throw new Error('Build the Mac app on macOS.');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
const root = resolve('release');
const app = join(root, 'Work Inbox.app');
const contents = join(app, 'Contents');
const resources = join(contents, 'Resources');
const runtime = join(resources, 'runtime');
const payload = join(resources, 'app');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
  throw new Error('Mac bundle versions must be numeric major.minor.patch.');
rmSync(app, { recursive: true, force: true });
mkdirSync(join(contents, 'MacOS'), { recursive: true });
mkdirSync(runtime, { recursive: true });
mkdirSync(payload, { recursive: true });
cpSync(process.execPath, join(runtime, 'node'));
const nodeLicense = resolve(dirname(process.execPath), '../LICENSE');
if (!existsSync(nodeLicense))
  throw new Error(
    'Node distribution LICENSE not found; use the official Node distribution to build.',
  );
cpSync(nodeLicense, join(runtime, 'LICENSE'));
cpSync('dist', join(payload, 'dist'), { recursive: true });
writeFileSync(
  join(payload, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module' }),
);
let sourceCommit = null,
  sourceDirty = null;
try {
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  sourceDirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    encoding: 'utf8',
  }).trim();
} catch {
  /* Archive builds cannot attest a Git revision. */
}
const buildInfo = {
  version: pkg.version,
  workflowVersion: /WORKFLOW_VERSION = '([^']+)'/.exec(
    readFileSync('src/shared/streams.ts', 'utf8'),
  )?.[1],
  sourceCommit,
  sourceDirty,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  minimumMacOS: '13.0',
  builtAt: new Date().toISOString(),
  signing:
    process.env.MAC_SIGNING_IDENTITY && process.env.MAC_SIGNING_IDENTITY !== '-'
      ? 'identity-signed'
      : 'ad-hoc',
  notarized: false,
};
writeFileSync(join(resources, 'BUILD_INFO.json'), JSON.stringify(buildInfo, null, 2) + '\n');
const dependencies = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || !existsSync(path)) continue;
  const metadata = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  // Frontend dependencies are bundled by Vite, so retain their license notices
  // even when npm classifies them as build-time rather than server dependencies.
  const notices = readdirSync(path).filter(
    (name) =>
      /^(licen[cs]e|copying|notice)(\.|$)/i.test(name) && statSync(join(path, name)).isFile(),
  );
  const noticeDirectory = join(
    resources,
    'licenses',
    `${encodeURIComponent(metadata.name)}-${metadata.version}`,
  );
  if (notices.length) mkdirSync(noticeDirectory, { recursive: true });
  for (const notice of notices) cpSync(join(path, notice), join(noticeDirectory, notice));
  dependencies.push(
    `${metadata.name}@${metadata.version} — ${metadata.license || 'see package license'}`,
  );
  if (info.dev) continue;
  mkdirSync(dirname(join(payload, path)), { recursive: true });
  cpSync(path, join(payload, path), { recursive: true, dereference: true });
}
const native = [];
function trim(path) {
  for (const file of readdirSync(path, { withFileTypes: true })) {
    const item = join(path, file.name);
    if (file.isDirectory()) trim(item);
    else if (file.name.endsWith('.map')) rmSync(item);
    else if (file.name.endsWith('.node')) {
      if (!file.name.includes(`darwin-${process.arch}`)) rmSync(item);
      else native.push(item);
    }
  }
}
trim(payload);
writeFileSync(
  join(resources, 'THIRD_PARTY_LICENSES.txt'),
  `Work Inbox ${pkg.version}\n\nNode ${process.version}: runtime/LICENSE\nServer and frontend/build dependency notices: licenses/.\nServer package licenses are also retained within app/node_modules.\n\n${dependencies.sort().join('\n')}\n`,
);
const minimum = process.arch === 'arm64' ? 'arm64-apple-macos13.0' : 'x86_64-apple-macos13.0';
run('xcrun', [
  'swiftc',
  '-swift-version',
  '5',
  '-O',
  '-target',
  minimum,
  'desktop/main.swift',
  'desktop/InboxWindow.swift',
  '-o',
  join(contents, 'MacOS/Work Inbox'),
]);
writeFileSync(
  join(contents, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.workinbox.desktop</string>
<key>CFBundleName</key><string>Work Inbox</string>
<key>CFBundleDisplayName</key><string>Work Inbox</string>
<key>CFBundleExecutable</key><string>Work Inbox</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${pkg.version}</string>
<key>CFBundleVersion</key><string>${pkg.version}</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>CFBundleIconFile</key><string>WorkInbox.icns</string>
</dict></plist>`,
);
run('xcrun', ['swift', 'desktop/Icon.swift', join(root, 'WorkInbox.iconset')]);
run('/usr/bin/iconutil', [
  '-c',
  'icns',
  join(root, 'WorkInbox.iconset'),
  '-o',
  join(resources, 'WorkInbox.icns'),
]);
rmSync(join(root, 'WorkInbox.iconset'), { recursive: true, force: true });
const identity = process.env.MAC_SIGNING_IDENTITY || '-';
const signing = identity === '-' ? ['--timestamp=none'] : ['--options', 'runtime', '--timestamp'];
for (const binary of [...native, join(runtime, 'node')]) {
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    identity,
    ...signing,
    ...(binary.endsWith('/node') ? ['--entitlements', 'desktop/node.entitlements.plist'] : []),
    binary,
  ]);
}
run('/usr/bin/codesign', ['--force', '--sign', identity, ...signing, app]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const archive = join(root, `Work-Inbox-${pkg.version}-macOS-${process.arch}.zip`);
rmSync(archive, { force: true });
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive]);
if (!process.argv.includes('--no-dmg')) {
  const staging = join(root, '.dmg');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  cpSync(app, join(staging, 'Work Inbox.app'), { recursive: true });
  run('/bin/ln', ['-s', '/Applications', join(staging, 'Applications')]);
  const image = join(root, `Work-Inbox-${pkg.version}-macOS-${process.arch}.dmg`);
  rmSync(image, { force: true });
  run('/usr/bin/hdiutil', [
    'create',
    '-volname',
    'Work Inbox',
    '-srcfolder',
    staging,
    '-format',
    'UDZO',
    image,
  ]);
  rmSync(staging, { recursive: true, force: true });
}
const metadata = join(root, `Work-Inbox-${pkg.version}-macOS-${process.arch}.build.json`);
writeFileSync(metadata, JSON.stringify(buildInfo, null, 2) + '\n');
const assets = [
  archive,
  metadata,
  ...(process.argv.includes('--no-dmg')
    ? []
    : [join(root, `Work-Inbox-${pkg.version}-macOS-${process.arch}.dmg`)]),
];
writeFileSync(
  join(root, 'SHA256SUMS'),
  assets
    .map(
      (path) =>
        `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${path.slice(root.length + 1)}`,
    )
    .join('\n') + '\n',
);
console.log(
  `Built ${app} with Node ${process.version} and ${native.length} native SQLite addon(s).`,
);
console.log(`Archive: ${archive} (${Math.round(statSync(archive).size / 1024 / 1024)} MB)`);
console.log(
  identity === '-'
    ? 'Local build: ad-hoc signed, not notarized for public distribution.'
    : 'Signed build: notarize with an Apple Developer ID before public distribution.',
);
