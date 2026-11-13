import { beforeEach, afterEach, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { Auth } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { OversightService } from '../src/services/oversight.js';
import {
  DependencyAssessmentService,
  readDependencyAssessment,
  assertImplementationReady,
} from '../src/services/dependency-assessments.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
import {
  assessmentReportSchema,
  type AssessmentTarget,
} from '../src/shared/dependency-assessments.js';
const owner: Actor = { id: 'owner', ownerId: 'owner', scope: 'owner' };
let store: ReturnType<typeof openStore>,
  work: WorkService,
  streams: StreamService,
  flow: OversightService,
  reports: DependencyAssessmentService,
  agent: Actor;
beforeEach(() => {
  store = openStore(':memory:');
  work = new WorkService(store);
  streams = new StreamService(work);
  flow = new OversightService(streams);
  reports = new DependencyAssessmentService(streams);
  const auth = new Auth(store);
  agent = auth.actor(auth.register('agent', 'Assessment fixture').secret, 'bearer');
});
afterEach(() => store.close());
const stream = (title: string, parentId?: string) =>
  streams.submit(agent, { title, outcome: title, parentId, idempotencyKey: randomUUID() });
const change = (streamId: string | null, title = 'A useful change') =>
  work.create(
    agent,
    createSchema.parse({ streamId: streamId ?? undefined, title, objective: title }),
  );
const target = (id: string): AssessmentTarget => ({ id, kind: 'change' });
function input(t: AssessmentTarget, scopeStreamId?: string | null) {
  const r = reports.review(agent, { target: t, scopeStreamId, limit: 100 });
  return {
    target: t,
    revision: r.revision,
    scopeStreamId: r.scopeStreamId,
    scopeFingerprint: r.scopeFingerprint,
    planFingerprint: r.planFingerprint,
    reviewedIds: r.items.map((i) => i.id),
    coverage: 'complete' as const,
    start: {
      result: 'none' as const,
      reason: 'Existing interfaces are sufficient within this reviewed scope.',
    },
    deliver: {
      result: 'none' as const,
      reason: 'This output can be delivered without another change.',
    },
    idempotencyKey: randomUUID(),
  };
}
const claim = (id: string, purpose: 'collaboration' | 'implementation' = 'implementation') => ({
  revision: work.get(agent, id).tracking.revision,
  sessionId: randomUUID(),
  token: randomBytes(32).toString('base64url'),
  purpose,
  leaseSeconds: 120,
});
it('requires explicit staged results and rationale; old fingerprints are not assessed independence', () => {
  const s = stream('Daily use'),
    w = change(s.id),
    t = target(w.id);
  expect(readDependencyAssessment(store, t).state).toBe('unassessed');
  streams.updateChange(agent, w.id, {
    revision: 1,
    assessDependencies: true,
    assessmentFingerprint: w.tracking.assessmentFingerprint,
  });
  expect(readDependencyAssessment(store, t).state).toBe('legacy');
  expect(() => streams.claim(agent, w.id, claim(w.id))).toThrow(/incomplete/);
  expect(assessmentReportSchema.safeParse({ ...input(t), start: { result: 'none' } }).success).toBe(
    false,
  );
  const p = input(t),
    r = reports.report(agent, p);
  expect(r).toMatchObject({
    state: 'current',
    start: { result: 'none' },
    deliver: { result: 'none' },
    actorName: 'Assessment fixture',
  });
  const replay = reports.report(agent, p);
  expect(replay.id).toBe(r.id);
  expect(store.raw.prepare('SELECT count(*) n FROM dependency_assessments').get()).toEqual({
    n: 1,
  });
  expect(flow.map(agent, s.id).nodes.find((n) => n.id === w.id)).toMatchObject({
    status: 'Planned',
    dependencyAssessment: { state: 'current' },
  });
  expect(flow.attention(agent).total).toBe(0);
});
it('distinguishes starting independently from a delivery gate and retains external references', () => {
  const s = stream('Feature'),
    outside = stream('Shared API'),
    w = change(s.id),
    up = change(outside.id, 'Publish API');
  flow.dependencies(agent, {
    target: target(w.id),
    revision: 1,
    dependencies: [
      {
        source: target(up.id),
        stage: 'deliver',
        condition: 'output_available',
        reason: 'Use the final published API',
      },
    ],
  });
  const p = input(target(w.id));
  expect(p.reviewedIds).toContain(up.id);
  expect(() => reports.report(agent, p)).toThrow(/contradicts/);
  const r = reports.report(agent, {
    ...p,
    deliver: { result: 'linked', reason: 'Delivery uses the published API output.' },
  });
  expect(r.state).toBe('current');
  const c = streams.claim(agent, w.id, claim(w.id));
  expect(c.claim?.purpose).toBe('implementation');
  expect(
    store.raw
      .prepare('SELECT assessmentId FROM implementation_claims WHERE claimId=?')
      .get(c.claim!.id),
  ).toEqual({ assessmentId: r.id });
  streams.update(agent, outside.id, {
    revision: outside.revision,
    scope: { title: outside.title, outcome: 'Changed external API contract' },
  });
  expect(readDependencyAssessment(store, target(w.id)).state).toBe('stale');
});
it('rejects missing, duplicate, outside and stale review scope information without changing an earlier report', () => {
  const s = stream('Scoped work'),
    w = change(s.id),
    other = change(s.id, 'Related');
  const t = target(w.id),
    p = input(t);
  expect(() => reports.report(agent, { ...p, reviewedIds: [w.id] })).toThrow(/every item/);
  expect(() => reports.report(agent, { ...p, reviewedIds: [...p.reviewedIds, w.id] })).toThrow(
    /unique/,
  );
  expect(() =>
    reports.report(agent, { ...p, reviewedIds: [...p.reviewedIds, randomUUID()] }),
  ).toThrow(/from this scope/);
  change(s.id, 'New work');
  expect(() => reports.report(agent, p)).toThrow(/scope changed/);
  const fresh = input(t);
  reports.report(agent, fresh);
  work.edit(owner, other.id, other.revision, {
    title: 'Changed shared contract',
    objective: 'Different interface',
    acceptanceCriteria: [],
    priority: 'normal',
    references: [],
  });
  expect(readDependencyAssessment(store, t).state).toBe('stale');
  expect(() =>
    reports.report(agent, {
      ...fresh,
      revision: work.get(agent, w.id).tracking.revision,
      idempotencyKey: randomUUID(),
    }),
  ).toThrow(/scope changed/);
});
it('keeps ordinary progress and unrelated work from invalidating a scoped assessment, and caches consistently across nodes', () => {
  const s = stream('Scoped'),
    a = change(s.id, 'A'),
    b = change(s.id, 'B');
  reports.report(agent, input(target(a.id)));
  reports.report(agent, input(target(b.id)));
  streams.updateChange(agent, b.id, {
    revision: work.get(agent, b.id).tracking.revision,
    progress: 'working',
    progressNote: 'Useful progress',
  });
  const outside = stream('Unrelated');
  change(outside.id);
  expect(readDependencyAssessment(store, target(a.id)).state).toBe('current');
  const map = flow.map(agent, s.id);
  expect(
    map.nodes
      .filter((n) => n.kind === 'change')
      .every((n) => n.dependencyAssessment?.state === 'current'),
  ).toBe(true);
  streams.recordContext(agent, s.id, {
    kind: 'finding',
    body: 'Routine implementation log',
    idempotencyKey: randomUUID(),
  });
  expect(readDependencyAssessment(store, target(a.id)).state).toBe('current');
});
it('retains explicit uncertainty and partial coverage as agent repair work, without creating human chores', () => {
  const s = stream('Uncertain'),
    w = change(s.id);
  change(s.id, 'Other work');
  const p = input(target(w.id));
  const r = reports.report(agent, {
    ...p,
    coverage: 'partial',
    reviewedIds: [w.id],
    start: {
      result: 'uncertain',
      reason: 'The interface boundary is not known yet.',
      nextStep: 'Read the related change and its output.',
    },
  });
  expect(r.state).toBe('uncertain');
  expect(() => assertImplementationReady(store, target(w.id))).toThrow(/uncertain/);
  expect(flow.attention(agent).total).toBe(0);
});
it('preflight checks start gates, ancestor gates, claims and replay purpose while permitting planning', () => {
  const s = stream('Root'),
    child = stream('Branch', s.id),
    w = change(child.id),
    t = target(w.id);
  const h = flow.createAction(agent, {
    streamId: s.id,
    title: 'Get access',
    doneWhen: 'Access is available',
    idempotencyKey: randomUUID(),
  });
  flow.dependencies(agent, {
    target: { id: s.id, kind: 'stream' },
    revision: s.revision,
    dependencies: [
      {
        source: { id: h.id, kind: 'human_action' },
        stage: 'start',
        condition: 'done',
        reason: 'Access needed before starting',
      },
    ],
  });
  reports.report(agent, input(t));
  expect(() => streams.claim(agent, w.id, claim(w.id))).toThrow(/ancestor/);
  const planning = claim(w.id, 'collaboration'),
    c = streams.claim(agent, w.id, planning);
  expect(streams.claim(agent, w.id, planning)).toEqual(c);
  expect(() => streams.claim(agent, w.id, { ...planning, purpose: 'implementation' })).toThrow(
    /purpose differs/,
  );
  streams.renew(agent, c.claim!.id, {
    sessionId: planning.sessionId,
    token: planning.token,
    release: true,
  });
  flow.respond({ id: 'owner', ownerId: 'owner', scope: 'owner' }, h.id, {
    revision: h.revision,
    state: 'done',
    response: 'Access is available',
    idempotencyKey: randomUUID(),
  });
  reports.report(agent, input(t));
  const request = claim(w.id),
    actual = streams.claim(agent, w.id, request);
  expect(streams.claim(agent, w.id, request)).toEqual(actual);
  change(child.id, 'New related work');
  expect(() =>
    streams.renew(agent, actual.claim!.id, { sessionId: request.sessionId, token: request.token }),
  ).toThrow(/incomplete/);
  expect(
    streams.renew(agent, actual.claim!.id, {
      sessionId: request.sessionId,
      token: request.token,
      release: true,
    }).claim?.state,
  ).toBe('released');
});
it('supports stream reports, safe reorganization and ungrouped assessment without inferring wider scope', () => {
  const a = stream('A'),
    b = stream('B'),
    branch = stream('Branch', a.id),
    w = change(branch.id);
  expect(() => reports.review(agent, { target: target(w.id), scopeStreamId: b.id })).toThrow(
    /ancestor/,
  );
  const t: AssessmentTarget = { id: branch.id, kind: 'stream' };
  reports.report(agent, input(t, a.id));
  flow.move(owner, branch.id, {
    streamRevision: streams.get(agent, branch.id).revision,
    parentId: b.id,
    reason: 'Move to the other area',
  });
  expect(readDependencyAssessment(store, t).state).toBe('stale');
  const ungrouped = change(null);
  reports.report(agent, input(target(ungrouped.id)));
  expect(readDependencyAssessment(store, target(ungrouped.id)).state).toBe('current');
});
it('pages bounded review summaries with JSON escapes and supports incomplete large scopes', () => {
  const s = stream('Larger work');
  const w = change(s.id);
  for (let i = 0; i < 35; i++)
    work.create(
      agent,
      createSchema.parse({
        streamId: s.id,
        title: 'Escaped ' + i,
        objective: '\u0000'.repeat(4000),
      }),
    );
  const first = reports.review(agent, { target: target(w.id), limit: 100 });
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(48000);
  expect(first.canComplete).toBe(true);
  const ids = [...first.items.map((i) => i.id)];
  let next = first.nextOffset;
  while (next !== null) {
    const page = reports.review(agent, { target: target(w.id), limit: 100, offset: next });
    expect(page.scopeFingerprint).toBe(first.scopeFingerprint);
    ids.push(...page.items.map((i) => i.id));
    next = page.nextOffset;
  }
  expect(new Set(ids).size).toBe(first.total);
  reports.report(agent, { ...input(target(w.id)), reviewedIds: ids });
  for (let i = 0; i < 970; i++) change(s.id, 'Additional ' + i);
  const large = reports.review(agent, { target: target(w.id), limit: 100 });
  expect(large.canComplete).toBe(false);
  expect(large.items.some((i) => i.id === w.id)).toBe(true);
  expect(() => reports.report(agent, { ...input(target(w.id)), reviewedIds: [w.id] })).toThrow(
    /every item/,
  );
  reports.report(agent, { ...input(target(w.id)), coverage: 'partial', reviewedIds: [w.id] });
  expect(readDependencyAssessment(store, target(w.id)).state).toBe('uncertain');
});
