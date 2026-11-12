import { z } from 'zod';
export const scopeIntentSchema = z.enum(['within_scope', 'scope_expansion']);
export const nodeSchema = z
  .object({ id: z.uuid(), kind: z.enum(['stream', 'change', 'human_action']) })
  .strict();
export const flowEdgeSchema = z
  .object({
    source: nodeSchema,
    stage: z.enum(['start', 'deliver']),
    condition: z.enum([
      'output_available',
      'integrated',
      'outcome_available',
      'outcome_accepted',
      'done',
    ]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const setDependenciesSchema = z
  .object({
    target: nodeSchema,
    revision: z.number().int().positive(),
    dependencies: z.array(flowEdgeSchema).max(50),
  })
  .strict();
export const humanActionSchema = z
  .object({
    streamId: z.uuid(),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(4000).default(''),
    doneWhen: z.string().trim().min(1).max(1500),
    waitingOn: z.string().trim().max(200).default(''),
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict();
export const humanResponseSchema = z
  .object({
    revision: z.number().int().positive(),
    state: z.enum(['open', 'in_progress', 'done', 'cancelled']),
    response: z.string().trim().min(1).max(4000),
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict();
export const answerSchema = z
  .object({
    revision: z.number().int().positive(),
    answer: z.string().trim().min(1).max(4000),
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict();
export const streamReportSchema = z
  .object({
    streamRevision: z.number().int().positive(),
    phase: z.string().trim().max(120).optional(),
    summary: z.string().trim().max(4000).optional(),
    outcomeAvailable: z.boolean().optional(),
    reviewRequested: z.boolean().optional(),
    assessDependencies: z.boolean().optional(),
    assessmentFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const moveStreamSchema = z
  .object({
    streamRevision: z.number().int().positive(),
    parentId: z.uuid().nullable(),
    reason: z.string().trim().min(1).max(1500),
  })
  .strict();
export const coverageSchema = z
  .object({
    streamRevision: z.number().int().positive(),
    changeIds: z.array(z.uuid()).max(100).default([]),
    streamIds: z.array(z.uuid()).max(100).default([]),
  })
  .strict();
export type Node = z.infer<typeof nodeSchema>;
export type Coverage = {
  approvalId: string;
  streamId: string;
  scopeRevision: number;
  approvedBy: string;
  createdAt: number;
};
export type FlowEdge = z.infer<typeof flowEdgeSchema> & {
  title: string;
  satisfied: boolean;
  evidence: 'reported' | 'human' | 'unknown';
};
export type HumanAction = {
  id: string;
  streamId: string;
  createdBy: string;
  actorName: string;
  title: string;
  description: string;
  doneWhen: string;
  ownerId: string;
  waitingOn: string;
  state: 'open' | 'in_progress' | 'done' | 'cancelled';
  response: string;
  respondedBy: string | null;
  responseSource: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
};
export type StreamRow = {
  id: string;
  parentId: string | null;
  title: string;
  state: string;
  scopeRevision: number;
  approvalId: string | null;
  coverageApprovalId: string | null;
};
export type AttentionItem = {
  id: string;
  kind:
    | 'stream_approval'
    | 'scope'
    | 'work_approval'
    | 'question'
    | 'action'
    | 'review'
    | 'coverage'
    | 'legacy';
  title: string;
  streamId: string | null;
  streamTitle: string | null;
  workId?: string;
  entityId: string;
  body: string;
  createdAt: number;
  direct: { id: string; kind: string; title: string }[];
  affectedStreams: { id: string; title: string }[];
};
