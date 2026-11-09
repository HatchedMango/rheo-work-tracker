import { setTimeout } from 'node:timers/promises';
import { apiClient, ApiError, readCredential } from '../../src/shared/client.js';
import { stub } from './stub.js';
import { z } from 'zod';
import { approvedRequestSchema } from '../../src/worker/adapter.js';
import { randomUUID } from 'node:crypto';
if (process.env.NODE_ENV !== 'test' || !process.env.WORK_INBOX_CREDENTIAL_FILE)
  throw new Error(
    'Simulation fixture requires NODE_ENV=test and an explicit test credential file.',
  );
const request = apiClient(readCredential(process.env.WORK_INBOX_CREDENTIAL_FILE));
const shutdown = new AbortController();
let current: AbortController | undefined;
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    shutdown.abort();
    current?.abort();
  });
console.error(
  'Stub worker online. It only simulates execution; it never opens repositories or runs commands.',
);
let backoff = 3000;
while (!shutdown.signal.aborted) {
  try {
    const { run } = z
      .object({ run: approvedRequestSchema.nullable() })
      .parse(await request('/api/worker/claim', {}));
    backoff = 3000;
    if (run) {
      current = new AbortController();
      const controller = current;
      const heartbeat = setInterval(() => {
        void request(`/api/worker/runs/${run.id}`, {
          type: 'heartbeat',
          claimToken: run.claimToken,
        }).catch(() => controller.abort());
      }, 10000);
      try {
        if (!stub.canExecute(run)) throw new Error('Unsupported adapter.');
        const result = await stub.execute(run, {
          signal: controller.signal,
          onProgress: async (message) => {
            await request(`/api/worker/runs/${run.id}`, {
              type: 'progress',
              claimToken: run.claimToken,
              messageId: randomUUID(),
              message,
            });
          },
        });
        controller.signal.throwIfAborted();
        await request(`/api/worker/runs/${run.id}`, {
          type: 'result',
          claimToken: run.claimToken,
          messageId: randomUUID(),
          ...result,
        });
        console.error(`Result awaiting review: ${run.id}`);
      } catch (error) {
        console.error(
          `Attempt stopped; no automatic replay: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      } finally {
        clearInterval(heartbeat);
        current = undefined;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Worker connection error');
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      process.exitCode = 1;
      break;
    }
    backoff = Math.min(backoff * 2, 30000);
  }
  try {
    await setTimeout(backoff, undefined, { signal: shutdown.signal });
  } catch {
    break;
  }
}
console.error(
  'Worker stopped. Any interrupted attempt will expire and require explicit approval to retry.',
);
