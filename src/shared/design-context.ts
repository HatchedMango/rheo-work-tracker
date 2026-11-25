import { z } from 'zod';
import { referenceSchema } from './contracts.js';
export const designTargetSchema = z
  .object({ kind: z.enum(['stream', 'change']), id: z.uuid() })
  .strict();
const references = z
  .array(
    referenceSchema.extend({
      url: referenceSchema.shape.url.refine((value) => {
        const u = new URL(value);
        return !u.username && !u.password;
      }, 'Do not include credentials in references.'),
    }),
  )
  .max(20)
  .default([]);
export const designRecordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('assumption'),
      statement: z.string().trim().min(1).max(2000),
      status: z.enum(['unknown', 'supported', 'challenged', 'invalidated']),
      evidence: z.string().trim().min(1).max(4000),
      invalidatedBy: z.string().trim().min(1).max(2000),
      references,
    })
    .strict(),
  z
    .object({
      kind: z.literal('invariant'),
      statement: z.string().trim().min(1).max(2000),
      applicability: z.string().trim().min(1).max(1000),
      inherit: z.boolean().default(false),
      status: z.enum(['active', 'retired']),
      references,
    })
    .strict(),
  z
    .object({
      kind: z.literal('verification'),
      criterionIndex: z.number().int().min(0).max(29),
      criterion: z.string().trim().min(1).max(1000),
      result: z.enum(['pass', 'fail', 'inconclusive']),
      method: z.enum(['test', 'manual', 'other']),
      evidence: z.string().trim().min(1).max(4000),
      conditions: z.string().trim().min(1).max(2000),
      limitations: z.string().trim().min(1).max(2000),
      codeRevision: z.string().trim().min(1).max(500),
      checkedAt: z.number().int().nonnegative(),
      references,
    })
    .strict(),
]);
export const saveDesignRecordSchema = z
  .object({
    id: z.uuid().optional(),
    revision: z.number().int().positive().optional(),
    target: designTargetSchema,
    record: designRecordSchema,
    reason: z.string().trim().min(1).max(2000),
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict()
  .refine((p) => Boolean(p.id) === Boolean(p.revision), 'Updates require both id and revision.');
export const designQuerySchema = z
  .object({
    target: designTargetSchema,
    limit: z.number().int().min(1).max(30).default(12),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
export const reviewAssumptionSchema = z
  .object({
    changeId: z.uuid(),
    assumptionId: z.uuid(),
    assumptionRevision: z.number().int().positive(),
    // Revision zero creates a link; later reviews reconcile against its current revision.
    revision: z.number().int().nonnegative(),
    note: z.string().trim().min(1).max(2000),
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict();
export type DesignTarget = z.infer<typeof designTargetSchema>;
export type DesignRecord = {
  id: string;
  target: DesignTarget;
  record: z.infer<typeof designRecordSchema>;
  revision: number;
  createdBy: string;
  actorName: string;
  updatedAt: number;
  inherited: boolean;
  linked: boolean;
  criterionChanged: boolean;
};
export type AssumptionReview = {
  assumptionId: string;
  changeId: string;
  revision: number;
  assumptionRevision: number;
  currentRevision: number;
  needsReview: boolean;
  statement: string;
  status: string;
  note: string;
  reviewedAt: number;
  actorName: string;
};
export type DesignContextPage = {
  items: DesignRecord[];
  total: number;
  nextOffset: number | null;
  reviews: AssumptionReview[];
  reviewTotal: number;
  reviewNextOffset: number | null;
};
