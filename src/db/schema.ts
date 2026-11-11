import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { Content } from '../shared/contracts.js';
export const workspaces = sqliteTable('workspaces', {
  id: text().primaryKey(),
  name: text().notNull(),
});
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
