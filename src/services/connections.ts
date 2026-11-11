import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { z } from 'zod';
import type { Store } from '../db/index.js';
import { agentConnections, credentials } from '../db/schema.js';
import type { Actor } from '../shared/contracts.js';
import {
  connectionCreateSchema,
  agentActivitySchema,
  type ConnectionClient,
} from '../shared/connections.js';
import { Auth } from './auth.js';
import { ensure } from './errors.js';

// Shell quoting applies only to the copyable command. JSON/TOML use string encoding.
export const shellQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export function connectionConfiguration(
  client: ConnectionClient,
  id: string,
  node: string,
  entry: string,
  credentialPath: string,
  standalone = false,
) {
  const serverName = `work-inbox-${id.slice(0, 8)}`;
  const launch = {
    command: standalone ? entry : node,
    args: standalone ? [] : [entry],
    env: { WORK_INBOX_CREDENTIAL_FILE: credentialPath },
  };
  const toml = `[mcp_servers.${JSON.stringify(serverName)}]\ncommand = ${JSON.stringify(launch.command)}\nargs = ${JSON.stringify(launch.args)}\nenv = { WORK_INBOX_CREDENTIAL_FILE = ${JSON.stringify(credentialPath)} }`;
  const json = JSON.stringify({ mcpServers: { [serverName]: launch } }, null, 2);
  const configuration = client === 'codex' ? toml : json;
  const command =
    client === 'codex'
      ? `codex mcp add ${shellQuote(serverName)} --env ${shellQuote(`WORK_INBOX_CREDENTIAL_FILE=${credentialPath}`)} -- ${[launch.command, ...launch.args].map(shellQuote).join(' ')}`
      : client === 'claude-code'
        ? `claude mcp add --env ${shellQuote(`WORK_INBOX_CREDENTIAL_FILE=${credentialPath}`)} --transport stdio --scope local ${shellQuote(serverName)} -- ${[launch.command, ...launch.args].map(shellQuote).join(' ')}`
        : null;
  const target =
    client === 'codex'
      ? 'Codex'
      : client === 'claude-code'
        ? 'Claude Code'
        : client === 'claude-desktop'
          ? 'Claude Desktop'
          : 'the MCP client I am using';
  const setupPrompt = `Set up Work Inbox as a local MCP server in ${target} on this computer.

Use the existing connection named ${serverName}. The Work Inbox app must stay running locally. This is work intake only; it does not enable an execution worker.

Use the client's supported MCP configuration and preserve all existing servers and settings. Add only this server entry. If the same entry already matches, leave it unchanged; report any conflicting entry instead of overwriting it. Keep the credential in its existing protected local file. Do not print its contents, paste them into chat/configuration, or upload them.
${
  command
    ? `
Supported ${target} setup command:
${command}
`
    : ''
}
${client === 'codex' ? 'Manual TOML entry for ~/.codex/config.toml:' : 'MCP configuration (merge the server entry; adapt the outer JSON structure for your client if needed):'}
${configuration}

Reload the client's MCP connection if supported. Verify using the connected list_work tool from the client; do not create sample work. A standalone local launcher check does not verify the client connection. If a restart or new chat is required before the tool becomes available, report that the configuration is saved and explain the remaining step. Do not claim the connection is verified until that tool call succeeds.

If you cannot access or update local MCP settings in this environment, say so and give me the exact manual setup steps using the configuration above.`;
  const workflowHelper = standalone
    ? join(dirname(entry), 'work-inbox-workflow')
    : resolve(dirname(entry), '../workflow/index.js');
  const workflowPrefix = standalone
    ? shellQuote(workflowHelper)
    : `${shellQuote(node)} ${shellQuote(workflowHelper)}`;
  const workflowArgs = `--client ${shellQuote(client === 'claude-code' ? 'claude-code' : 'codex')} --credential-file ${shellQuote(credentialPath)} --helper ${shellQuote(workflowHelper)} --server-name ${shellQuote(serverName)}${standalone ? '' : ` --helper-node ${shellQuote(node)}`}`;
  const workflowPrompt = ['codex', 'claude-code'].includes(client)
    ? `Set up the Work Inbox project workflow for ${target} in the current project. Preserve existing files and settings. The MCP server is ${serverName}; do not duplicate or replace its configuration. Keep the credential in its existing protected file and never print its contents.\n\nUse this local helper, replacing PROJECT with the explicit absolute project directory:\n${workflowPrefix} preview --project PROJECT ${workflowArgs}\n\nIf the preview has no conflicts, apply the same command with install instead of preview. Use check to inspect freshness and remove to undo only managed content. Bind a stream or change only if explicitly selected, using --stream-id ID or --change-id ID. Never infer a stream from the project path.\n\n${client === 'claude-code' ? 'This installs a project skill, a managed CLAUDE.md section and a local SessionStart command hook for startup/resume/clear/compaction.' : 'This installs a project skill and a managed AGENTS.md section. It uses explicit context retrieval; automatic lifecycle hooks are not installed.'}\n\nStart a fresh client session and use get_workflow and get_stream_context from ${serverName}. Without a selection, getting stream choices is expected. Verify actual fresh-session delivery separately from MCP connectivity; a helper or launcher check alone does not prove client delivery. Do not create sample work.`
    : null;
  return {
    workflowPrompt,
    serverName,
    setupPrompt,
    configuration,

    command,
    launch,
  };
}
export class ConnectionService {
  constructor(
    public store: Store,
    public options: {
      origin: string;
      directory?: string;
      entry: string;
      node?: string;
      standalone?: boolean;
      clock?: () => number;
    },
  ) {}
  get clock() {
    return this.options.clock || Date.now;
  }
  get auth() {
    return new Auth(this.store, this.clock);
  }
  owner(a: Actor) {
    ensure(
      a.scope === 'owner' && a.id === 'owner' && a.ownerId === 'owner',
      403,
      'Only the local owner can manage connections.',
    );
  }
  row(id: string) {
    const row = this.store.db
      .select({ connection: agentConnections, revokedAt: credentials.revokedAt })
      .from(agentConnections)
      .innerJoin(credentials, eq(agentConnections.credentialId, credentials.id))
      .where(eq(agentConnections.id, id))
      .get();
    ensure(row, 404, 'Connection not found.');
    return row;
  }
  describe(row: ReturnType<ConnectionService['row']>) {
    const { credentialPath, idempotencyKey, credentialId, ...c } = row.connection;
    return {
      ...c,
      workflowRead:
        (this.store.raw
          .prepare(
            'SELECT workflowVersion,project,streamId,lastReadAt FROM workflow_reads WHERE credentialId=?',
          )
          .get(credentialId) as
          | {
              workflowVersion: string;
              project: string;
              streamId: string | null;
              lastReadAt: number;
            }
          | undefined) ?? null,
      client: c.client as ConnectionClient,
      state:
        row.revokedAt !== null
          ? ('disconnected' as const)
          : c.lastToolAt !== null
            ? ('verified' as const)
            : c.initializedAt !== null
              ? ('detected' as const)
              : ('pending' as const),
    };
  }
  list(a: Actor) {
    this.owner(a);
    return this.store.db
      .select({ connection: agentConnections, revokedAt: credentials.revokedAt })
      .from(agentConnections)
      .innerJoin(credentials, eq(agentConnections.credentialId, credentials.id))
      .where(isNotNull(agentConnections.completedAt))
      .orderBy(desc(agentConnections.createdAt), agentConnections.id)
      .limit(100)
      .all()
      .map((row) => this.describe(row));
  }
  get(a: Actor, id: string) {
    this.owner(a);
    return this.describe(this.row(id));
  }
  complete(a: Actor, id: string) {
    this.owner(a);
    return this.store.raw
      .transaction(() => {
        const row = this.row(id);
        ensure(row.revokedAt === null, 409, 'This setup was cancelled or disconnected.');
        ensure(
          row.connection.lastToolAt !== null,
          409,
          'Verify the agent with a successful tool call before finishing setup.',
        );
        if (row.connection.completedAt === null)
          this.store.db
            .update(agentConnections)
            .set({ completedAt: this.clock() })
            .where(eq(agentConnections.id, id))
            .run();
        return this.describe(this.row(id));
      })
      .immediate();
  }
  setup(a: Actor, id: string) {
    this.owner(a);
    const row = this.row(id);
    ensure(
      row.revokedAt === null,
      409,
      'This connection was disconnected. Create a new connection.',
    );
    return {
      ...this.describe(row),
      ...connectionConfiguration(
        row.connection.client as ConnectionClient,
        id,
        this.options.node || process.execPath,
        this.options.entry,
        row.connection.credentialPath,
        this.options.standalone,
      ),
    };
  }
  create(a: Actor, input: z.infer<typeof connectionCreateSchema>) {
    this.owner(a);
    ensure(this.options.directory, 503, 'Connection storage is not configured.');
    ensure(existsSync(this.options.entry), 503, 'Build Work Inbox before connecting an agent.');
    let createdPath: string | undefined;
    try {
      return this.store.raw
        .transaction(() => {
          const prior = this.store.db
            .select()
            .from(agentConnections)
            .where(eq(agentConnections.idempotencyKey, input.idempotencyKey))
            .get();
          if (prior) {
            ensure(
              prior.client === input.client && prior.name === input.name,
              409,
              'This setup request was already used with different details.',
            );
            return this.setup(a, prior.id);
          }
          const id = randomUUID();
          const path = resolve(this.options.directory!, `${id}.json`);
          mkdirSync(this.options.directory!, { recursive: true, mode: 0o700 });
          chmodSync(this.options.directory!, 0o700);
          const credential = this.auth.register('agent', input.name);
          writeFileSync(
            path,
            JSON.stringify({
              url: this.options.origin,
              token: credential.secret,
              credentialId: credential.id,
              actorId: credential.actorId,
            }),
            { flag: 'wx', mode: 0o600 },
          );
          createdPath = path;
          this.store.db
            .insert(agentConnections)
            .values({
              id,
              credentialId: credential.id,
              actorId: credential.actorId,
              name: input.name,
              client: input.client,
              credentialPath: path,
              idempotencyKey: input.idempotencyKey,
              createdAt: this.clock(),
            })
            .run();
          return this.setup(a, id);
        })
        .immediate();
    } catch (error) {
      if (createdPath && existsSync(createdPath)) unlinkSync(createdPath);
      throw error;
    }
  }
  revoke(a: Actor, id: string) {
    this.owner(a);
    const row = this.row(id);
    this.auth.revoke(row.connection.credentialId);
    if (row.connection.completedAt === null && existsSync(row.connection.credentialPath)) {
      try {
        unlinkSync(row.connection.credentialPath);
      } catch {
        /* Access is already revoked. */
      }
    }
    return this.describe(this.row(id));
  }
  activity(a: Actor, input: z.infer<typeof agentActivitySchema>) {
    ensure(a.scope === 'agent' && a.credentialId, 403, 'Agent credential required.');
    const patch =
      input.kind === 'initialized'
        ? { initializedAt: this.clock(), clientName: input.clientName }
        : { lastToolAt: this.clock(), lastTool: input.tool, clientName: input.clientName };
    this.store.db
      .update(agentConnections)
      .set(patch)
      .where(
        and(eq(agentConnections.credentialId, a.credentialId), eq(agentConnections.actorId, a.id)),
      )
      .run();
    return { ok: true };
  }
  async check(a: Actor, id: string) {
    this.owner(a);
    const row = this.row(id);
    ensure(row.revokedAt === null, 409, 'This connection was disconnected.');
    const client = new Client({ name: 'work-inbox-local-check', version: '0.1.0' });
    let ok = false;
    try {
      ensure(
        existsSync(row.connection.credentialPath) && existsSync(this.options.entry),
        503,
        'Setup files are missing.',
      );
      await client.connect(
        new StdioClientTransport({
          ...connectionConfiguration(
            row.connection.client as ConnectionClient,
            id,
            this.options.node || process.execPath,
            this.options.entry,
            row.connection.credentialPath,
            this.options.standalone,
          ).launch,
          env: {
            WORK_INBOX_CREDENTIAL_FILE: row.connection.credentialPath,
            WORK_INBOX_SETUP_CHECK: '1',
          },
          stderr: 'pipe',
        }),
        { timeout: 8000 },
      );
      const tools = await client.listTools({}, { timeout: 8000 });
      ensure(
        ['create_work', 'list_work', 'get_work', 'add_work_update'].every((name) =>
          tools.tools.some((t) => t.name === name),
        ),
        503,
        'Expected tools are missing.',
      );
      const result = await client.callTool(
        { name: 'list_work', arguments: { limit: 1 } },
        undefined,
        { timeout: 8000 },
      );
      ensure(!result.isError, 503, 'Credential/API check failed.');
      ok = true;
    } catch {
      /* Return a bounded diagnostic, never child output or credential values. */
    } finally {
      await client.close().catch(() => {});
    }
    this.store.db
      .update(agentConnections)
      .set({ lastCheckedAt: this.clock(), checkOk: ok })
      .where(eq(agentConnections.id, id))
      .run();
    return {
      ok,
      message: ok
        ? 'Local setup passed. Your agent still needs to make a tool call.'
        : 'Local check failed. Keep Work Inbox running, confirm setup files exist, and try again.',
      connection: this.describe(this.row(id)),
    };
  }
}
export type AgentConnection = ReturnType<ConnectionService['list']>[number];
export type AgentSetup = ReturnType<ConnectionService['setup']>;
