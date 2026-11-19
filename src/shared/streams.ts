import { requestGuidanceSchema, type RequestGuidance } from './request-guidance.js';
import { z } from 'zod';
import { conversationUrlSchema } from './conversation-schema.js';
import { referenceSchema } from './contracts.js';
export const WORKFLOW_VERSION = '1.8.0';
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
    scope: streamScopeSchema.optional(),
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
    guidance: requestGuidanceSchema.optional(),
    body: z.string().trim().min(1).max(4000),
    needsHuman: z.boolean().default(false),
    conversationUrl: conversationUrlSchema.optional(),
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
    purpose: z.enum(['collaboration', 'implementation']).default('collaboration'),
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
  dependencyAssessment: import('./dependency-assessments.js').DependencyAssessment;
};
export type ContextEntry = {
  guidance?: RequestGuidance;
  id: string;
  streamId: string;
  kind: z.infer<typeof contextEntrySchema>['kind'];
  body: string;
  state: 'open' | 'resolved' | 'superseded';
  needsHuman: boolean;
  conversationUrl: string | null;
  createdBy: string;
  actorName: string;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: number | null;
  answerSource: string | null;
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
  purpose: 'collaboration' | 'implementation';
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
  dependencyAssessment: import('./dependency-assessments.js').DependencyAssessment;
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
export const humanFacingReminder =
  "Describe work in the user's terms: name the goal with a verb, report progress toward it, and ask for input only when needed. Include technical detail when it directly matters to the ask or a decision.";
export const humanFacingGuidance = `Write for a person trusting their agent with routine development. Help them recognize what they are accomplishing, how it is progressing, and whether they need to act. Use plain, concrete language in their terms; prefer one short sentence and add detail only when it helps understanding or a decision.
- Stream names: start with a verb and name the concrete goal, at the level the user is thinking. For example, "Get Rheo ready for everyday personal use" instead of "Rheo agent workflow". Avoid generic category names such as "Improvements" or "Backend work", internal project labels, and lists of implementation steps. A stream can span many changes; do not rename it for each new task. Keep the goal stable; discuss material changes with the user in their agent chat.
- Outcomes and changes: say what the person will be able to do, or what problem will be solved. Name a bounded change by its useful effect, such as "Keep unfinished work when the app restarts" instead of "Implement persistence layer". Technical work can itself be the goal; "Support PostgreSQL for hosted installs" is appropriate when that is the ask. Do not invent user benefits, scope, commitments or success criteria.
- Progress: explain the latest meaningful movement toward the goal, what remains or is waiting, and any needed input. The title and update should make sense without chat history. For example, "Your work now survives app restarts; agent reconnection still needs checking" instead of "Migration 0008 applied; 23 tests pass". These examples illustrate wording, not facts to copy into real work. Keep the stream goal recognizable rather than turning its summary into the latest change log. Omit repeated status labels, vague reassurance and routine checklists; do not invent a blocker or question just to fill a template.
- Needs you: lead with one short action title or direct question. Use structured guidance for up to five concise how-to steps when the task needs explanation, optional copy.label/copy.text for a useful command or instruction (label should describe what is copied; copy-only, never secrets), and a one-sentence why explaining the benefit or unlock. For decisions include a brief recommendation and relevant tradeoff. Keep background in description and detailed completion criteria in doneWhen; do not bury required steps in those fields or behind More. For example, "Get API access from Bob" or "Choose local-only storage or cross-device sync". Briefly explain a relevant tradeoff and recommendation for a real decision. Reconcile answers already given in chat under the existing relay rules. Raise only actual questions or human actions. Do not create accept/decline, scope-approval or routine review chores. Add conversationUrl only when a reliable chat link is available; omit it otherwise.
- Technical detail: include it when directly related to the ask, or needed to explain behavior, a tradeoff, risk, limitation or decision. Use the precise technical term when it is clearer; do not force technical goals into vague benefits. Keep routine file lists, commands, test counts, identifiers, leases and execution logs in findings/evidence for agents and later inspection. Keep material uncertainty and verification limits visible in plain language; never make a report sound more complete, approved or independently verified than the evidence supports.`;
export const loopProtocol = `Work one useful output through implement → check → revise. Reuse the selected change, current proportional plan and private cooperative-claim identity across iterations; renew the existing claim rather than creating a task or claim per pass. A changed goal/output may justify a new change; a test failure alone does not.
Recover the explicit goal, current approach, prerequisites, useful failed approaches, latest result and next step at startup/resume/compaction/handoff. Use full records/pages when summaries omit needed detail. Ordinary prompts use compact refreshes: reload relevant context when scope, plan, dependency state or evidence changes; reuse current assessments between routine iterations. Unknown, stale or partial assessments never establish readiness.
Checkpoint meaningful progress, failed approaches worth avoiding, verification evidence, decisions, actual blockers and the next step using existing summary/findings/progress/output fields. Do not write every tool call or invent attempt/verification fields the API does not expose. Keep private tokens out of all content. At handoff save a concise truthful checkpoint even if nothing changed, check recorded/pending/conflicts, and release the claim.
Turn/loop stop, interruption, a runner limit, an expired lease or one passing check never means delivered. Keep incomplete work working/planned/blocked according to the facts; report delivered only for the bounded output with evidence and limits. Raise a single actual question/action with its exact ID and what it unlocks; waiting for a machine or another iteration is not a human request. Never add approval chores for routine revisions.
The client or explicitly configured external runner owns continuation, budgets, retries and stopping. Rheo records context only. For an external runner, use the local helper mode --binding BINDING --session-id NATIVE_SESSION --stop-policy observe before its loop; it persists for that session across resumes and never asks for continuation. Default checkpoint-once can request one missing-checkpoint continuation; it stays suppressed across continuations/recovery until a checkpoint is recorded. Neither mode overrides another hook’s stop decision. A real user interruption always stops work.`;
export const workflowCapabilities = {
  protocol: 'agent-loop-v1',
  requiredTools: [
    'get_workflow',
    'get_stream_context',
    'review_dependencies',
    'assess_dependencies',
    'claim_change',
    'update_claim',
  ],
  requiredFields: {
    claim_change: ['purpose=implementation'],
    assess_dependencies: [
      'start',
      'deliver',
      'reviewedIds',
      'coverage',
      'scopeFingerprint',
      'planFingerprint',
    ],
  },
  checkpoint: { tool: 'sync_work', fallback: 'local workflow checkpoint helper' },
  helperOperations: {
    commands: ['review', 'begin', 'lease', 'checkpoint', 'evidence'],
    agentDependencyJudgmentRequired: true,
    lowLevelApisRetained: true,
  },
  clientCheck:
    'Once per native client session, inspect the actual connected tool catalog and schemas before relying on managed implementation. get_workflow advertises the server contract only. Missing tools/fields require client reload/new chat; never fall back to legacy certification. A helper/SDK probe cannot verify the catalog loaded by this chat or automatic hook delivery.',
} as const;
export const workflowInstructions = `Rheo stores shared work context; agents choose and execute work.\nBefore continuing, load get_stream_context with the explicitly selected stream or change. When several streams match, ask which one; do not guess.\n${loopProtocol}\n${workflowCapabilities.clientCheck}\n${humanFacingGuidance}\nUse submit_stream for sustained outcomes and create_work for bounded changes. Work is tracked directly; there is no required acceptance, decline or approval-coverage workflow in the app. Existing decisions and scope proposals remain historical records, not new permission or human chores. Maintain a stream with update_stream.scope and the expected revision. Follow the user's actual authorization in their agent chat; tracking, creation and cooperative claims never authorize execution. Raise uncertainty or a real decision as a short question instead of asking for blanket acceptance.\nMaintain structured context, questions, dependency reasons, affected areas and output links using expected revisions. Required dependency reporting: save prerequisite/plan changes first, call review_dependencies for the selected change or stream and an explicit scope (default: its stream subtree plus recorded direct cross-stream links; use an ancestor for related branches), follow every relevant page and retrieve full records where needed. Report the IDs actually reviewed, coverage, scopeFingerprint, planFingerprint, current target revision, and explicit start/deliver results through assess_dependencies. Each stage is linked or none with a concrete rationale, or uncertain with a nextStep. Missing links never mean independence; partial/uncertain/legacy reports never establish readiness. A complete report must cover the whole returned inventory (maximum 1000 items); focus a smaller scope or report partial uncertainty when it cannot. Material relevant work/scope/output changes make the report stale; reload and reassess after a conflict rather than reusing an unread fingerprint. Existing assessDependencies:true/assessmentFingerprint fields are legacy compatibility evidence only; they do not provide this richer assessment. If the current client lacks the new tools, report that the MCP catalog needs reload/new chat; do not claim an assessment or managed preflight succeeded.\nUse an explicit UUID session identity and claim a specific open, undelivered change before collaborating. For implementation, set claim_change.purpose=implementation: this checks a complete/current staged assessment and satisfied start gates (including ancestor gates). Use purpose=collaboration for planning; it does not certify implementation readiness. Retrying an uncertain claim must retain its original purpose as well as its private identity. Reassess before renewing a managed implementation claim when context changes. Generate and retain a private random token (32–120 URL-safe characters) before calling claim_change; retry an uncertain claim using the identical credential, sessionId and token. A replay returns the same claim without extending its lease. Released/expired attempts require a new token, never a blind restart. A claim is bookkeeping, not execution permission. Renew while participating, release at handoff, and preserve blockers/decisions as they arise. Never turn expired claims into completion.\nKeep composition (parentId and streamId membership) separate from prerequisites. Membership already shows which work contributes to a stream; do not add item-to-containing-stream prerequisites just to express contribution or eventual completion. Map arrows represent actual ordering or required-output dependencies between items, for example getting API access before connecting an integration. A stream-level prerequisite needs a specific gate applying to that stream as a unit, not membership alone. Never invent links or independence from names, timestamps, layout or visual symmetry. Use set_prerequisites for typed start/deliver gates across streams, changes and human actions; unknown assessment is not independence. Raise request_human_action for non-coding needs and link what it unlocks; the owner or an explicitly permitted attributed chat relay can report it done. Never store credential values in work content. Use report_stream for attributed phase/summary/outcome availability; legacy reviewRequested flags do not create Needs you items; create an explicit question when human input is actually needed. Use delivered for routine change delivery; it is not human completion and never closes a parent. When a linked MR matters to a review or delivery report, retrieve get_work part=output-evidence and use check_output with its exact output revision, or the local evidence helper. Check at meaningful review/delivery milestones and after relevant pushes; do not poll every prompt. Read the returned freshness, conflict/discussion/pipeline and failure evidence; unknown never means clear. GitLab observations remain separate from reported work and prerequisite decisions; never merge or deliver automatically. Report progress and output states truthfully with evidence/code revisions. Reported integration is not independently observed or human-accepted completion. Do not claim human acceptance or completion through a progress report.\nEvery change needs at least a brief understanding, approach and verification plan before edits; planning depth scales with the work. With lifecycle hooks installed, use the supplied native sessionId and turnId to save sync_work checkpoints with a new UUID eventId, event=checkpoint and current occurredAt. Save progress, findings and exact human responses together; an unchanged turn still gets a truthful summary. Relay answers and human-action responses only with enabled permission and the exact request/revision; never infer a response from silence or a stopped agent. Do not submit legacy work/stream approval responses as part of the current workflow. Check recorded/pending/conflicts in the result; queued is not saved. If the MCP catalog lacks sync_work, use the local workflow checkpoint helper. Lifecycle session identity is separate from UUID cooperative-claim session identity.\nIf a revision conflicts, reload and reconcile; never blindly overwrite. Use idempotency keys for uncertain retries. Persist findings and open questions throughout work; set needsHuman on questions that need the owner, which surfaces in Needs you; keep requests short, reconcile existing chat answers, and optionally supply a validated conversationUrl (HTTP(S) or an existing local Codex chat link codex://threads/UUID; never a claim UUID, new-chat command or guessed Claude terminal URL); leave a concise handoff before stopping. If the app is unavailable, say context/updates could not be retrieved/saved. Never claim the workflow is configured from a successful connection alone.`;
