import { z } from 'zod';
import { contentSchema } from '../shared/contracts.js';
import type { Content } from '../shared/contracts.js';
export const approvedRequestSchema = z.object({
  id: z.uuid(),
  claimToken: z.uuid(),
  adapter: z.literal('stub'),
  snapshot: contentSchema,
});
export type ApprovedRequest = z.infer<typeof approvedRequestSchema>;
export interface ExecutionAdapter {
  id: string;
  canExecute(request: ApprovedRequest): boolean;
  execute(
    request: ApprovedRequest,
    callbacks: { onProgress(message: string): Promise<void>; signal: AbortSignal },
  ): Promise<{ summary: string; artifact: string }>;
}
