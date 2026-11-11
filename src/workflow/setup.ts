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
  return `${m.start}\n## Work Inbox\n\nUse the work-inbox skill for work tracked through ${o.serverName}. Load get_workflow and get_stream_context with the explicitly selected stream/change at session start, resume, and after compaction before continuing. Read .work-inbox/${o.client}.json for the explicit streamId/changeId binding, if present. This local manifest contains paths and selection only; never read or print the credential file it references. If there is no selection, ask; never infer one from a repository path. Keep decisions, dependencies, uncertainty, progress, and output evidence current. Claim accepted work cooperatively, release at handoff, and leave a concise durable handoff. Work Inbox grants no execution or Git authority. If unavailable, report the failure; do not treat an empty result as fresh context.\n\nWorkflow version: ${WORKFLOW_VERSION}. ${o.client === 'claude-code' ? 'The local SessionStart helper supplies fresh context before MCP becomes available.' : 'This project fallback uses explicit context retrieval; it does not promise automatic lifecycle hooks.'}\n${m.end}`;
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
function settings(project: string) {
  const path = safePath(project, '.claude/settings.local.json'),
    text = read(path);
  let value: Record<string, unknown>;
  try {
    value = text ? JSON.parse(text) : {};
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
  } catch {
    throw new Error('Claude settings are not a JSON object; no changes made.');
  }
  return { path, value };
}
function hookEntries(value: Record<string, unknown>) {
  const hooks = value.hooks as Record<string, unknown> | undefined;
  if (hooks !== undefined && (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)))
    throw new Error('Claude hooks must be an object.');
  const entries = hooks?.SessionStart;
  if (entries !== undefined && !Array.isArray(entries))
    throw new Error('Claude SessionStart hooks must be an array.');
  return (entries ?? []) as unknown[];
}
function hook(o: SetupOptions, bindingPath: string) {
  return {
    matcher: 'startup|resume|clear|compact|fork',
    hooks: [
      {
        type: 'command',
        command: `${o.helperNode ? shellQuote(o.helperNode) + ' ' : ''}${shellQuote(o.helper)} context --binding ${shellQuote(bindingPath)}`,
        timeout: 5,
      },
    ],
  };
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
  const cfg = o.client === 'claude-code' ? settings(project) : null;
  const entries = cfg ? hookEntries(cfg.value) : [];
  const oldIndex = old?.hook
    ? entries.findIndex((x) => JSON.stringify(x) === JSON.stringify(old.hook))
    : -1;
  if (old?.hook && oldIndex === -1)
    conflicts.push('The managed Claude SessionStart hook was changed or removed.');
  const desiredHook = o.client === 'claude-code' ? hook(o, manifestPath) : undefined;
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
    old.changeId !== o.changeId;
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
      ...(cfg ? ['.claude/settings.local.json'] : []),
      relative(project, manifestPath),
    ],
    hook:
      o.client === 'claude-code'
        ? 'SessionStart startup/resume/clear/compact'
        : 'Explicit context retrieval; no automatic hook',
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
    if (cfg && oldIndex >= 0) {
      const hooks = cfg.value.hooks as Record<string, unknown>;
      hooks.SessionStart = entries.filter((_, i) => i !== oldIndex);
      mutations.set(cfg.path, JSON.stringify(cfg.value, null, 2) + '\n');
    }
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
    hook: desiredHook,
  };
  // The manifest contains paths/selection only. Credential bytes never enter project files.
  mutations.set(docPath, nextDoc);
  for (const f of files) mutations.set(safePath(project, f.path), f.content);
  if (cfg) {
    const hooks = (cfg.value.hooks ?? {}) as Record<string, unknown>;
    hooks.SessionStart = [...entries.filter((_, i) => i !== oldIndex), desiredHook];
    cfg.value.hooks = hooks;
    mutations.set(cfg.path, JSON.stringify(cfg.value, null, 2) + '\n');
  }
  mutations.set(manifestPath, JSON.stringify(binding, null, 2) + '\n');
  apply(mutations);
  return { ...report, installed: true, current: true, missing: [] };
}
