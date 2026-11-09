import { fileURLToPath } from 'node:url';
import { dataDir, port } from '../config.js';
import { startServer } from './start.js';
const server = await startServer({
  directory: dataDir,
  port,
  development: process.env.NODE_ENV !== 'production',
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
});
process.on('SIGINT', () => void server.close());
process.on('SIGTERM', () => void server.close());
