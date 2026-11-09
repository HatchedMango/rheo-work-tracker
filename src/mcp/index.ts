import { join } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { apiClient, readCredential } from '../shared/client.js';
import { dataDir } from '../config.js';
import { createSchema, listSchema, updateSchema } from '../shared/contracts.js';
const request = apiClient(
  readCredential(process.env.WORK_INBOX_CREDENTIAL_FILE || join(dataDir, 'agent.json')),
);
const server = new McpServer({ name: 'work-inbox', version: '0.1.0' });
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
      'Submit work to the inbox for the user to accept or decline. Does not approve execution.',
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
    inputSchema: { id: z.uuid() },
  },
  ({ id }) => result('get_work', () => request(`/api/work/${id}`)),
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
await server.connect(new StdioServerTransport());
