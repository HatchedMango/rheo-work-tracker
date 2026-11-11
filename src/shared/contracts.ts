import { z } from 'zod';
import { workStatuses } from './work-status.js';
export const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const referenceSchema = z.object({
  system: z.string().trim().min(1).max(80),
  url: z
    .url()
    .max(2000)
    .refine((s) => ['https:', 'http:'].includes(new URL(s).protocol), 'Use an HTTP(S) URL'),
});
export const contentSchema = z.object({
  title: z.string().trim().min(1).max(180),
  objective: z.string().trim().min(1).max(16000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  priority: prioritySchema.default('normal'),
  references: z.array(referenceSchema).max(20).default([]),
});
export const createSchema = contentSchema.extend({
  idempotencyKey: z.string().min(1).max(120).optional(),
  streamId: z.uuid().optional(),
  scopeIntent: z.enum(['within_scope', 'scope_expansion']).optional(),
  expectedOutput: z.string().trim().max(3000).optional(),
});
export const updateSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  references: z.array(referenceSchema).max(20).default([]),
});
export const listSchema = z.object({
  q: z.string().max(200).default(''),
  view: z
    .enum([
      'all',
      'inbox',
      'active',
      'history',
      'backlog',
      'queued',
      'running',
      'review',
      'completed',
      'cancelled',
    ])
    .default('all'),
  status: z.enum(['any', ...workStatuses]).default('any'),
  streamId: z.union([z.uuid(), z.literal('ungrouped')]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
export const actionSchema = z.object({
  action: z.enum([
    'accept',
    'decline',
    'run',
    'complete',
    'cancel',
    'approve',
    'changes',
    'dismiss_failure',
  ]),
  revision: z.number().int().positive(),
  message: z.string().trim().max(8000).default(''),
});
export const runUpdateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heartbeat'), claimToken: z.string().min(1).max(200) }),
  z.object({
    type: z.literal('progress'),
    claimToken: z.string().min(1).max(200),
    messageId: z.string().min(1).max(120),
    message: z.string().trim().min(1).max(4000),
  }),
  z.object({
    type: z.literal('result'),
    claimToken: z.string().min(1).max(200),
    messageId: z.string().min(1).max(120),
    summary: z.string().trim().min(1).max(8000),
    artifact: z.string().trim().min(1).max(16000),
  }),
]);
export type CreateWork = z.infer<typeof createSchema>;
export type Content = z.infer<typeof contentSchema>;
export type ListFilter = z.infer<typeof listSchema>;
export type Action = z.infer<typeof actionSchema>;
export type RunUpdate = z.infer<typeof runUpdateSchema>;
export type Scope = 'owner' | 'agent' | 'worker';
export type Actor = { id: string; scope: Scope; ownerId: string; credentialId?: string };
