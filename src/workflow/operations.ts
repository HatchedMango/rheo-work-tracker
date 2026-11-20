import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { bindingSchema } from './setup.js';
import { ApiError, apiClient, readCredential } from '../shared/client.js';
import { privateDirectory, privateWrite, SyncOutbox } from './outbox.js';
import { readSession, withSession } from './session-state.js';
import { assessmentReportSchema } from '../shared/dependency-assessments.js';
import { WORKFLOW_VERSION, type Claim } from '../shared/streams.js';
import { hash } from '../services/auth.js';
import { resolveWorkSelection } from './work-bindings.js';

export const beginInputSchema = assessmentReportSchema
  .pick({
    reviewedIds: true,
    coverage: true,
    start: true,
    deliver: true,
  })
  .extend({ reviewId: z.uuid() })
  .strict();
type Inventory = {
  target: { id: string; kind: 'change' };
  revision: number;
  scopeStreamId: string | null;
  scopeFingerprint: string;
  planFingerprint: string;
  total: number;
  canComplete: boolean;
  items: { id: string; kind: string; title: string; detail: string }[];
  nextOffset: number | null;
};
function connection(
  bindingPath: string,
  sessionId: string,
  requireChange = true,
  timeoutMs = 10000,
) {
  const binding = bindingSchema.parse(JSON.parse(readFileSync(bindingPath, 'utf8')));
  if (binding.version !== WORKFLOW_VERSION) throw new Error('Update the installed workflow first.');
  const outbox = new SyncOutbox(binding.credentialFile, binding.project, binding.client);
  const state = readSession(outbox, sessionId);
  const selected = requireChange
    ? resolveWorkSelection(binding, outbox, state).selected
    : (state.selected ?? binding);
  if (requireChange && !selected.changeId)
    throw new Error('Explicitly select a change before reviewing or beginning work.');
  return {
    binding,
    outbox,
    selected,
    request: apiClient(readCredential(binding.credentialFile), { timeoutMs }),
  };
}

// The helper fetches and stores records; the agent must actually read them and
// supply reviewed IDs and judgments. Fetching is never an assessment of readiness.
export async function reviewWork(bindingPath: string, sessionId: string, scopeStreamId?: string) {
  const { binding, outbox, selected, request } = connection(bindingPath, sessionId);
  const target = { id: selected.changeId!, kind: 'change' as const };
  const first = await request<Inventory>('/api/dependencies/review', {
    target,
    scopeStreamId,
    limit: 100,
  });
  if (!first.canComplete)
    throw new Error('Review scope is too large; choose a smaller explicit scope.');
  const items = [...first.items];
  let next = first.nextOffset;
  while (next !== null) {
    const page = await request<Inventory>('/api/dependencies/review', {
      target,
      scopeStreamId,
      limit: 100,
      offset: next,
    });
    if (
      page.scopeFingerprint !== first.scopeFingerprint ||
      page.planFingerprint !== first.planFingerprint
    )
      throw new Error('Work changed during review; retry against the current scope.');
    items.push(...page.items);
    next = page.nextOffset;
  }
  if (items.length !== first.total)
    throw new Error('Incomplete review inventory; no receipt saved.');
  const records = [];
  let detailBytes = 0;
  for (const item of items) {
    // These are server-owned paths from the fixed loopback connection, not URLs in work notes.
    const path =
      item.kind === 'change'
        ? `/api/work/${item.id}`
        : item.kind === 'stream'
          ? `/api/streams/${item.id}`
          : item.kind === 'human_action'
            ? `/api/human-actions/${item.id}`
            : `/api/context/${item.id}`;
    const record = { id: item.id, kind: item.kind, record: await request(path) };
    detailBytes += Buffer.byteLength(JSON.stringify(record));
    if (detailBytes > 1_800_000)
      throw new Error('Review details exceed the local bundle limit; narrow the scope.');
    records.push(record);
  }
  const fresh = await request<Inventory>('/api/dependencies/review', {
    target,
    scopeStreamId,
    limit: 1,
  });
  if (
    fresh.scopeFingerprint !== first.scopeFingerprint ||
    fresh.planFingerprint !== first.planFingerprint
  )
    throw new Error('Work changed while loading details; no review receipt saved.');
  const reviewId = randomUUID();
  const directory = privateDirectory(join(outbox.directory, 'reviews'));
  const reviewFile = join(directory, reviewId + '.json');
  const receipt = {
    reviewId,
    sessionId,
    project: binding.project,
    selected,
    inventory: { ...first, items },
    records,
  };
  if (Buffer.byteLength(JSON.stringify(receipt)) > 2_000_000)
    throw new Error('Review details exceed the local bundle limit; narrow the scope.');
  privateWrite(reviewFile, receipt);
  return {
    reviewId,
    reviewFile,
    total: items.length,
    items: items.map(({ id, kind, title }) => ({ id, kind, title })),
    nextStep:
      'Read the full records in reviewFile. Then supply reviewedIds, coverage and explicit start/delivery judgments to begin. No assessment or claim has been created.',
  };
}

