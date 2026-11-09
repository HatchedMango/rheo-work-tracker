import { setTimeout } from 'node:timers/promises';
import type { ExecutionAdapter } from '../../src/worker/adapter.js';
export const stub: ExecutionAdapter = {
  id: 'stub',
  canExecute: (r) => r.adapter === 'stub',
  async execute(request, { onProgress, signal }) {
    for (const message of [
      'Loaded the approved snapshot. Simulation only; no repository access.',
      'Simulating the work step. No commands or provider calls are being made.',
      'Preparing a simulated result for human review.',
    ]) {
      signal.throwIfAborted();
      await onProgress(message);
      await setTimeout(1800, undefined, { signal });
    }
    return {
      summary: `Simulation complete for “${request.snapshot.title}”. No actual task work was performed.`,
      artifact: `SIMULATED REPORT\n\nObjective received:\n${request.snapshot.objective}\n\nAcceptance criteria received:\n${request.snapshot.acceptanceCriteria.map((c) => `• ${c}`).join('\n') || '(none supplied)'}\n\nThis artifact validates queueing, progress, and review only. No files were accessed or changed, no commands were executed, and no AI provider was contacted. Acceptance criteria have not been evaluated.`,
    };
  },
};
