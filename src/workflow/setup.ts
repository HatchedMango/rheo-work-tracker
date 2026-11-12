import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { hash } from '../services/auth.js';
import { WORKFLOW_VERSION, workflowInstructions } from '../shared/streams.js';
import { shellQuote } from '../services/connections.js';
export const bindingSchema = z.object({
  version: z.string(),
  client: z.enum(['codex', 'claude-code']),
  project: z.string(),
  credentialFile: z.string(),
  helper: z.string(),
  helperNode: z.string().optional(),
  serverName: z.string().min(1).max(120),
  streamId: z.uuid().optional(),
  changeId: z.uuid().optional(),
  files: z.array(z.object({ path: z.string(), hash: z.string() })),
  blockHash: z.string(),
  hook: z.unknown().optional(),
  hooks: z.array(z.object({ event: z.string(), entry: z.unknown() })).optional(),
});
export type Binding = z.infer<typeof bindingSchema>;
export type SetupOptions = {
  project: string;
  client: 'codex' | 'claude-code';
  credentialFile: string;
  helper: string;
  helperNode?: string;
  serverName: string;
  streamId?: string;
  changeId?: string;
};
const markers = (client: string) => ({
  start: `<!-- work-inbox:${client}:start -->`,
  end: `<!-- work-inbox:${client}:end -->`,
});
const instructionFile = (client: string) => (client === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
function read(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
function safePath(project: string, path: string) {
  const full = resolve(project, path),
    rel = relative(project, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Managed paths must stay inside the project.');
  let item = full;
  while (item !== project) {
    if (existsSync(item) && lstatSync(item).isSymbolicLink())
      throw new Error(`Refusing a symlink at ${relative(project, item)}.`);
    item = dirname(item);
  }
  return full;
}
function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600;
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}
function apply(changes: Map<string, string | null>) {
  const previous = new Map<string, { content: string; mode: number } | null>();
  for (const path of changes.keys())
    previous.set(
      path,
      existsSync(path) ? { content: read(path), mode: lstatSync(path).mode & 0o777 } : null,
    );
  try {
    for (const [path, content] of changes) {
      if (content === null) rmSync(path, { force: true });
      else write(path, content);
    }
  } catch (error) {
    for (const [path, old] of [...previous].reverse()) {
      try {
        if (old) {
          write(path, old.content);
          chmodSync(path, old.mode);
        } else rmSync(path, { force: true });
      } catch {
        /* Preserve the original failure; backups are in memory until return. */
      }
    }
    throw error;
  }
}
function section(text: string, client: string) {
  const { start, end } = markers(client),
    first = text.indexOf(start),
    last = text.indexOf(end);
  if (first < 0 && last < 0) return null;
  if (
    first < 0 ||
    last < first ||
    text.indexOf(start, first + 1) >= 0 ||
    text.indexOf(end, last + 1) >= 0
  )
    throw new Error('Malformed or duplicate Work Inbox instruction section.');
  return { start: first, end: last + end.length, body: text.slice(first, last + end.length) };
}
function block(o: SetupOptions) {
  const m = markers(o.client);
  return `${m.start}\n## Work Inbox\n\nUse the work-inbox skill for work tracked through ${o.serverName}. Load get_workflow and get_stream_context with the explicitly selected stream/change at session start, resume, and after compaction before continuing. Read .work-inbox/${o.client}.json for the explicit streamId/changeId binding, if present. This local manifest contains paths and selection only; never read or print the credential file it references. If there is no selection, ask; never infer one from a repository path. Keep decisions, dependencies, uncertainty, progress, and output evidence current. Claim accepted work cooperatively, release at handoff, and leave a concise durable handoff. Work Inbox grants no execution or Git authority. If unavailable, report the failure; do not treat an empty result as fresh context.\n\nWorkflow version: ${WORKFLOW_VERSION}. Project lifecycle helpers load explicit context and check for saved checkpoints. Review/trust hooks in the client; installed hooks are not proof they have run.\n${m.end}`;
}
export function skill() {
  return `---\nname: work-inbox\ndescription: Use when work is tracked in Work Inbox to recover current context, coordinate changes, and preserve decisions and handoffs.\n---\n\n# Work Inbox\n\n${workflowInstructions}\n\nCall get_workflow for current guidance. get_stream_context accepts streamId or changeId and bounded pagination. Use returned IDs to retrieve full change details and follow each collection cursor. Never invent a binding or choose work on the app's behalf.\n`;
}
function assets(o: SetupOptions) {
  const root = o.client === 'codex' ? '.agents/skills/work-inbox' : '.claude/skills/work-inbox';
  const files = [{ path: `${root}/SKILL.md`, content: skill() }];
  if (o.client === 'codex') {
    const pluginRoot = '.work-inbox/codex-plugin';
    const onboarding = `---\nname: setup\ndescription: Check Work Inbox workflow setup and retrieve current context using the existing MCP connection.\n---\n\nRead the project's .work-inbox/codex.json binding for explicit stream/change IDs; never read the protected credential file. Use get_workflow and get_stream_context from ${o.serverName}. If unbound, show stream choices and ask for selection. Do not create sample work. A successful launcher check does not verify client connectivity. Report missing tools and request a client reload/new chat if needed. Guidance installed, connectivity, and observed context retrieval are separate checks.\n`;
    files.push(
      {
        path: `${pluginRoot}/plugin.json`,
        content:
          JSON.stringify(
            {
              name: 'work-inbox',
              version: WORKFLOW_VERSION,
              description: 'Durable work context and cooperative change tracking',
              extensions: { 'com.openai': { onboardingSkill: './skills/setup/SKILL.md' } },
            },
            null,
            2,
          ) + '\n',
      },
      {
        path: `${pluginRoot}/.codex-plugin/plugin.json`,
        content:
          JSON.stringify(
            {
              name: 'work-inbox',
              version: WORKFLOW_VERSION,
              description: 'Durable work context and cooperative change tracking',
              skills: './skills',
              onboardingSkill: './skills/setup/SKILL.md',
            },
            null,
            2,
          ) + '\n',
      },
      { path: `${pluginRoot}/skills/work-inbox/SKILL.md`, content: skill() },
      { path: `${pluginRoot}/skills/setup/SKILL.md`, content: onboarding },
    );
  }
  return files;
}
function settings(project: string, client: SetupOptions['client']) {
  const path = safePath(
      project,
      client === 'codex' ? '.codex/hooks.json' : '.claude/settings.local.json',
    ),
    text = read(path);
  let value: Record<string, unknown>;
  try {
    value = text ? JSON.parse(text) : {};
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
  } catch {
    throw new Error('Client hook settings are not a JSON object; no changes made.');
  }
  if (
    value.hooks !== undefined &&
    (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks))
  )
    throw new Error('Client hooks must be an object.');
  return { path, value };
}
function managedHooks(o: SetupOptions, bindingPath: string) {
  return [
    'SessionStart',
    'UserPromptSubmit',
    'Stop',
    ...(o.client === 'codex' ? ['Interrupt'] : []),
  ].map((event) => ({
    event,
    entry: {
      ...(event === 'SessionStart' ? { matcher: 'startup|resume|clear|compact|fork' } : {}),
      hooks: [
        {
          type: 'command',
          command: `${o.helperNode ? shellQuote(o.helperNode) + ' ' : ''}${shellQuote(o.helper)} hook --binding ${shellQuote(bindingPath)}`,
          timeout: 8,
        },
      ],
    },
  }));
}
export function workflowSetup(
  operation: 'preview' | 'install' | 'check' | 'remove',
  options: SetupOptions,
) {
  const project = realpathSync(resolve(options.project));
  if (!lstatSync(project).isDirectory()) throw new Error('Project must be a directory.');
  const o = { ...options, project };
  if (!isAbsolute(o.credentialFile) || !isAbsolute(o.helper))
    throw new Error('Credential and helper paths must be absolute.');
  const manifestPath = safePath(project, `.work-inbox/${o.client}.json`);
  const old = existsSync(manifestPath) ? bindingSchema.parse(JSON.parse(read(manifestPath))) : null;
  if (old && (old.project !== project || old.client !== o.client))
    throw new Error('Existing binding belongs to another project/client.');
  const docPath = safePath(project, instructionFile(o.client)),
    doc = read(docPath),
    current = section(doc, o.client),
    desired = block(o),
    files = assets(o),
    conflicts: string[] = [];
  if (current && (!old || hash(current.body) !== old.blockHash))
    conflicts.push(
      `${instructionFile(o.client)} managed section was edited or has no ownership record.`,
    );
  for (const f of files) {
    const path = safePath(project, f.path),
      existing = read(path),
      owned = old?.files.find((x) => x.path === f.path);
    if (existsSync(path) && (!owned || hash(existing) !== owned.hash))
      conflicts.push(`${f.path} was edited or already exists outside this setup.`);
  }
  const cfg = settings(project, o.client);
  const hooks = (cfg.value.hooks ?? {}) as Record<string, unknown>;
  const ownedHooks = old?.hooks ?? (old?.hook ? [{ event: 'SessionStart', entry: old.hook }] : []);
  const desiredHooks = managedHooks(o, manifestPath);
  for (const event of new Set([...ownedHooks, ...desiredHooks].map((h) => h.event))) {
    if (hooks[event] !== undefined && !Array.isArray(hooks[event]))
      throw new Error(`Client ${event} hooks must be an array.`);
  }
  for (const owned of ownedHooks) {
    if (
      !((hooks[owned.event] as unknown[]) ?? []).some(
        (x) => JSON.stringify(x) === JSON.stringify(owned.entry),
      )
    )
      conflicts.push(`The managed ${owned.event} hook was changed or removed.`);
  }
  const mergedHooks = { ...hooks };
  for (const owned of ownedHooks)
    mergedHooks[owned.event] = ((mergedHooks[owned.event] as unknown[]) ?? []).filter(
      (x) => JSON.stringify(x) !== JSON.stringify(owned.entry),
    );
  const missing = files.filter((f) => !existsSync(safePath(project, f.path))).map((f) => f.path);
  if (!current) missing.push(instructionFile(o.client));
  const stale =
    !old ||
    old.version !== WORKFLOW_VERSION ||
    current?.body !== desired ||
    files.some((f) => read(safePath(project, f.path)) !== f.content) ||
    old.credentialFile !== o.credentialFile ||
    old.helper !== o.helper ||
    old.helperNode !== o.helperNode ||
    old.serverName !== o.serverName ||
    old.streamId !== o.streamId ||
    old.changeId !== o.changeId ||
    JSON.stringify(old.hooks) !== JSON.stringify(desiredHooks);
  const report = {
    version: WORKFLOW_VERSION,
    project,
    client: o.client,
    installed: !!old,
    current: !!old && !stale && !missing.length && !conflicts.length,
    missing,
    conflicts,
    files: [
      instructionFile(o.client),
      ...files.map((f) => f.path),
      relative(project, cfg.path),
      relative(project, manifestPath),
    ],
    hook: 'SessionStart, UserPromptSubmit, Stop' + (o.client === 'codex' ? ', Interrupt' : ''),
    hooksTrusted: false,
    connectionVerified: false,
    workflowVerified: false,
  };
  if (operation === 'preview' || operation === 'check') return report;
  if (conflicts.length) throw new Error(`No changes made. ${conflicts.join(' ')}`);
  const mutations = new Map<string, string | null>();
  if (operation === 'remove') {
    if (!old) return report;
    // Preflight every owned file, including files from older adapter versions.
    for (const f of old.files) {
      const path = safePath(project, f.path);
      if (existsSync(path) && hash(read(path)) !== f.hash)
        throw new Error(`No changes made. ${f.path} was edited.`);
    }
    if (current) {
      let next = doc.slice(0, current.start) + doc.slice(current.end);
      if (current.end === doc.length) next = next.replace(/\n\n$/, '');
      mutations.set(docPath, next || null);
    }
    for (const owned of ownedHooks)
      if ((mergedHooks[owned.event] as unknown[]).length === 0) delete mergedHooks[owned.event];
    cfg.value.hooks = mergedHooks;
    if (!Object.keys(mergedHooks).length) delete cfg.value.hooks;
    mutations.set(
      cfg.path,
      Object.keys(cfg.value).length ? JSON.stringify(cfg.value, null, 2) + '\n' : null,
    );
    for (const f of old.files) mutations.set(safePath(project, f.path), null);
    mutations.set(manifestPath, null);
    apply(mutations);
    return { ...report, installed: false, current: false };
  }
  const nextDoc = current
    ? doc.slice(0, current.start) + desired + doc.slice(current.end)
    : `${doc}${doc ? '\n\n' : ''}${desired}`;
  const binding: Binding = {
    version: WORKFLOW_VERSION,
    client: o.client,
    project,
    credentialFile: o.credentialFile,
    helper: o.helper,
    helperNode: o.helperNode,
    serverName: o.serverName,
    streamId: o.streamId,
    changeId: o.changeId,
    files: files.map((f) => ({ path: f.path, hash: hash(f.content) })),
    blockHash: hash(desired),
    hooks: desiredHooks,
  };
  // The manifest contains paths/selection only. Credential bytes never enter project files.
  mutations.set(docPath, nextDoc);
  for (const f of files) mutations.set(safePath(project, f.path), f.content);
  for (const desired of desiredHooks)
    mergedHooks[desired.event] = [
      ...((mergedHooks[desired.event] as unknown[]) ?? []),
      desired.entry,
    ];
  cfg.value.hooks = mergedHooks;
  mutations.set(cfg.path, JSON.stringify(cfg.value, null, 2) + '\n');
  mutations.set(manifestPath, JSON.stringify(binding, null, 2) + '\n');
  apply(mutations);
  return { ...report, installed: true, current: true, missing: [] };
}
