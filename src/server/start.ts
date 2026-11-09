import { join } from 'node:path';
import { openStore } from '../db/index.js';
import { createApp } from './app.js';

export async function startServer(options: {
  directory: string;
  port: number;
  publicDir: string;
  development?: boolean;
  mcpLauncher?: string;
}) {
  const store = openStore(join(options.directory, 'work.sqlite'));
  let app: Awaited<ReturnType<typeof createApp>>['app'] | undefined;
  let reconcile: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      clearInterval(reconcile);
      await app?.close();
      store.close();
    })());
  try {
    const instance = await createApp(store, {
      origin: `http://127.0.0.1:${options.port}`,
      development: options.development,
      publicDir: options.publicDir,
      mcpLauncher: options.mcpLauncher,
      logger: true,
    });
    app = instance.app;
    await app.listen({ host: '127.0.0.1', port: options.port });
    reconcile = setInterval(() => {
      try {
        instance.service.reconcile();
      } catch (error) {
        app!.log.error(error);
      }
    }, 5000);
    reconcile.unref();
    return { app, close };
  } catch (error) {
    await close();
    throw error;
  }
}
