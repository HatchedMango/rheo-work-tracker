import * as c from '../shared/streams.js';
import * as o from '../shared/oversight.js';
import { join } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { apiClient, readCredential } from '../shared/client.js';
import { dataDir } from '../config.js';
import { createSchema, listSchema, updateSchema } from '../shared/contracts.js';
const request = apiClient(
  readCredential(process.env.WORK_INBOX_CREDENTIAL_FILE || join(dataDir, 'agent.json')),
  { diagnostic: process.env.WORK_INBOX_SETUP_CHECK === '1' },
);
const server = new McpServer(
  { name: 'work-inbox', version: '0.3.0' },
  { instructions: c.workflowInstructions },
);
async function report(activity: { kind: string; tool?: string }) {
  if (process.env.WORK_INBOX_SETUP_CHECK === '1') return;
  try {
    await request('/api/agent/activity', {
      ...activity,
      clientName: (server.server.getClientVersion()?.name || 'MCP client').slice(0, 120),
    });
  } catch {
    console.error('Could not update connection activity.');
  }
}
server.server.oninitialized = () => {
  void report({ kind: 'initialized' });
};

async function result(tool: string, fn: () => Promise<unknown>) {
  try {
    const output = await fn();
    await report({ kind: 'tool', tool });
    return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: error instanceof Error ? error.message : 'Request failed' },
      ],
    };
  }
}
server.registerTool(
  'create_work',
  {
    description:
      'Submit a bounded change. Explicit within_scope additions can use active stream approval coverage; otherwise request a human decision. No execution authority.',
    inputSchema: createSchema.shape,
  },
  (args) => result('create_work', () => request('/api/work', createSchema.parse(args))),
);
server.registerTool(
  'list_work',
  {
    description: 'List and search personal work with bounded pagination.',
    inputSchema: listSchema.shape,
  },
  (args) =>
    result('list_work', () => {
      const f = listSchema.parse(args);
      return request(
        `/api/work?${new URLSearchParams(Object.entries(f).map(([k, v]) => [k, String(v)]))}`,
      );
    }),
);
server.registerTool(
  'get_work',
  {
    description: 'Read work context, recent activity, and outcomes.',
    inputSchema: {
      id: z.uuid(),
      part: z.enum(['detail', 'events', 'outputs']).default('detail'),
      limit: z.number().int().min(1).max(30).default(30),
      offset: z.number().int().min(0).max(100000).default(0),
    },
  },
  ({ id, part, limit, offset }) =>
    result('get_work', () =>
      part === 'detail'
        ? request(`/api/work/${id}`)
        : request(`/api/work/${id}/${part}?limit=${limit}&offset=${offset}`),
    ),
);
server.registerTool(
  'add_work_update',
  {
    description:
      'Add a note and optional references. Cannot change lifecycle or authorize execution.',
    inputSchema: { id: z.uuid(), ...updateSchema.shape },
  },
  ({ id, ...args }) =>
    result('add_work_update', () => request(`/api/work/${id}/updates`, updateSchema.parse(args))),
);
const query = (path: string, args: Record<string, unknown>) =>
  request(
    `${path}?${new URLSearchParams(
      Object.entries(args)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    )}`,
  );
