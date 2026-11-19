import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
if (process.platform === 'darwin') {
  mkdirSync('dist/native', { recursive: true });
  const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`;
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-swift-version',
      '5',
      '-O',
      '-target',
      target,
      'desktop/Keychain.swift',
      '-o',
      'dist/native/rheo-keychain',
    ],
    { stdio: 'inherit' },
  );
}
