import { z } from 'zod';
export const connectionClientSchema = z.enum(['codex', 'claude-desktop', 'other']);
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
    tool: z.enum(['create_work', 'list_work', 'get_work', 'add_work_update']),
  }),
]);
export type ConnectionClient = z.infer<typeof connectionClientSchema>;
