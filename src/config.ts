import { resolve } from 'node:path';
export const dataDir = resolve(process.env.WORK_INBOX_DATA_DIR || '.data');
export const port = Number(process.env.PORT || 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be 1024–65535');
export const origin = `http://127.0.0.1:${port}`;
