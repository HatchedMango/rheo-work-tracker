import { existsSync, lstatSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../shared/contracts.js';
import type { Output } from '../shared/streams.js';
import type { OutputEvidence, OutputObservation } from '../shared/output-evidence.js';
import type { StreamService } from './streams.js';
import { AppError, ensure } from './errors.js';
import { dataDir } from '../config.js';
import { privateDirectory, privateWrite } from '../workflow/outbox.js';
const configSchema = z.object({ origin: z.url(), tokenFile: z.string().min(1) }).strict();
const sha = z.string().regex(/^[a-f0-9]{40,64}$/i);
const mrSchema = z.object({
  web_url: z.url(),
  state: z.enum(['opened', 'closed', 'merged', 'locked']),
  sha,
  head_pipeline: z
    .object({
      sha: sha.nullable().optional(),
      status: z
        .enum([
          'created',
          'waiting_for_resource',
          'preparing',
          'pending',
          'running',
          'success',
          'failed',
          'canceled',
          'skipped',
          'manual',
          'scheduled',
          'unknown',
        ])
        .catch('unknown'),
    })
    .nullable()
    .optional(),
});
function protectedText(path: string) {
  ensure(isAbsolute(path), 400, 'GitLab configuration paths must be absolute.');
  const info = lstatSync(path);
  ensure(
    info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0,
    400,
    'GitLab configuration and token files must be private regular files (mode 600).',
  );
  return readFileSync(path, 'utf8');
}
function canonical(url: URL) {
  return url.origin + url.pathname.replace(/\/$/, '');
}
export class OutputEvidenceService {
  constructor(
    private streams: StreamService,
    private directory = join(dataDir, 'integrations'),
    private fetcher?: typeof fetch,
  ) {}
  private configPath() {
    return process.env.RHEO_GITLAB_CONFIG || join(this.directory, 'gitlab.json');
  }
  status(a: Actor) {
    this.streams.allow(a);
    try {
      const config = configSchema.parse(JSON.parse(protectedText(this.configPath())));
      return { configured: true, origin: config.origin, managed: !!process.env.RHEO_GITLAB_CONFIG };
    } catch {
      return { configured: false, origin: null, managed: !!process.env.RHEO_GITLAB_CONFIG };
    }
  }
  configure(a: Actor, input: unknown) {
    ensure(a.scope === 'owner' && a.id === 'owner', 403, 'Only the owner can configure GitLab.');
    ensure(
      !process.env.RHEO_GITLAB_CONFIG,
      409,
      'GitLab configuration is managed outside the app.',
    );
    const p = z
      .object({ origin: z.url(), token: z.string().min(10).max(2000).regex(/^\S+$/) })
      .strict()
      .parse(input);
    const host = new URL(p.origin);
    ensure(
      host.protocol === 'https:' &&
        !host.username &&
        !host.password &&
        host.href === host.origin + '/',
      400,
      'Use a GitLab HTTPS origin without paths, credentials or query parameters.',
    );
    const directory = privateDirectory(this.directory);
    const previous = this.previousToken();
    const tokenFile = join(directory, 'gitlab-token-' + randomUUID());
    writeFileSync(tokenFile, p.token, { flag: 'wx', mode: 0o600 });
    try {
      privateWrite(this.configPath(), { origin: host.origin, tokenFile });
    } catch (error) {
      rmSync(tokenFile, { force: true });
      throw error;
    }
    this.removeOwnedToken(previous);
    return this.status(a);
  }
  private previousToken() {
    try {
      return configSchema.parse(JSON.parse(protectedText(this.configPath()))).tokenFile;
    } catch {
      return null;
    }
  }
  private removeOwnedToken(path: string | null) {
    if (
      path &&
      resolve(dirname(path)) === resolve(this.directory) &&
      /^gitlab-token-[a-f0-9-]{36}$/.test(basename(path))
    )
      rmSync(path, { force: true });
  }
  disconnect(a: Actor) {
    ensure(a.scope === 'owner' && a.id === 'owner', 403, 'Only the owner can configure GitLab.');
    ensure(
      !process.env.RHEO_GITLAB_CONFIG,
      409,
      'GitLab configuration is managed outside the app.',
    );
    const previous = this.previousToken();
    rmSync(this.configPath(), { force: true });
    this.removeOwnedToken(previous);
    return this.status(a);
  }
  list(a: Actor, workId: string): OutputEvidence {
    this.streams.work.row(a, workId);
    const page = this.streams.outputs(a, workId, 100, 0);
    const outputs = page.items as Output[];
    return {
      configured: this.status(a).configured,
      omittedOutputs: Math.max(0, page.total - outputs.length),
      outputs: outputs.map((output) => ({ ...output, observation: this.latest(output) })),
    };
  }
  private latest(output: Output): OutputObservation | null {
    const row = this.streams.raw
      .prepare(
        'SELECT * FROM output_observations WHERE outputId=? ORDER BY checkedAt DESC,rowid DESC LIMIT 1',
      )
      .get(output.id) as Omit<OutputObservation, 'applicable'> | undefined;
    return row
      ? {
          ...row,
          applicable:
            row.outputRevision === output.revision &&
            (row.status !== 'observed' ||
              !/^[a-f0-9]{40,64}$/i.test(output.codeRevision) ||
              row.codeRevision?.toLowerCase() === output.codeRevision.toLowerCase()),
        }
      : null;
  }
  async observe(a: Actor, workId: string, outputId: string, revision: number) {
    this.streams.allow(a);
    this.streams.work.row(a, workId);
    const output = this.streams.raw
      .prepare('SELECT * FROM change_outputs WHERE id=? AND workId=?')
      .get(outputId, workId) as Output | undefined;
    ensure(output, 404, 'Output not found for this change.');
    ensure(output.revision === revision, 409, 'Output changed; reload it before checking.');
    ensure(
      output.kind === 'mr',
      400,
      'Only explicitly linked merge request outputs can be checked.',
    );
    ensure(
      existsSync(this.configPath()),
      409,
      'Configure a private GitLab host/token file on this Mac before checking MRs.',
    );
    let config: z.infer<typeof configSchema>;
    try {
      config = configSchema.parse(JSON.parse(protectedText(this.configPath())));
    } catch {
      throw new AppError(
        409,
        'GitLab configuration is unavailable or invalid; check the private local configuration.',
      );
    }
    const host = new URL(config.origin),
      link = new URL(output.url);
    ensure(
      host.protocol === 'https:' &&
        host.href === host.origin + '/' &&
        !host.username &&
        !host.password,
      400,
      'Configure a GitLab HTTPS origin without paths, credentials or query parameters.',
    );
    ensure(
      link.origin === host.origin && !link.username && !link.password,
      400,
      'The MR must belong to the explicitly configured GitLab host.',
    );
    const match = /^\/(.+)\/-\/merge_requests\/([1-9]\d*)\/?$/.exec(link.pathname);
    ensure(match, 400, 'Use a GitLab merge request URL.');
    const project = decodeURIComponent(match[1]);
    ensure(
      project.split('/').length >= 2 &&
        project
          .split('/')
          .every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'),
      400,
      'Invalid GitLab project path.',
    );
    let token: string;
    try {
      token = protectedText(config.tokenFile).trim();
    } catch {
      throw new AppError(
        409,
        'GitLab token file is unavailable or is not private. Update access in Connections.',
      );
    }
    ensure(
      token.length >= 10 && token.length <= 2000 && !/\s/.test(token),
      400,
      'GitLab token file is invalid.',
    );
    let result: Pick<
      OutputObservation,
      'status' | 'mrState' | 'codeRevision' | 'pipelineStatus' | 'message'
    >;
    try {
      const response = await (this.fetcher ?? fetch)(
        `${host.origin}/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${match[2]}`,
        {
          method: 'GET',
          headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw new Error('GitLab request failed');
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1_000_000) {
          await reader.cancel();
          throw new Error('GitLab response too large');
        }
        chunks.push(chunk.value);
      }
      const mr = mrSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      ensure(
        canonical(new URL(mr.web_url)) === canonical(link),
        400,
        'GitLab returned a different merge request.',
      );
      result = {
        status: 'observed',
        mrState: mr.state,
        codeRevision: mr.sha,
        pipelineStatus: mr.head_pipeline?.sha === mr.sha ? mr.head_pipeline.status : null,
        message: 'Read from GitLab. This observation does not establish delivery or acceptance.',
      };
    } catch {
      result = {
        status: 'unavailable',
        mrState: null,
        codeRevision: null,
        pipelineStatus: null,
        message:
          'GitLab could not be checked. Earlier observations remain historical; the reported work state is unchanged.',
      };
    }
    // Fence the network response against edits made while the request was in flight.
    this.streams.tx(() => {
      this.streams.work.row(a, workId);
      let currentConfig: z.infer<typeof configSchema> | null = null;
      try {
        currentConfig = configSchema.parse(JSON.parse(protectedText(this.configPath())));
      } catch {
        /* Disconnected or replaced while checking. */
      }
      ensure(
        currentConfig?.origin === config.origin && currentConfig?.tokenFile === config.tokenFile,
        409,
        'GitLab access changed during the check; discard this response and check again.',
      );
      if (a.credentialId) {
        const credential = this.streams.raw
          .prepare('SELECT revokedAt,expiresAt FROM credentials WHERE id=?')
          .get(a.credentialId) as
          { revokedAt: number | null; expiresAt: number | null } | undefined;
        ensure(
          credential &&
            credential.revokedAt === null &&
            (credential.expiresAt === null || credential.expiresAt > this.streams.now()),
          403,
          'The connection is no longer authorized.',
        );
      }
      const current = this.streams.raw
        .prepare('SELECT revision FROM change_outputs WHERE id=? AND workId=?')
        .get(outputId, workId) as { revision: number } | undefined;
      ensure(
        current?.revision === revision,
        409,
        'Output changed during the check; discard this response and reload.',
      );
      this.streams.raw
        .prepare(
          "INSERT INTO output_observations(id,outputId,outputRevision,checkedBy,checkedAt,source,status,mrState,codeRevision,pipelineStatus,message) VALUES (?,?,?,?,?,'gitlab',?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          outputId,
          revision,
          a.id,
          this.streams.now(),
          result.status,
          result.mrState,
          result.codeRevision,
          result.pipelineStatus,
          result.message,
        );
    });
    return this.latest(output)!;
  }
}