export async function beginWork(bindingPath: string, sessionId: string, input: unknown) {
  const { outbox } = connection(bindingPath, sessionId);
  // Serialize only convenience operations, not lifecycle hooks/checkpoints.
  return withSession(outbox, 'operation-' + hash(sessionId), async () => {
    try {
      return await beginWorkOnce(bindingPath, sessionId, input);
    } catch (error) {
      // A definite rejected request is safe to repair. Ambiguous network/server
      // failures retain the exact private identity for an idempotent replay.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500)
        await withSession(outbox, sessionId, (state) => {
          if (state.begin && !state.begin.claimId) delete state.begin;
        });
      throw error;
    }
  });
}
async function beginWorkOnce(bindingPath: string, sessionId: string, input: unknown) {
  const p = beginInputSchema.parse(input);
  const { binding, outbox, selected, request } = connection(bindingPath, sessionId);
  const review = JSON.parse(
    readFileSync(join(outbox.directory, 'reviews', p.reviewId + '.json'), 'utf8'),
  ) as {
    reviewId: string;
    sessionId: string;
    project: string;
    selected: typeof selected;
    inventory: Inventory;
  };
  const sameSelection = () => {
    const current = resolveWorkSelection(binding, outbox, readSession(outbox, sessionId)).selected;
    return current.changeId === selected.changeId && current.streamId === selected.streamId;
  };
  if (
    review.sessionId !== sessionId ||
    review.project !== binding.project ||
    review.selected.changeId !== selected.changeId ||
    review.selected.streamId !== selected.streamId
  )
    throw new Error(
      'Review belongs to another session or selection; review the selected work again.',
    );
  const inputHash = hash(JSON.stringify(p));
  const intent = await withSession(outbox, sessionId, (state) => {
    if (!sameSelection()) throw new Error('Selection changed; review the selected work again.');
    if (state.begin && (state.begin.reviewId !== p.reviewId || state.begin.inputHash !== inputHash))
      throw new Error(
        'A begin attempt already exists. Release its claim before changing the assessment.',
      );
    state.begin ??= {
      reviewId: p.reviewId,
      inputHash,
      reportId: randomUUID(),
      sessionId: randomUUID(),
      token: randomBytes(32).toString('base64url'),
      changeId: selected.changeId!,
    };
    return { ...state.begin };
  });
  const i = review.inventory;
  await request('/api/dependencies/assess', {
    target: i.target,
    revision: i.revision,
    scopeStreamId: i.scopeStreamId,
    scopeFingerprint: i.scopeFingerprint,
    planFingerprint: i.planFingerprint,
    reviewedIds: p.reviewedIds,
    coverage: p.coverage,
    start: p.start,
    deliver: p.deliver,
    idempotencyKey: intent.reportId,
  });
  if (!sameSelection()) throw new Error('Selection changed after assessment; no claim requested.');
  const work = await request<{ tracking: { revision: number } }>(`/api/work/${selected.changeId}`);
  const result = await request<{ claim: Claim }>(`/api/work/${selected.changeId}/claims`, {
    revision: work.tracking.revision,
    sessionId: intent.sessionId,
    token: intent.token,
    purpose: 'implementation',
    leaseSeconds: 1800,
  });
  if (!sameSelection()) {
    await request(`/api/claims/${result.claim.id}`, {
      sessionId: intent.sessionId,
      token: intent.token,
      release: true,
    });
    await withSession(outbox, sessionId, (state) => {
      if (state.begin?.reportId === intent.reportId) delete state.begin;
    });
    throw new Error('Selection changed during claiming; the old selection claim was released.');
  }
  await withSession(outbox, sessionId, (state) => {
    if (state.begin?.reportId === intent.reportId) {
      state.begin.claimId = result.claim.id;
      state.begin.expiresAt = result.claim.expiresAt;
      state.pendingIntent = 'working';
    }
  });
  // The cooperative credential remains exclusively in private helper storage.
  return { claim: result.claim, authority: 'Coordination only; client permissions still apply.' };
}