server.registerTool(
  'get_workflow',
  {
    description:
      'Read the maintained Work Inbox agent workflow. Connection success does not verify workflow setup.',
    inputSchema: {},
  },
  () => result('get_workflow', () => request('/api/workflow')),
);
server.registerTool(
  'submit_stream',
  {
    description:
      'Submit a sustained outcome, optionally within an approved parent. Declare scopeIntent explicitly; new direction and scope expansion require a human decision.',
    inputSchema: c.submitStreamSchema.shape,
  },
  (args) =>
    result('submit_stream', () => request('/api/streams', c.submitStreamSchema.parse(args))),
);
server.registerTool(
  'get_context_entry',
  {
    description:
      'Read one full context entry by ID when its context-package summary was shortened.',
    inputSchema: { id: z.uuid() },
  },
  ({ id }) => result('get_context_entry', () => request(`/api/context/${id}`)),
);
server.registerTool(
  'get_stream',
  {
    description:
      'Read full stream scope, or a bounded page of context entries or append-only history.',
    inputSchema: {
      id: z.uuid(),
      part: z
        .enum(['detail', 'context', 'events', 'overview', 'human-actions', 'outputs'])
        .default('detail'),
      limit: z.number().int().min(1).max(30).default(30),
      offset: z.number().int().min(0).max(100000).default(0),
    },
  },
  ({ id, part, limit, offset }) =>
    result('get_stream', () =>
      part === 'detail'
        ? request(`/api/streams/${id}`)
        : query(`/api/streams/${id}/${part}`, { limit, offset }),
    ),
);
server.registerTool(
  'list_streams',
  {
    description:
      'Discover streams with bounded pagination. Choose an explicit stream; never infer one from a project name.',
    inputSchema: c.streamListSchema.shape,
  },
  (args) => result('list_streams', () => query('/api/streams', c.streamListSchema.parse(args))),
);
server.registerTool(
  'update_stream',
  {
    description:
      'Maintain current context or propose a scope revision. Scope proposals require a human decision.',
    inputSchema: { id: z.uuid(), ...c.streamUpdateSchema.shape },
  },
  ({ id, ...args }) =>
    result('update_stream', () =>
      request(`/api/streams/${id}/update`, c.streamUpdateSchema.parse(args)),
    ),
);
server.registerTool(
  'update_change',
  {
    description:
      'Update permitted tracking, typed prerequisites, exclusive resources and reported progress with an expected metadata revision. Unknown dependencies are not independence. Save plan changes first, then assess using assessmentFingerprint from the context you read; upstream drift conflicts.',
    inputSchema: { id: z.uuid(), ...c.changeUpdateSchema.shape },
  },
  ({ id, ...args }) =>
    result('update_change', () =>
      request(`/api/work/${id}/tracking`, c.changeUpdateSchema.parse(args)),
    ),
);
server.registerTool(
  'get_stream_context',
  {
    description:
      'Retrieve bounded current context for an explicit stream/change and record context retrieval. Without a selection, returns choices. Follow cursors for remaining entries/changes; full records are linked by ID.',
    inputSchema: c.streamContextSchema.shape,
  },
  (args) =>
    result('get_stream_context', () => query('/api/context', c.streamContextSchema.parse(args))),
);
server.registerTool(
  'record_context',
  {
    description:
      'Persist an attributed decision, finding, question or constraint. Use a stable idempotency key for retries.',
    inputSchema: { streamId: z.uuid(), ...c.contextEntrySchema.shape },
  },
  ({ streamId, ...args }) =>
    result('record_context', () =>
      request(`/api/streams/${streamId}/context`, c.contextEntrySchema.parse(args)),
    ),
);
server.registerTool(
  'resolve_context',
  {
    description:
      'Resolve or supersede an entry authored by this agent. Human-authored entries require the owner.',
    inputSchema: { id: z.uuid(), ...c.resolveContextSchema.shape },
  },
  ({ id, ...args }) =>
    result('resolve_context', () =>
      request(`/api/context/${id}/resolve`, c.resolveContextSchema.parse(args)),
    ),
);
server.registerTool(
  'record_output',
  {
    description:
      'Record or revise an output report and code/artifact revision. This is attributed evidence, not an observed merge or human completion.',
    inputSchema: { id: z.uuid(), ...c.outputSchema.shape },
  },
  ({ id, ...args }) =>
    result('record_output', () => request(`/api/work/${id}/outputs`, c.outputSchema.parse(args))),
);
server.registerTool(
  'claim_change',
  {
    description:
      'Atomically claim an explicitly chosen accepted or currently covered change for a UUID session. Cooperative bookkeeping only; no execution or scheduling. Generate and retain a private random token before this call. Retry uncertain delivery with the same credential/session/token to recover the same lease without extending it. Keep the token private.',
    inputSchema: { id: z.uuid(), ...c.claimSchema.shape },
  },
  ({ id, ...args }) =>
    result('claim_change', () => request(`/api/work/${id}/claims`, c.claimSchema.parse(args))),
);
server.registerTool(
  'update_claim',
  {
    description:
      'Renew or release your own credential/session claim using its private token. Expiry never retries or completes work.',
    inputSchema: { id: z.uuid(), ...c.renewClaimSchema.shape },
  },
  ({ id, ...args }) =>
    result('update_claim', () => request(`/api/claims/${id}`, c.renewClaimSchema.parse(args))),
);
server.registerTool(
  'set_prerequisites',
  {
    description:
      'Replace typed start/delivery prerequisites on a selected stream or change, using its metadata revision. Does not schedule work. Release active claims before plan edits.',
    inputSchema: o.setDependenciesSchema.shape,
  },
  (args) =>
    result('set_prerequisites', () =>
      request('/api/dependencies', o.setDependenciesSchema.parse(args)),
    ),
);
server.registerTool(
  'request_human_action',
  {
    description:
      'Ask the owner to do something outside coding, with a completion condition and optional waiting-on party. Link it as a prerequisite separately. Never put secret values in task content.',
    inputSchema: o.humanActionSchema.shape,
  },
  (args) =>
    result('request_human_action', () =>
      request('/api/human-actions', o.humanActionSchema.parse(args)),
    ),
);
server.registerTool(
  'get_human_action',
  {
    description: 'Read a human request, its attributed response and current revision.',
    inputSchema: { actionId: z.uuid() },
  },
  ({ actionId }) => result('get_human_action', () => request(`/api/human-actions/${actionId}`)),
);
server.registerTool(
  'withdraw_human_action',
  {
    description:
      'Withdraw your own obsolete request with an explanation. Cancellation never satisfies a done prerequisite; only the owner can report completion.',
    inputSchema: {
      actionId: z.uuid(),
      revision: z.number().int().positive(),
      reason: z.string().min(1).max(4000),
      idempotencyKey: z.string().min(1).max(120),
    },
  },
  ({ actionId, reason, ...args }) =>
    result('withdraw_human_action', () =>
      request(`/api/human-actions/${actionId}/respond`, {
        ...args,
        state: 'cancelled',
        response: reason,
      }),
    ),
);
server.registerTool(
  'report_stream',
  {
    description:
      'Report phase, progress, outcome availability or an explicit human review request. Reports never close streams. Pin dependency assessment to the fingerprint you read.',
    inputSchema: { streamId: z.uuid(), ...o.streamReportSchema.shape },
  },
  ({ streamId, ...args }) =>
    result('report_stream', () =>
      request(`/api/streams/${streamId}/report`, o.streamReportSchema.parse(args)),
    ),
);
server.registerTool(
  'move_stream',
  {
    description:
      'Reorganize a stream inside its approval boundary. Cross-boundary moves require the owner; containment and prerequisite links are separate.',
    inputSchema: { streamId: z.uuid(), ...o.moveStreamSchema.shape },
  },
  ({ streamId, ...args }) =>
    result('move_stream', () =>
      request(`/api/streams/${streamId}/move`, o.moveStreamSchema.parse(args)),
    ),
);
server.registerTool(
  'record_stream_output',
  {
    description:
      'Record an attributed stream output, with source and revision evidence. Does not imply human acceptance.',
    inputSchema: { streamId: z.uuid(), ...c.outputSchema.shape },
  },
  ({ streamId, ...args }) =>
    result('record_stream_output', () =>
      request(`/api/streams/${streamId}/outputs`, c.outputSchema.parse(args)),
    ),
);
await server.connect(new StdioServerTransport());
