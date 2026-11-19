import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../../src/db/index.js';
import { createApp } from '../../src/server/app.js';
const dir = mkdtempSync(join(tmpdir(), 'work-inbox-browser-'));
const store = openStore(join(dir, 'db.sqlite'));
const origin = 'http://127.0.0.1:4318';
delete process.env.RHEO_GITLAB_CONFIG;
const { app, auth, service } = await createApp(store, {
  origin,
  allowSimulation: true,
  publicDir: resolve('dist/public'),
  integrationDir: join(dir, 'integrations'),
  gitlabKeychain: null,
  gitlabFetch: async (input) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://gitlab.example.com') throw new Error('Unexpected fixture host');
    if (url.pathname.endsWith('/merge_requests/13')) return new Response('', { status: 401 });
    return Response.json({
      web_url: 'https://gitlab.example.com/team/project/-/merge_requests/12',
      state: 'opened',
      sha: 'a'.repeat(40),
      head_pipeline: { sha: 'a'.repeat(40), status: 'success' },
      detailed_merge_status: 'conflict',
      has_conflicts: true,
      blocking_discussions_resolved: false,
      draft: false,
    });
  },
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