export async function updateWorkLease(bindingPath: string, sessionId: string, release: boolean) {
  const { outbox } = connection(bindingPath, sessionId, false);
  return withSession(outbox, 'operation-' + hash(sessionId), async () =>
    updateLeaseOnce(bindingPath, sessionId, release),
  );
}
async function updateLeaseOnce(bindingPath: string, sessionId: string, release: boolean) {
  const { outbox, request } = connection(bindingPath, sessionId, false);
  const intent = readSession(outbox, sessionId).begin;
  if (!intent)
    throw new Error('No acknowledged helper claim; replay begin after an uncertain response.');
  const current = await request<{ tracking: { claim: Claim | null } }>(
    `/api/work/${intent.changeId}`,
  );
  if (
    release &&
    (intent.claimId || current.tracking.claim?.sessionId === intent.sessionId) &&
    (current.tracking.claim?.state !== 'active' ||
      (intent.claimId && current.tracking.claim?.id !== intent.claimId))
  ) {
    await withSession(outbox, sessionId, (state) => {
      if (state.begin?.reportId === intent.reportId) delete state.begin;
    });
    return { claim: current.tracking.claim, alreadyInactive: true };
  }
  if (!intent.claimId) {
    if (current.tracking.claim?.sessionId !== intent.sessionId)
      throw new Error('No acknowledged helper claim; replay begin after an uncertain response.');
    intent.claimId = current.tracking.claim.id;
  }
  const result = await request<{ claim: Claim }>(`/api/claims/${intent.claimId}`, {
    sessionId: intent.sessionId,
    token: intent.token,
    ...(release ? { release: true } : { leaseSeconds: 1800 }),
  });
  await withSession(outbox, sessionId, (state) => {
    if (state.begin?.reportId !== intent.reportId) return;
    if (release) delete state.begin;
    else state.begin!.expiresAt = result.claim.expiresAt;
  });
  return result;
}
export async function outputEvidence(bindingPath: string, sessionId: string, outputId?: string) {
  const { selected, request } = connection(bindingPath, sessionId, true, 30000);
  const evidence = await request<import('../shared/output-evidence.js').OutputEvidence>(
    `/api/work/${selected.changeId}/output-evidence`,
  );
  if (!outputId) return evidence;
  const output = evidence.outputs.find((item) => item.id === outputId);
  if (!output) throw new Error('Output is not in the selected change’s current output page.');
  return request(`/api/work/${selected.changeId}/outputs/${output.id}/observe`, {
    revision: output.revision,
  });
}

// Only acknowledged helper-owned claims are maintained, on actual participation.
export async function maintainWorkLease(bindingPath: string, sessionId: string) {
  const { outbox, selected, request } = connection(bindingPath, sessionId, true, 600);
  const state = readSession(outbox, sessionId),
    owned = state.begin;
  if (
    !owned?.claimId ||
    owned.changeId !== selected.changeId ||
    (state.intent === 'reading' && state.pendingIntent !== 'working')
  )
    return undefined;
  if (owned.expiresAt && owned.expiresAt - Date.now() > 300_000) return undefined;
  if ((state.maintenanceAfter ?? 0) > Date.now()) return undefined;
  return withSession(outbox, 'operation-' + hash(sessionId), async () => {
    const latest = readSession(outbox, sessionId);
    if (
      latest.begin?.claimId !== owned.claimId ||
      resolveWorkSelection(
        bindingSchema.parse(JSON.parse(readFileSync(bindingPath, 'utf8'))),
        outbox,
        latest,
      ).selected.changeId !== owned.changeId
    )
      return undefined;
    try {
      const work = await request<{ tracking: { claim: Claim | null } }>(
        `/api/work/${owned.changeId}`,
      );
      const claim = work.tracking.claim;
      if (
        !claim ||
        claim.id !== owned.claimId ||
        claim.sessionId !== owned.sessionId ||
        claim.state !== 'active' ||
        claim.expiresAt <= Date.now()
      )
        return 'inactive';
      if (claim.expiresAt - Date.now() > 300_000) {
        await withSession(outbox, sessionId, (s) => {
          if (s.begin?.claimId === claim.id) s.begin.expiresAt = claim.expiresAt;
        });
        return undefined;
      }
      if (
        resolveWorkSelection(
          bindingSchema.parse(JSON.parse(readFileSync(bindingPath, 'utf8'))),
          outbox,
          readSession(outbox, sessionId),
        ).selected.changeId !== owned.changeId
      )
        return undefined;
      const result = await request<{ claim: Claim }>(`/api/claims/${claim.id}`, {
        sessionId: owned.sessionId,
        token: owned.token,
        leaseSeconds: 1800,
      });
      await withSession(outbox, sessionId, (s) => {
        if (s.begin?.claimId === claim.id) s.begin.expiresAt = result.claim.expiresAt;
      });
      return 'renewed';
    } catch {
      await withSession(outbox, sessionId, (s) => {
        s.maintenanceAfter = Date.now() + 60_000;
      });
      return 'not renewed; review readiness or connection before continuing implementation';
    }
  });
}
