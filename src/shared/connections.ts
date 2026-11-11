import { z } from 'zod';
export const connectionClientSchema = z.enum(['codex', 'claude-code', 'claude-desktop', 'other']);
export const connectionCreateSchema = z
  .object({
    client: connectionClientSchema,
    name: z.string().trim().min(1).max(80),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const agentActivitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initialized'), clientName: z.string().max(120) }),
  z.object({
    kind: z.literal('tool'),
    clientName: z.string().max(120),
    tool: z.enum([
      'create_work',
      'list_work',
      'get_work',
      'add_work_update',
      'get_workflow',
      'submit_stream',
      'list_streams',
      'get_stream',
      'get_context_entry',
      'update_stream',
      'update_change',
      'get_stream_context',
      'record_context',
      'resolve_context',
      'record_output',
      'claim_change',
      'update_claim',
    ]),
  }),
]);
export type ConnectionClient = z.infer<typeof connectionClientSchema>;
