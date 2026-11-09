import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';
const dir = mkdtempSync(join(tmpdir(), 'work-inbox-browser-'));
const store = openStore(join(dir, 'db.sqlite'));
const origin = 'http://127.0.0.1:4318';
const { app, auth, service } = await createApp(store, {
  origin,
  allowSimulation: true,
  publicDir: resolve('dist/public'),
});
const worker = auth.register('worker', 'Browser test worker');
const agent = auth.register('agent', 'External capture agent');
const testState = resolve('.data/e2e');
mkdirSync(testState, { recursive: true, mode: 0o700 });
writeFileSync(
  join(testState, 'worker.json'),
  JSON.stringify({ url: origin, token: worker.secret }),
  { mode: 0o600 },
);
writeFileSync(join(testState, 'agent.json'), JSON.stringify({ url: origin, token: agent.secret }), {
  mode: 0o600,
});
setInterval(() => service.reconcile(), 2000).unref();
await app.listen({ host: '127.0.0.1', port: 4318 });
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    void app.close().then(() => {
      store.close();
      process.exit(0);
    });
  });
