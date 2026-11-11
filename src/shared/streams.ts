import { z } from 'zod';
import { referenceSchema } from './contracts.js';
export const WORKFLOW_VERSION = '1.2.0';
export const streamScopeSchema = z.object({
  title: z.string().trim().min(1).max(180),
  outcome: z.string().trim().min(1).max(8000),
  constraints: z.string().trim().max(8000).default(''),
});
export const submitStreamSchema = streamScopeSchema.extend({
  context: z.string().trim().max(6000).default(''),
  idempotencyKey: z.string().min(1).max(120),
  parentId: z.uuid().optional(),
  scopeIntent: z.enum(['within_scope', 'scope_expansion']).optional(),
});
export const streamUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    context: z.string().trim().max(6000).optional(),
    proposedScope: streamScopeSchema.optional(),
  })
  .strict();
export const streamActionSchema = z
  .object({
    revision: z.number().int().positive(),
    action: z.enum([
      'accept',
      'decline',
      'pause',
      'resume',
      'close',
      'reopen',
      'accept_scope',
      'reject_scope',
      'enable_coverage',
      'keep_open',
    ]),
  })
  .strict();
export const streamListSchema = z.object({
  view: z.enum(['active', 'history', 'inbox', 'all']).default('active'),
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const dependencySchema = z
  .object({
    requiresId: z.uuid(),
    stage: z.enum(['start', 'integrate']),
    condition: z.enum(['output_available', 'integrated']),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const changeUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    streamId: z.uuid().nullable().optional(),
    expectedOutput: z.string().trim().max(3000).optional(),
    areas: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
    resources: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    baseRef: z.string().trim().max(500).optional(),
    progress: z.enum(['planned', 'working', 'blocked', 'review', 'delivered']).optional(),
    progressNote: z.string().trim().max(3000).optional(),
    reviewRequested: z.boolean().optional(),
    dependencies: z.array(dependencySchema).max(50).optional(),
    assessDependencies: z.boolean().optional(),
    assessmentFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const contextEntrySchema = z
  .object({
    kind: z.enum(['decision', 'finding', 'question', 'constraint']),
    body: z.string().trim().min(1).max(4000),
    needsHuman: z.boolean().default(false),
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict();
export const resolveContextSchema = z
  .object({ revision: z.number().int().positive(), state: z.enum(['resolved', 'superseded']) })
  .strict();
export const outputSchema = z
  .object({
    revision: z.number().int().positive().optional(),
    kind: z.enum(['mr', 'document', 'finding', 'release', 'other']),
    url: referenceSchema.shape.url,
    label: z.string().trim().min(1).max(180),
    codeRevision: z.string().trim().max(500).default(''),
    state: z.enum(['available', 'integrated']),
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict();
export const claimSchema = z
  .object({
    revision: z.number().int().positive(),
    sessionId: z.uuid(),
    token: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{32,120}$/,
        'Generate and retain a private random claim token before submitting.',
      ),
    leaseSeconds: z.number().int().min(60).max(1800).default(600),
  })
  .strict();
export const renewClaimSchema = z
  .object({
    sessionId: z.uuid(),
    token: z.string().min(20).max(120),
    leaseSeconds: z.number().int().min(60).max(1800).default(600),
    release: z.boolean().default(false),
  })
  .strict();
export const streamContextSchema = z.object({
  streamId: z.uuid().optional(),
  changeId: z.uuid().optional(),
  project: z.string().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(30).default(12),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  entryOffset: z.coerce.number().int().min(0).max(100000).optional(),
  actionOffset: z.coerce.number().int().min(0).max(100000).optional(),
  childOffset: z.coerce.number().int().min(0).max(100000).optional(),
  changeOffset: z.coerce.number().int().min(0).max(100000).optional(),
});
export type Stream = {
  id: string;
  workspaceId: string;
  createdBy: string;
  sourceName: string;
  title: string;
  outcome: string;
  constraints: string;
  context: string;
  state: 'proposed' | 'active' | 'paused' | 'closed' | 'declined';
  revision: number;
  scopeRevision: number;
  pendingScope: z.infer<typeof streamScopeSchema> | null;
  createdAt: number;
  updatedAt: number;
  changes: number;
  outputs: number;
  lastReportAt: number | null;
  openQuestions: number;
  parentId: string | null;
  approvalId: string | null;
  coverageApprovalId: string | null;
  phase: string;
  progressSummary: string;
  reportedBy: string | null;
  reportedAt: number | null;
  outcomeAvailableAt: number | null;
  reviewRequested: number;
  coverage: import('./oversight.js').Coverage | null;
  dependencies: import('./oversight.js').FlowEdge[];
  assessmentFingerprint: string;
  assessmentState: 'unknown' | 'current' | 'stale';
};
export type ContextEntry = {
  id: string;
  streamId: string;
  kind: z.infer<typeof contextEntrySchema>['kind'];
  body: string;
  state: 'open' | 'resolved' | 'superseded';
  needsHuman: boolean;
  createdBy: string;
  actorName: string;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: number | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
};
export type Output = {
  id: string;
  workId: string;
  kind: z.infer<typeof outputSchema>['kind'];
  url: string;
  label: string;
  codeRevision: string;
  state: 'available' | 'integrated';
  reportedBy: string;
  actorName: string;
  reportedAt: number;
  revision: number;
};
export type Dependency = z.infer<typeof dependencySchema> & {
  title: string;
  satisfied: boolean;
  evidence: 'reported' | 'unknown';
};
export type Claim = {
  id: string;
  workId: string;
  actorId: string;
  actorName: string;
  sessionId: string;
  planRevision: number;
  state: 'active' | 'released' | 'expired' | 'revoked';
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};
export type ChangeTracking = {
  workId: string;
  streamId: string | null;
  streamTitle: string | null;
  expectedOutput: string;
  areas: string[];
  resources: string[];
  baseRef: string;
  progress: 'unreported' | 'planned' | 'working' | 'blocked' | 'review' | 'delivered';
  progressNote: string;
  reportedBy: string | null;
  reporterName: string | null;
  reportedAt: number | null;
  revision: number;
  planRevision: number;
  assessmentState: 'unknown' | 'current' | 'stale';
  assessmentFingerprint: string;
  assessedBy: string | null;
  assessedAt: number | null;
  dependencies: Dependency[];
  outputs: Output[];
  claim: Claim | null;
  coverageApprovalId: string | null;
  coverage: import('./oversight.js').Coverage | null;
  deliveredAt: number | null;
  deliveredBy: string | null;
  reviewRequested: number;
  prerequisites: import('./oversight.js').FlowEdge[];
};
export const workflowInstructions = `Work Inbox stores shared work context; agents choose and execute work.\nBefore continuing, load get_stream_context with the explicitly selected stream or change. When several streams match, ask which one; do not guess.\nUse submit_stream for sustained outcomes and create_work for bounded changes. Explicitly declare scopeIntent:within_scope for routine decomposition under a current owner-approved stream; the server derives coverage. New top-level direction, unknown coverage and scope_expansion require a human decision. Covered work is distinct from individual acceptance. Never manufacture approval or expand scope through metadata.\nMaintain structured context, questions, dependency reasons, affected areas and output links using expected revisions. Assess dependencies explicitly; unknown is not independent. Save plan changes first. Read the resulting context and submit its tracking.assessmentFingerprint with assessDependencies:true and the metadata revision; upstream drift must conflict rather than silently certify an unread version. Reassess after any conflict.\nUse an explicit UUID session identity and claim a specific accepted or currently covered change before collaborating. Generate and retain a private random token (32–120 URL-safe characters) before calling claim_change; retry an uncertain claim using the identical credential, sessionId and token. A replay returns the same claim without extending its lease. Released/expired attempts require a new token, never a blind restart. A claim is bookkeeping, not execution permission. Renew while participating, release at handoff, and preserve blockers/decisions as they arise. Never turn expired claims into completion.\nKeep composition (parentId) separate from prerequisites. Use set_prerequisites for typed start/deliver gates across streams, changes and human actions; unknown assessment is not independence. Raise request_human_action for non-coding needs and link what it unlocks; only the owner can report it done. Never store credential values in work content. Use report_stream for attributed phase/summary/outcome availability; reviewRequested is explicit. Use delivered for routine change delivery; it is not human completion and never closes a parent. Report progress and output states truthfully with evidence/code revisions. Reported integration is not independently observed or human-accepted completion. Do not change human lifecycle or broaden scope through metadata.\nIf a revision conflicts, reload and reconcile; never blindly overwrite. Use idempotency keys for uncertain retries. Persist findings and open questions throughout work; set needsHuman on questions that need the owner, which surfaces in Needs you; leave a concise handoff before stopping. If the app is unavailable, say context/updates could not be retrieved/saved. Never claim the workflow is configured from a successful connection alone.`;
