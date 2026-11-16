import { requestGuidanceSchema } from './request-guidance.js';
import { z } from 'zod';
export const originSchema = z
  .object({
    client: z.enum(['codex', 'claude-code']),
    sessionId: z.string().min(1).max(200),
    messageId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type FeedbackOrigin = z.infer<typeof originSchema>;
export const feedbackSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('question'),
      id: z.uuid(),
      revision: z.number().int().positive(),
      answer: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('human_action'),
      id: z.uuid(),
      revision: z.number().int().positive(),
      state: z.enum(['in_progress', 'done', 'cancelled']),
      response: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('work_decision'),
      id: z.uuid(),
      revision: z.number().int().positive(),
      action: z.enum(['accept', 'decline']),
      response: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('stream_decision'),
      id: z.uuid(),
      revision: z.number().int().positive(),
      action: z.enum([
        'accept',
        'decline',
        'accept_scope',
        'reject_scope',
        'enable_coverage',
        'keep_open',
      ]),
      response: z.string().trim().min(1).max(4000),
    })
    .strict(),
]);
export const selectionSchema = z.object({
  streamId: z.uuid().optional(),
  changeId: z.uuid().optional(),
});
export const syncEventSchema = selectionSchema
  .extend({
    eventId: z.uuid(),
    sessionId: originSchema.shape.sessionId,
    client: originSchema.shape.client,
    project: z.string().min(1).max(2000),
    turnId: z.string().min(1).max(200),
    event: z.enum(['start', 'prompt', 'compact', 'stop', 'interrupt', 'checkpoint']),
    occurredAt: z.number().int().nonnegative(),
    contextMode: z.enum(['full', 'compact']).optional(),
    checkpoint: z
      .object({
        summary: z.string().trim().min(1).max(3000),
        change: z
          .object({
            revision: z.number().int().positive(),
            progress: z.enum(['planned', 'working', 'blocked', 'review', 'delivered']),
            note: z.string().trim().min(1).max(3000),
          })
          .strict()
          .optional(),
        stream: z
          .object({
            revision: z.number().int().positive(),
            summary: z.string().trim().min(1).max(3000),
          })
          .strict()
          .optional(),
        findings: z
          .array(
            z
              .object({
                kind: z.enum(['decision', 'finding', 'question', 'constraint']),
                guidance: requestGuidanceSchema.optional(),
                body: z.string().trim().min(1).max(4000),
                needsHuman: z.boolean().default(false),
              })
              .strict(),
          )
          .max(6)
          .default([]),
        feedback: z.array(feedbackSchema).max(6).default([]),
        messageId: z.string().min(1).max(200).optional(),
        reconciles: z.array(z.uuid()).max(20).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();
export const queueReportSchema = z
  .object({
    sessionId: originSchema.shape.sessionId,
    pendingWrites: z.number().int().min(0).max(1000),
    observedAt: z.number().int().nonnegative(),
  })
  .strict();
export type SyncSession = {
  id: string;
  credentialId: string;
  sessionId: string;
  client: 'codex' | 'claude-code';
  project: string;
  streamId: string | null;
  changeId: string | null;
  turnId: string;
  lastEvent: string;
  lastEventAt: number;
  lastContextAt: number | null;
  lastCheckpointAt: number | null;
  checkpointTurnId: string | null;
  needsCheckpoint: number;
  summary: string;
  pendingWrites: number;
  queueReportedAt: number | null;
};
export type SyncStatus = Omit<SyncSession, 'credentialId'> & { state: 'needs_update' | 'recorded' };
