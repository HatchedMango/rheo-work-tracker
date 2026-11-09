import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { startServer } from '../server/start.js';
import {
  DesktopError,
  importData,
  installMcpLauncher,
  privateDirectory,
  privateJson,
  recoverImport,
} from './storage.js';

const root = resolve(process.env.WORK_INBOX_DESKTOP_HOME || '');
const resources = process.env.WORK_INBOX_RESOURCES || '';
const port = Number(process.env.WORK_INBOX_DESKTOP_PORT || 4310);
if (
  !process.env.WORK_INBOX_DESKTOP_HOME ||
  !isAbsolute(resources) ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
)
  throw new Error('Invalid desktop launcher configuration.');
privateDirectory(root);
const lock = join(root, 'service.lock');
const status = join(root, 'desktop-status.json');
let ownsLock = false;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let stopping = false;
function release() {
  if (ownsLock) {
    rmSync(lock, { recursive: true, force: true });
    // Do not erase a later instance's status.
    try {
      if (JSON.parse(readFileSync(status, 'utf8')).pid === process.pid)
        rmSync(status, { force: true });
    } catch {
      /* No status was published. */
    }
    ownsLock = false;
  }
}
async function stop() {
  if (stopping) return;
  stopping = true;
  await server?.close();
  release();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
// The native launcher owns this pipe. Its unexpected exit must not orphan Node.
process.stdin.on('end', () => void stop());
process.stdin.resume();
process.on('exit', release);
try {
  if (existsSync(lock)) {
    let pid: number;
    try {
      pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
    } catch {
      throw new DesktopError('Another Work Inbox service is starting. Try again shortly.');
    }
    let alive = Number.isInteger(pid) && pid > 0;
    if (alive) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
    }
    if (alive) throw new DesktopError('Work Inbox is already running.');
    rmSync(lock, { recursive: true, force: true });
  }
  mkdirSync(lock, { mode: 0o700 });
  ownsLock = true;
  writeFileSync(join(lock, 'pid'), String(process.pid), { mode: 0o600 });
  privateJson(status, { state: 'starting', pid: process.pid });
  // Refuse to attach to, overwrite, or terminate an unknown local service.
  await new Promise<void>((done, fail) => {
    const probe = createServer();
    probe.once('error', () =>
      fail(
        new DesktopError(
          `Port ${port} is already in use. Quit the other local server, then restart Work Inbox.`,
        ),
      ),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(() => done()));
  });
  const data = join(root, 'data');
  recoverImport(data);
  if (process.env.WORK_INBOX_IMPORT_DATA)
    await importData(data, process.env.WORK_INBOX_IMPORT_DATA, `http://127.0.0.1:${port}`);
  const mcpLauncher = installMcpLauncher(root, resources);
  server = await startServer({
    directory: data,
    port,
    publicDir: join(resources, 'app/dist/public'),
    mcpLauncher,
  });
  privateJson(status, { state: 'ready', pid: process.pid, url: `http://127.0.0.1:${port}` });
} catch (error) {
  await server?.close();
  if (ownsLock) {
    privateJson(status, {
      state: 'error',
      pid: process.pid,
      message:
        error instanceof DesktopError
          ? error.message
          : 'Work Inbox could not start. Check the app installation and available disk space, then try again.',
    });
    // Leave the safe error status for the native launcher, but relinquish ownership.
    rmSync(lock, { recursive: true, force: true });
    ownsLock = false;
  }
  console.error(error instanceof DesktopError ? error.message : 'Desktop startup failed.');
  process.exit(1);
}
