import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { Content } from '../shared/contracts.js';
export const workspaces = sqliteTable('workspaces', {
  id: text().primaryKey(),
  name: text().notNull(),
});
export const dailyProgressPreferences = sqliteTable('daily_progress_preferences', {
  id: text().primaryKey(),
  target: integer().notNull().default(5),
  revision: integer().notNull().default(1),
});
export const changeCompletions = sqliteTable(
  'change_completions',
  {
    workId: text()
      .primaryKey()
      .references(() => work.id),
    completedAt: integer().notNull(),
    milestone: text().notNull(),
  },
  (t) => [index('change_completions_date').on(t.completedAt, t.workId)],
);
export const actors = sqliteTable('actors', {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id),
  kind: text().notNull(),
  name: text().notNull(),
  ownerId: text().notNull(),
  lastSeen: integer(),
});
export const work = sqliteTable(
  'work',
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id),
    createdBy: text()
      .notNull()
      .references(() => actors.id),
    ownerId: text().references(() => actors.id),
    title: text().notNull(),
    objective: text().notNull(),
    acceptanceCriteria: text({ mode: 'json' }).$type<string[]>().notNull(),
    priority: text().notNull(),
    visibility: text().notNull().default('private'),
    lifecycle: text().notNull(),
    revision: integer().notNull(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [index('work_updated').on(t.updatedAt)],
);
export const references = sqliteTable('source_refs', {
  id: text().primaryKey(),
  workId: text()
    .notNull()
    .references(() => work.id),
  system: text().notNull(),
  url: text().notNull(),
});
export const assignments = sqliteTable(
  'assignments',
  {
    id: text().primaryKey(),
    workId: text()
      .notNull()
      .references(() => work.id),
    recipientId: text()
      .notNull()
      .references(() => actors.id),
    state: text().notNull(),
    decidedAt: integer(),
  },
  (t) => [uniqueIndex('assignment_work').on(t.workId)],
);
export const approvals = sqliteTable('approvals', {
  id: text().primaryKey(),
  workId: text()
    .notNull()
    .references(() => work.id),
  approverId: text()
    .notNull()
    .references(() => actors.id),
  adapter: text().notNull(),
  revision: integer().notNull(),
  snapshot: text({ mode: 'json' }).$type<Content>().notNull(),
  createdAt: integer().notNull(),
});
export const runs = sqliteTable(
  'runs',
  {
    id: text().primaryKey(),
    workId: text()
      .notNull()
      .references(() => work.id),
    approvalId: text()
      .notNull()
      .references(() => approvals.id),
    ownerId: text()
      .notNull()
      .references(() => actors.id),
    state: text().notNull(),
    workerId: text().references(() => actors.id),
    claimToken: text(),
    leaseExpiresAt: integer(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
    summary: text(),
    artifact: text(),
    failure: text(),
  },
  (t) => [
    uniqueIndex('one_active_run')
      .on(t.workId)
      .where(sql`${t.state} in ('queued','claimed','running','awaiting_review')`),
    index('run_queue').on(t.state, t.createdAt),
  ],
);
export const attention = sqliteTable(
  'attention',
  {
    id: text().primaryKey(),
    workId: text()
      .notNull()
      .references(() => work.id),
    kind: text().notNull(),
    createdAt: integer().notNull(),
    resolvedAt: integer(),
  },
  (t) => [
    uniqueIndex('one_attention_kind')
      .on(t.workId, t.kind)
      .where(sql`${t.resolvedAt} is null`),
  ],
);
export const events = sqliteTable(
  'events',
  {
    id: text().primaryKey(),
    workId: text()
      .notNull()
      .references(() => work.id),
    actorId: text()
      .notNull()
      .references(() => actors.id),
    type: text().notNull(),
    message: text().notNull(),
    data: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    references: text({ mode: 'json' }).$type<Content['references']>().notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [index('events_work').on(t.workId, t.createdAt)],
);
export const credentials = sqliteTable('credentials', {
  id: text().primaryKey(),
  actorId: text()
    .notNull()
    .references(() => actors.id),
  hash: text().notNull().unique(),
  scope: text().notNull(),
  createdAt: integer().notNull(),
  expiresAt: integer(),
  revokedAt: integer(),
});
export const idempotency = sqliteTable('idempotency', {
  key: text().primaryKey(),
  fingerprint: text().notNull(),
  resourceId: text().notNull(),
});
export type Work = typeof work.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Detail = Work & {
  tracking: import('../shared/streams.js').ChangeTracking;
  sourceName: string;
  references: (typeof references.$inferSelect)[];
  assignment: typeof assignments.$inferSelect | null;
  runs: Run[];
  attention: (typeof attention.$inferSelect)[];
  events: (typeof events.$inferSelect & { actorName: string })[];
};

export const agentConnections = sqliteTable('agent_connections', {
  id: text().primaryKey(),
  credentialId: text()
    .notNull()
    .references(() => credentials.id),
  actorId: text()
    .notNull()
    .references(() => actors.id),
  name: text().notNull(),
  client: text().notNull(),
  credentialPath: text().notNull(),
  idempotencyKey: text().notNull().unique(),
  createdAt: integer().notNull(),
  initializedAt: integer(),
  lastToolAt: integer(),
  lastTool: text(),
  clientName: text(),
  lastCheckedAt: integer(),
  checkOk: integer({ mode: 'boolean' }),
  completedAt: integer(),
});

// Stream/change bookkeeping is separate from human work lifecycle and legacy runs.
export const streams = sqliteTable('streams', {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id),
  createdBy: text()
    .notNull()
    .references(() => actors.id),
  title: text().notNull(),
  outcome: text().notNull(),
  constraints: text().notNull(),
  context: text().notNull(),
  state: text().notNull(),
  revision: integer().notNull(),
  scopeRevision: integer().notNull(),
  pendingScope: text({ mode: 'json' }).$type<
    import('../shared/streams.js').Stream['pendingScope']
  >(),
  parentId: text(),
  approvalId: text(),
  coverageApprovalId: text(),
  phase: text().notNull(),
  progressSummary: text().notNull(),
  reportedBy: text().references(() => actors.id),
  reportedAt: integer(),
  outcomeAvailableAt: integer(),
  outcomeRevision: integer().notNull(),
  planRevision: integer().notNull(),
  assessment: text(),
  assessedBy: text().references(() => actors.id),
  assessedAt: integer(),
  reviewRequested: integer().notNull(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
});
export const streamEvents = sqliteTable('stream_events', {
  id: text().primaryKey(),
  streamId: text()
    .notNull()
    .references(() => streams.id),
  actorId: text()
    .notNull()
    .references(() => actors.id),
  type: text().notNull(),
  message: text().notNull(),
  data: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer().notNull(),
});
export const changeMeta = sqliteTable('change_meta', {
  workId: text()
    .primaryKey()
    .references(() => work.id),
  streamId: text().references(() => streams.id),
  expectedOutput: text().notNull(),
  areas: text({ mode: 'json' }).$type<string[]>().notNull(),
  resources: text({ mode: 'json' }).$type<string[]>().notNull(),
  baseRef: text().notNull(),
  progress: text().notNull(),
  progressNote: text().notNull(),
  reportedBy: text().references(() => actors.id),
  reportedAt: integer(),
  revision: integer().notNull(),
  planRevision: integer().notNull(),
  assessment: text(),
  assessedBy: text().references(() => actors.id),
  assessedAt: integer(),
  coverageApprovalId: text(),
  deliveredAt: integer(),
  deliveredBy: text().references(() => actors.id),
  reviewRequested: integer().notNull(),
});
export const changeDependencies = sqliteTable('change_dependencies', {
  changeId: text()
    .notNull()
    .references(() => work.id),
  requiresId: text()
    .notNull()
    .references(() => work.id),
  stage: text().notNull(),
  condition: text().notNull(),
  reason: text().notNull(),
});
export const streamContext = sqliteTable('stream_context', {
  guidance: text().notNull().default('{}'),
  id: text().primaryKey(),
  streamId: text()
    .notNull()
    .references(() => streams.id),
  kind: text().notNull(),
  body: text().notNull(),
  state: text().notNull(),
  needsHuman: integer({ mode: 'boolean' }).notNull(),
  createdBy: text()
    .notNull()
    .references(() => actors.id),
  answer: text(),
  answeredBy: text().references(() => actors.id),
  answeredAt: integer(),
  answerSource: text(),
  revision: integer().notNull(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
});
export const changeOutputs = sqliteTable('change_outputs', {
  id: text().primaryKey(),
  workId: text()
    .notNull()
    .references(() => work.id),
  kind: text().notNull(),
  url: text().notNull(),
  label: text().notNull(),
  codeRevision: text().notNull(),
  state: text().notNull(),
  reportedBy: text()
    .notNull()
    .references(() => actors.id),
  reportedAt: integer().notNull(),
  revision: integer().notNull(),
});
export const outputObservations = sqliteTable('output_observations', {
  id: text().primaryKey(),
  outputId: text()
    .notNull()
    .references(() => changeOutputs.id, { onDelete: 'cascade' }),
  outputRevision: integer().notNull(),
  checkedBy: text()
    .notNull()
    .references(() => actors.id),
  checkedAt: integer().notNull(),
  source: text().notNull(),
  status: text().notNull(),
  mrState: text(),
  codeRevision: text(),
  pipelineStatus: text(),
  mergeStatus: text(),
  hasConflicts: integer(),
  discussionsResolved: integer(),
  draft: integer(),
  failureCode: text(),
  httpStatus: integer(),
  message: text().notNull(),
});
export const collaborationClaims = sqliteTable('collaboration_claims', {
  id: text().primaryKey(),
  workId: text()
    .notNull()
    .references(() => work.id),
  actorId: text()
    .notNull()
    .references(() => actors.id),
  credentialId: text()
    .notNull()
    .references(() => credentials.id),
  sessionId: text().notNull(),
  tokenHash: text().notNull(),
  planRevision: integer().notNull(),
  state: text().notNull(),
  expiresAt: integer().notNull(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
});
export const workflowReads = sqliteTable('workflow_reads', {
  credentialId: text()
    .primaryKey()
    .references(() => credentials.id),
  workflowVersion: text().notNull(),
  project: text().notNull(),
  streamId: text().references(() => streams.id),
  lastReadAt: integer().notNull(),
});

export const streamApprovals = sqliteTable('stream_approvals', {
  id: text().primaryKey(),
  streamId: text()
    .notNull()
    .references(() => streams.id),
  scopeRevision: integer().notNull(),
  actorId: text()
    .notNull()
    .references(() => actors.id),
  scope: text().notNull(),
  createdAt: integer().notNull(),
});
export const humanActions = sqliteTable('human_actions', {
  guidance: text().notNull().default('{}'),
  id: text().primaryKey(),
  streamId: text()
    .notNull()
    .references(() => streams.id),
  createdBy: text()
    .notNull()
    .references(() => actors.id),
  title: text().notNull(),
  description: text().notNull(),
  doneWhen: text().notNull(),
  ownerId: text()
    .notNull()
    .references(() => actors.id),
  waitingOn: text().notNull(),
  state: text().notNull(),
  response: text().notNull(),
  respondedBy: text().references(() => actors.id),
  responseSource: text(),
  revision: integer().notNull(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
});
export const oversightNodes = sqliteTable('oversight_nodes', {
  id: text().primaryKey(),
  kind: text().notNull(),
});
export const flowDependencies = sqliteTable('flow_dependencies', {
  targetId: text()
    .notNull()
    .references(() => oversightNodes.id),
  sourceId: text()
    .notNull()
    .references(() => oversightNodes.id),
  stage: text().notNull(),
  condition: text().notNull(),
  reason: text().notNull(),
});
export const streamOutputs = sqliteTable('stream_outputs', {
  id: text().primaryKey(),
  streamId: text()
    .notNull()
    .references(() => streams.id),
  kind: text().notNull(),
  url: text().notNull(),
  label: text().notNull(),
  codeRevision: text().notNull(),
  state: text().notNull(),
  reportedBy: text()
    .notNull()
    .references(() => actors.id),
  reportedAt: integer().notNull(),
  revision: integer().notNull(),
});
export const workflowPermissions = sqliteTable('workflow_permissions', {
  credentialId: text()
    .primaryKey()
    .references(() => credentials.id),
  relayFeedback: integer().notNull().default(0),
  updatedAt: integer().notNull(),
});
export const workflowSessions = sqliteTable(
  'workflow_sessions',
  {
    id: text().primaryKey(),
    credentialId: text()
      .notNull()
      .references(() => credentials.id),
    sessionId: text().notNull(),
    client: text().notNull(),
    project: text().notNull(),
    streamId: text().references(() => streams.id),
    changeId: text().references(() => work.id),
    turnId: text().notNull(),
    lastEvent: text().notNull(),
    lastEventAt: integer().notNull(),
    lastContextAt: integer(),
    lastCheckpointAt: integer(),
    checkpointTurnId: text(),
    needsCheckpoint: integer().notNull().default(1),
    intent: text({ enum: ['reading', 'working'] })
      .notNull()
      .default('working'),
    summary: text().notNull().default(''),
    pendingWrites: integer().notNull().default(0),
    queueReportedAt: integer(),
  },
  (t) => [uniqueIndex('workflow_session_identity').on(t.credentialId, t.sessionId)],
);
export const workflowReceipts = sqliteTable(
  'workflow_receipts',
  {
    credentialId: text()
      .notNull()
      .references(() => credentials.id),
    eventId: text().notNull(),
    fingerprint: text().notNull(),
    response: text().notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [uniqueIndex('workflow_receipt_identity').on(t.credentialId, t.eventId)],
);
export const sessionWork = sqliteTable(
  'session_work',
  {
    id: text().primaryKey(),
    workflowSessionId: text()
      .notNull()
      .references(() => workflowSessions.id),
    selectionKey: text().notNull(),
    streamId: text().references(() => streams.id),
    changeId: text().references(() => work.id),
    firstSeenAt: integer().notNull(),
    lastSeenAt: integer().notNull(),
    lastEvent: text().notNull(),
    summary: text().notNull().default(''),
    lastCheckpointAt: integer(),
  },
  (t) => [
    uniqueIndex('session_work_identity').on(t.workflowSessionId, t.selectionKey),
    index('session_work_stream').on(t.streamId, t.lastSeenAt),
    index('session_work_change').on(t.changeId, t.lastSeenAt),
  ],
);
