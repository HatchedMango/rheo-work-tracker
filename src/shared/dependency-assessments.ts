import { z } from 'zod';
export const assessmentTargetSchema = z
  .object({ id: z.uuid(), kind: z.enum(['stream', 'change']) })
  .strict();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const stage = z.discriminatedUnion('result', [
  z.object({ result: z.literal('linked'), reason: z.string().trim().min(1).max(600) }).strict(),
  z.object({ result: z.literal('none'), reason: z.string().trim().min(1).max(600) }).strict(),
  z
    .object({
      result: z.literal('uncertain'),
      reason: z.string().trim().min(1).max(600),
      nextStep: z.string().trim().min(1).max(600),
    })
    .strict(),
]);
export const assessmentReviewSchema = z
  .object({
    target: assessmentTargetSchema,
    scopeStreamId: z.uuid().nullable().optional(),
    limit: z.number().int().min(1).max(100).default(30),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
export const assessmentReportSchema = z
  .object({
    target: assessmentTargetSchema,
    revision: z.number().int().positive(),
    scopeStreamId: z.uuid().nullable(),
    scopeFingerprint: fingerprint,
    planFingerprint: fingerprint,
    reviewedIds: z.array(z.uuid()).min(1).max(1000),
    coverage: z.enum(['complete', 'partial']),
    start: stage,
    deliver: stage,
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict();
export type AssessmentTarget = z.infer<typeof assessmentTargetSchema>;
export type StageAssessment = z.infer<typeof stage>;
export type DependencyAssessment = {
  state: 'unassessed' | 'legacy' | 'current' | 'uncertain' | 'stale';
  id: string | null;
  scopeStreamId: string | null;
  scopeTitle: string;
  start: StageAssessment | null;
  deliver: StageAssessment | null;
  coverage: 'complete' | 'partial' | null;
  actorName: string | null;
  reportedAt: number | null;
  detail: string;
};
