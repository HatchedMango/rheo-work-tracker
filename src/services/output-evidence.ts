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
import { nativeKeychain, type GitLabKeychain } from './keychain.js';
const configSchema = z.union([
  z.object({ origin: z.url(), tokenFile: z.string().min(1) }).strict(),
  z.object({ origin: z.url(), keychainId: z.uuid() }).strict(),
]);
type GitLabConfig = z.infer<typeof configSchema>;
const sha = z.string().regex(/^[a-f0-9]{40,64}$/i);
const mrSchema = z.object({
  web_url: z.url(),
  state: z.enum(['opened', 'closed', 'merged', 'locked']),
  sha,
  detailed_merge_status: z
    .string()
    .max(100)
    .regex(/^[a-z_]+$/)
    .nullish(),
  has_conflicts: z.boolean().nullish(),
  blocking_discussions_resolved: z.boolean().nullish(),
  draft: z.boolean().nullish(),
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
class CheckFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}
function httpFailure(status: number): CheckFailure {
  const failures: Record<number, [string, string]> = {
    401: ['authentication', 'GitLab rejected the token (HTTP 401). Update access in Connections.'],
    403: ['permission', 'GitLab denied access (HTTP 403). Check token scope and project access.'],
    404: [
      'not_found',
      'MR not found or not visible (HTTP 404). Check its URL, whether the project moved, and token access.',
    ],
    429: ['rate_limited', 'GitLab rate limited this check (HTTP 429). Wait before retrying.'],
  };
  const [code, message] =
    failures[status] ??
    (status >= 300 && status < 400
      ? [
          'redirect',
          'GitLab redirected the request. Check the linked MR and configured host; redirects are not followed.',
        ]
      : ['http', `GitLab returned HTTP ${status}. Check service availability and retry.`]);
  return new CheckFailure(code, status, message);
}
export class OutputEvidenceService {
  private configQueue: Promise<unknown> = Promise.resolve();
  private serializeConfig<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.configQueue.then(operation, operation);
    this.configQueue = next.catch(() => {});
    return next;
  }
  constructor(
    private streams: StreamService,
    private directory = join(dataDir, 'integrations'),
    private fetcher?: typeof fetch,
    private keychain: GitLabKeychain | null = process.platform === 'darwin'
      ? nativeKeychain()
      : null,
  ) {}
  private configPath() {
    return process.env.RHEO_GITLAB_CONFIG || join(this.directory, 'gitlab.json');
  }
  status(a: Actor) {
    this.streams.allow(a);
    try {
      const config = configSchema.parse(JSON.parse(protectedText(this.configPath())));
      return {
        configured: true,
        origin: config.origin,
        managed: !!process.env.RHEO_GITLAB_CONFIG,
        storage: 'keychainId' in config ? 'keychain' : 'file',
      };
    } catch {
      return {
        configured: false,
        origin: null,
        managed: !!process.env.RHEO_GITLAB_CONFIG,
        storage: this.keychain ? 'keychain' : 'file',
      };
    }
  }
  configure(a: Actor, input: unknown) {
    return this.serializeConfig(() => this.configureOnce(a, input));
  }
  private async configureOnce(a: Actor, input: unknown) {
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
    const previous = this.previousConfig();
    const next: GitLabConfig = this.keychain
      ? { origin: host.origin, keychainId: randomUUID() }
      : { origin: host.origin, tokenFile: join(directory, 'gitlab-token-' + randomUUID()) };
    if ('keychainId' in next) {
      try {
        await this.keychain!.write(next.keychainId, p.token);
      } catch {
        try {
          await this.keychain!.remove(next.keychainId);
        } catch {
          /* A denied Keychain remains protected. */
        }
        throw new AppError(
          409,
          'macOS Keychain access is unavailable. Unlock your keychain or check local access policy, then retry.',
        );
      }
    } else writeFileSync(next.tokenFile, p.token, { flag: 'wx', mode: 0o600 });
    try {
      privateWrite(this.configPath(), next);
    } catch (error) {
      await this.removeSecret(next);
      throw error;
    }
    try {
      await this.removeSecret(previous);
    } catch {
      // Keep the previous reference retryable if Keychain cleanup was denied.
      if (previous) privateWrite(this.configPath(), previous);
      else rmSync(this.configPath(), { force: true });
      try {
        await this.removeSecret(next);
      } catch {
        /* No secret is exposed by cleanup errors. */
      }
      throw new AppError(
        409,
        'Previous GitLab access could not be removed from Keychain. Check local Keychain access and retry.',
      );
    }
    return this.status(a);
  }
  private previousConfig() {
    try {
      return configSchema.parse(JSON.parse(protectedText(this.configPath())));
    } catch {
      return null;
    }
  }
  private async removeSecret(config: GitLabConfig | null) {
    if (!config) return;
    if ('keychainId' in config) {
      ensure(this.keychain, 409, 'macOS Keychain is unavailable on this platform.');
      await this.keychain.remove(config.keychainId);
    } else this.removeOwnedToken(config.tokenFile);
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
    return this.serializeConfig(() => this.disconnectOnce(a));
  }
  private async disconnectOnce(a: Actor) {
    ensure(a.scope === 'owner' && a.id === 'owner', 403, 'Only the owner can configure GitLab.');
    ensure(
      !process.env.RHEO_GITLAB_CONFIG,
      409,
      'GitLab configuration is managed outside the app.',
    );
    const previous = this.previousConfig();
    try {
      await this.removeSecret(previous);
    } catch {
      throw new AppError(
        409,
        'GitLab access could not be removed from Keychain. Check local Keychain access and retry.',
      );
    }
    rmSync(this.configPath(), { force: true });
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
          hasConflicts: row.hasConflicts === null ? null : !!row.hasConflicts,
          discussionsResolved: row.discussionsResolved === null ? null : !!row.discussionsResolved,
          draft: row.draft === null ? null : !!row.draft,
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
      token = (
        'keychainId' in config
          ? ((await this.keychain?.read(config.keychainId)) ?? '')
          : protectedText(config.tokenFile)
      ).trim();
    } catch {
      throw new AppError(
        409,
        'GitLab access is unavailable. Unlock your keychain or update access in Connections.',
      );
    }
    ensure(
      token.length >= 10 && token.length <= 2000 && !/\s/.test(token),
      400,
      'GitLab access token is unavailable or invalid. Update access in Connections.',
    );
    let result: Pick<
      OutputObservation,
      | 'status'
      | 'mrState'
      | 'codeRevision'
      | 'pipelineStatus'
      | 'message'
      | 'mergeStatus'
      | 'hasConflicts'
      | 'discussionsResolved'
      | 'draft'
      | 'failureCode'
      | 'httpStatus'
    >;
    let httpStatus: number | null = null;
    try {
      const response = await (this.fetcher ?? fetch)(
        `${host.origin}/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${match[2]}`,
        {
          method: 'GET',
          headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        },
      );
      httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        throw httpFailure(response.status);
      }
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1_000_000) {
          await reader.cancel();
          throw new CheckFailure(
            'invalid_response',
            httpStatus,
            'GitLab response exceeded the size limit. Check the linked MR in GitLab.',
          );
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
        mergeStatus: mr.detailed_merge_status ?? null,
        // GitLab reports false while mergeability is still being calculated.
        hasConflicts:
          mr.detailed_merge_status === 'conflict' || mr.has_conflicts === true
            ? true
            : mr.detailed_merge_status === 'mergeable' && mr.has_conflicts === false
              ? false
              : null,
        discussionsResolved: mr.blocking_discussions_resolved ?? null,
        draft: mr.draft ?? null,
        failureCode: null,
        httpStatus,
        message: 'Read from GitLab. This observation does not establish delivery or acceptance.',
      };
    } catch (error) {
      const failure =
        error instanceof CheckFailure
          ? error
          : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? new CheckFailure(
                'timeout',
                httpStatus,
                'GitLab check timed out. Check connectivity and retry.',
              )
            : httpStatus === null
              ? new CheckFailure(
                  'network',
                  null,
                  'GitLab could not be reached. Check connectivity, VPN requirements and certificate trust, then retry.',
                )
              : new CheckFailure(
                  'invalid_response',
                  httpStatus,
                  'GitLab returned an unexpected response. Check the linked MR in GitLab and retry.',
                );
      result = {
        status: 'unavailable',
        mrState: null,
        codeRevision: null,
        pipelineStatus: null,
        mergeStatus: null,
        hasConflicts: null,
        discussionsResolved: null,
        draft: null,
        failureCode: failure.code,
        httpStatus: failure.status,
        message: failure.message,
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
        JSON.stringify(currentConfig) === JSON.stringify(config),
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
          "INSERT INTO output_observations(id,outputId,outputRevision,checkedBy,checkedAt,source,status,mrState,codeRevision,pipelineStatus,message,mergeStatus,hasConflicts,discussionsResolved,draft,failureCode,httpStatus) VALUES (?,?,?,?,?,'gitlab',?,?,?,?,?,?,?,?,?,?,?)",
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
          result.mergeStatus,
          result.hasConflicts === null ? null : Number(result.hasConflicts),
          result.discussionsResolved === null ? null : Number(result.discussionsResolved),
          result.draft === null ? null : Number(result.draft),
          result.failureCode,
          result.httpStatus,
        );
    });
    return this.latest(output)!;
  }
}
