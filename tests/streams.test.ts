import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { Auth } from '../src/services/auth.js';
import { WorkService } from '../src/services/work.js';
import { OversightService } from '../src/services/oversight.js';
import { StreamService } from '../src/services/streams.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
let store: ReturnType<typeof openStore>,
  work: WorkService,
  streams: StreamService,
  auth: Auth,
  agent: Actor,
  other: Actor,
  now: number;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
beforeEach(() => {
  now = 1000000;
  store = openStore(':memory:');
  work = new WorkService(store, () => now);
  streams = new StreamService(work);
  auth = new Auth(store, () => now);
  agent = auth.actor(auth.register('agent', 'Planner').secret, 'bearer');
  other = auth.actor(auth.register('agent', 'Reviewer').secret, 'bearer');
});
afterEach(() => store.close());
const submit = () =>
  streams.submit(agent, {
    title: 'Local workflow',
    outcome: 'Make handoffs usable.',
    idempotencyKey: 'stream',
  });
const change = (streamId?: string) =>
  work.create(
    agent,
    createSchema.parse({
      title: 'A bounded output',
      objective: 'Deliver an independently reviewable result.',
      streamId,
      idempotencyKey: randomUUID(),
    }),
  );
const accept = (id: string) =>
  work.action(owner, id, { action: 'accept', revision: work.get(owner, id).revision, message: '' });
const claim = (
  a: Actor,
  id: string,
  p: Omit<Parameters<StreamService['claim']>[2], 'token'> & { token?: string },
) => streams.claim(a, id, { token: randomBytes(32).toString('base64url'), ...p });
const assess = (id: string) => {
  const m = work.get(agent, id).tracking;
  return streams.updateChange(agent, id, {
    revision: m.revision,
    assessmentFingerprint: m.assessmentFingerprint,
    assessDependencies: true,
  });
};
const active = () => {
  const s = submit();
  return streams.action(owner, s.id, { action: 'accept', revision: s.revision });
};
it('tracks streams and changes without intake; retries and legacy scope proposals do not elevate agents', () => {
  const s = submit();
  expect(submit().id).toBe(s.id);
  expect(work.status(owner).inboxCount).toBe(0);
  expect(() => streams.action(agent, s.id, { action: 'accept', revision: 1 })).toThrow(
    'credential',
  );
  const w = change(s.id);
  expect(w.assignment?.state).toBe('tracked');
  expect(work.status(owner).inboxCount).toBe(0);
  const accepted = streams.action(owner, s.id, { action: 'accept', revision: 1 });
  expect(work.get(owner, w.id).assignment?.state).toBe('tracked');
  const updated = streams.update(agent, s.id, {
    revision: accepted.revision,
    context: 'Current handoff',
    proposedScope: { title: 'Wider scope', outcome: 'Add hosted support' },
  });
  expect(updated.title).toBe(s.title);
  expect(updated.pendingScope?.title).toBe('Wider scope');
  expect(work.status(owner).inboxCount).toBe(0);
  expect(() =>
    streams.update(other, s.id, { revision: accepted.revision, context: 'Overwrite' }),
  ).toThrow('Current revision');
  const approved = streams.action(owner, s.id, {
    action: 'accept_scope',
    revision: updated.revision,
  });
  expect(approved.scopeRevision).toBe(2);
});
it('records unknown vs assessed independence, stage-aware dependencies and stale output/scope evidence', () => {
  const s = active(),
    a = change(s.id),
    b = change(s.id);
  expect(a.tracking.assessmentState).toBe('unknown');
  let updated = streams.updateChange(agent, a.id, {
    revision: 1,
    dependencies: [],
    assessmentFingerprint: a.tracking.assessmentFingerprint,
    assessDependencies: true,
  });
  expect(updated.tracking.assessmentState).toBe('current');
  work.note(agent, a.id, 'Routine note', []);
  expect(work.get(agent, a.id).tracking.assessmentState).toBe('current');
  streams.updateChange(agent, b.id, {
    revision: 1,
    dependencies: [
      {
        requiresId: a.id,
        stage: 'start',
        condition: 'output_available',
        reason: 'Build on the published contract.',
      },
    ],
  });
  assess(b.id);
  expect(work.get(agent, b.id).tracking.dependencies[0].satisfied).toBe(false);
  // A can integrate after B produces an output: legal even though B starts after A produces one.
  updated = streams.updateChange(agent, a.id, {
    revision: updated.tracking.revision,
    dependencies: [
      {
        requiresId: b.id,
        stage: 'integrate',
        condition: 'output_available',
        reason: 'Validate consumer before merging.',
      },
    ],
  });
  updated = assess(a.id);
  expect(() =>
    streams.updateChange(agent, a.id, {
      revision: updated.tracking.revision,
      dependencies: [
        {
          requiresId: b.id,
          stage: 'start',
          condition: 'integrated',
          reason: 'Impossible ordering.',
        },
      ],
    }),
  ).toThrow('cycle');
  expect(work.get(agent, a.id).tracking.dependencies[0].stage).toBe('integrate');
  const output = {
    kind: 'mr' as const,
    url: 'https://example.com/mr/1',
    label: 'Contract',
    codeRevision: 'abc',
    state: 'available' as const,
    idempotencyKey: 'mr',
  };
  const o = streams.recordOutput(agent, a.id, output);
  expect(streams.recordOutput(agent, a.id, output).id).toBe(o.id);
  expect(work.get(agent, b.id).tracking.assessmentState).toBe('stale');
  expect(work.get(agent, b.id).tracking.dependencies[0]).toMatchObject({
    satisfied: true,
    evidence: 'reported',
  });
  expect(work.get(agent, a.id).lifecycle).toBe('open');
  let bmeta = work.get(agent, b.id).tracking;
  streams.updateChange(agent, b.id, {
    revision: bmeta.revision,
    assessmentFingerprint: bmeta.assessmentFingerprint,
    assessDependencies: true,
  });
  const current = streams.get(agent, s.id);
  const pending = streams.update(agent, s.id, {
    revision: current.revision,
    proposedScope: { title: s.title, outcome: 'New goal' },
  });
  streams.action(owner, s.id, { revision: pending.revision, action: 'accept_scope' });
  expect(work.get(agent, b.id).tracking.assessmentState).toBe('stale');
});
it('allows cross-stream prerequisites and rejects invalid and duplicate relationships transactionally', () => {
  const a = change(active().id),
    b = change();
  expect(() =>
    streams.updateChange(agent, a.id, {
      revision: 1,
      dependencies: [{ requiresId: a.id, stage: 'start', condition: 'integrated', reason: 'self' }],
    }),
  ).toThrow('itself');
  expect(() =>
    streams.updateChange(agent, a.id, {
      revision: 1,
      dependencies: [
        { requiresId: randomUUID(), stage: 'start', condition: 'integrated', reason: 'missing' },
      ],
    }),
  ).toThrow('not found');
  const d = {
    requiresId: b.id,
    stage: 'integrate' as const,
    condition: 'integrated' as const,
    reason: 'Different stream is permitted.',
  };
  expect(() => streams.updateChange(agent, a.id, { revision: 1, dependencies: [d, d] })).toThrow(
    'Duplicate',
  );
  expect(
    streams.updateChange(agent, a.id, { revision: 1, dependencies: [d] }).tracking.dependencies,
  ).toHaveLength(1);
});
it('atomically reserves accepted changes and exclusive resources; expiry/revocation never executes or completes work', () => {
  const s = active(),
    a = change(s.id),
    b = change(s.id),
    sessionId = randomUUID();
  const initial = claim(agent, a.id, { revision: 1, sessionId });
  expect(initial.claim?.state).toBe('active');
  streams.renew(agent, initial.claim!.id, { sessionId, token: initial.token, release: true });
  accept(a.id);
  accept(b.id);
  streams.updateChange(agent, a.id, { revision: 1, resources: ['schema'] });
  streams.updateChange(agent, b.id, { revision: 1, resources: ['schema'] });
  const first = claim(agent, a.id, { revision: 2, sessionId, leaseSeconds: 60 });
  expect(first.claim?.state).toBe('active');
  expect(() => claim(other, a.id, { revision: 2, sessionId: randomUUID() })).toThrow(
    'active claim',
  );
  expect(() => claim(other, b.id, { revision: 2, sessionId: randomUUID() })).toThrow('resource');
  expect(() => streams.renew(other, first.claim!.id, { sessionId, token: first.token })).toThrow(
    'ownership',
  );
  expect(() => streams.updateChange(agent, a.id, { revision: 2, resources: [] })).toThrow(
    'Release',
  );
  expect(JSON.stringify(work.get(other, a.id))).not.toContain(first.token);
  expect(JSON.stringify(work.get(other, a.id))).not.toContain('tokenHash');
  now += 61000;
  expect(work.get(other, a.id).tracking.claim?.state).toBe('expired');
  const second = claim(other, b.id, { revision: 2, sessionId: randomUUID() });
  auth.revoke(other.credentialId!);
  expect(work.get(agent, b.id).tracking.claim?.state).toBe('revoked');
  expect(work.get(agent, a.id).runs).toEqual([]);
  expect(work.get(agent, a.id).lifecycle).toBe('open');
  expect(() => streams.renew(agent, first.claim!.id, { sessionId, token: first.token })).toThrow(
    'no longer active',
  );
  expect(second.token).not.toBe(first.token);
});
it('preserves authorship and human questions; supplies bounded fresh-session context and explicit choices', () => {
  const s = active(),
    w = change(s.id);
  const human = streams.recordContext(owner, s.id, {
    kind: 'question',
    body: 'Which remote?',
    idempotencyKey: 'human',
  });
  expect(() => streams.resolveContext(agent, human.id, { revision: 1, state: 'resolved' })).toThrow(
    'author',
  );
  const decision = streams.recordContext(agent, s.id, {
    kind: 'decision',
    body: 'Use explicit stages.',
    idempotencyKey: 'decision',
  });
  expect(
    streams.recordContext(agent, s.id, {
      kind: 'decision',
      body: 'Use explicit stages.',
      idempotencyKey: 'decision',
    }).id,
  ).toBe(decision.id);
  expect(() =>
    streams.recordContext(agent, s.id, {
      kind: 'decision',
      body: 'Different',
      idempotencyKey: 'decision',
    }),
  ).toThrow('different content');
  for (let i = 0; i < 30; i++)
    streams.recordContext(agent, s.id, {
      kind: 'finding',
      body: 'x'.repeat(4000),
      idempotencyKey: `finding${i}`,
    });
  expect(streams.context(other, {})).toMatchObject({ selectionRequired: true });
  const context = streams.context(other, { streamId: s.id, project: '/repo' });
  expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(48000);
  expect(context).toMatchObject({ stream: { outcome: s.outcome }, selectionRequired: false });
  const selection = streams.context(other, { changeId: w.id });
  expect(selection).toMatchObject({ stream: { id: s.id } });
  expect(
    store.raw
      .prepare('SELECT streamId FROM workflow_reads WHERE credentialId=?')
      .get(other.credentialId),
  ).toEqual({ streamId: s.id });
  expect(streams.contextEntries(other, s.id, 30).total).toBe(32);
});

it('keeps human questions in Inbox without flooding it with routine findings', () => {
  const s = active();
  expect(work.status(owner).inboxCount).toBe(0);
  streams.recordContext(agent, s.id, {
    kind: 'finding',
    body: 'A routine finding',
    idempotencyKey: 'finding',
  });
  expect(work.status(owner).inboxCount).toBe(0);
  const q = streams.recordContext(agent, s.id, {
    kind: 'question',
    body: 'Choose the repository.',
    needsHuman: true,
    idempotencyKey: 'question',
  });
  expect(q.needsHuman).toBe(true);
  expect(streams.list(owner, { view: 'inbox' }).items.map((x) => x.id)).toEqual([s.id]);
  expect(work.status(owner).inboxCount).toBe(1);
  new OversightService(streams).answer(owner, q.id, {
    revision: 1,
    answer: 'Use this repository.',
    idempotencyKey: 'answer',
  });
  expect(work.status(owner).inboxCount).toBe(0);
});
it('rejects stale output reports and paginates context collections independently without dropping entries', () => {
  const s = active(),
    a = change(s.id);
  const report = {
    kind: 'mr' as const,
    url: 'https://example.com/mr/1',
    label: 'Output',
    state: 'available' as const,
    idempotencyKey: 'available',
  };
  const output = streams.recordOutput(agent, a.id, report);
  expect(() =>
    streams.recordOutput(agent, a.id, { ...report, state: 'integrated', idempotencyKey: 'stale' }),
  ).toThrow('Current revision');
  expect(
    streams.recordOutput(agent, a.id, {
      ...report,
      revision: output.revision,
      state: 'integrated',
      idempotencyKey: 'integrated',
    }).revision,
  ).toBe(2);
  for (let i = 0; i < 20; i++) {
    change(s.id);
    streams.recordContext(agent, s.id, {
      kind: 'finding',
      body: `Finding ${i}: ` + 'x'.repeat(3900),
      idempotencyKey: `finding${i}`,
    });
  }
  let entryOffset = 0,
    changeOffset = 0;
  const entries = new Set<string>(),
    changes = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const context = streams.context(agent, { streamId: s.id, entryOffset, changeOffset });
    if (context.selectionRequired) throw new Error('Selection lost');
    const e = context.entries!,
      w = context.changes!;
    e.items.forEach((x) => entries.add(x.id));
    w.items.forEach((x) => changes.add(x.id));
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(48000);
    if (e.nextOffset === null && w.nextOffset === null) break;
    entryOffset = e.nextOffset ?? e.total;
    changeOffset = w.nextOffset ?? w.total;
  }
  expect(entries.size).toBe(20);
  expect(changes.size).toBe(21);
});

it('caps Unicode-heavy context and leaves full entry/output/history retrieval available', () => {
  const huge = '界'.repeat(3000),
    s = streams.submit(agent, {
      title: 'Large stream',
      outcome: huge,
      constraints: huge,
      context: '界'.repeat(6000),
      idempotencyKey: 'large',
    }),
    w = change(s.id);
  streams.updateChange(agent, w.id, {
    revision: 1,
    areas: Array.from({ length: 30 }, () => '界'.repeat(200)),
    resources: Array.from({ length: 20 }, () => '界'.repeat(200)),
    progressNote: huge,
    expectedOutput: huge,
    baseRef: '界'.repeat(500),
  });
  const entry = streams.recordContext(agent, s.id, {
    kind: 'finding',
    body: '界'.repeat(4000),
    idempotencyKey: 'huge',
  });
  const context = streams.context(agent, { changeId: w.id, limit: 30 });
  expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(48000);
  expect(streams.entry(agent, entry.id).body).toHaveLength(4000);
  expect(work.history(agent, w.id, 1).nextOffset).toBe(1);
  expect(streams.outputs(agent, w.id).items).toEqual([]);
});

it('does not resurrect old ownership when a paused or closed stream resumes', () => {
  const s = active(),
    w = change(s.id),
    sessionId = randomUUID();
  accept(w.id);
  const lease = claim(agent, w.id, { revision: 1, sessionId });
  const paused = streams.action(owner, s.id, { revision: s.revision, action: 'pause' });
  expect(work.get(agent, w.id).tracking.claim?.state).toBe('revoked');
  streams.updateChange(agent, w.id, { revision: 1, resources: ['new-resource'] });
  streams.action(owner, s.id, { revision: paused.revision, action: 'resume' });
  expect(work.get(agent, w.id).tracking.claim?.state).toBe('revoked');
  expect(() => streams.renew(agent, lease.claim!.id, { sessionId, token: lease.token })).toThrow(
    'no longer active',
  );
  expect(claim(other, w.id, { revision: 2, sessionId: randomUUID() }).claim?.actorId).toBe(
    other.id,
  );
});

it('rejects an assessment of an upstream version the caller did not read', () => {
  const s = active(),
    up = change(s.id),
    down = change(s.id);
  streams.updateChange(agent, down.id, {
    revision: 1,
    dependencies: [
      {
        requiresId: up.id,
        stage: 'start',
        condition: 'output_available',
        reason: 'Build against this contract.',
      },
    ],
  });
  assess(down.id);
  const read = work.get(agent, down.id).tracking;
  streams.updateChange(other, up.id, { revision: 1, baseRef: 'incompatible-new-contract' });
  expect(work.get(agent, down.id).tracking.assessmentState).toBe('stale');
  expect(() =>
    streams.updateChange(agent, down.id, {
      revision: read.revision,
      assessmentFingerprint: read.assessmentFingerprint,
      assessDependencies: true,
    }),
  ).toThrow('Assessment context changed');
  expect(work.get(agent, down.id).tracking.revision).toBe(read.revision);
  expect(() =>
    streams.updateChange(agent, down.id, { revision: read.revision, assessDependencies: true }),
  ).toThrow('fingerprint');
  const refreshed = assess(down.id);
  expect(refreshed.tracking.assessmentState).toBe('current');
  expect(refreshed.tracking.assessmentFingerprint).not.toBe(read.assessmentFingerprint);
  work.note(other, up.id, 'Routine note does not change the contract.', []);
  expect(work.get(agent, down.id).tracking.assessmentState).toBe('current');
  const before = work.get(agent, down.id).tracking;
  expect(() =>
    streams.updateChange(agent, down.id, {
      revision: before.revision,
      assessmentFingerprint: before.assessmentFingerprint,
      dependencies: [],
      assessDependencies: true,
    }),
  ).toThrow('Save plan changes first');
  expect(work.get(agent, down.id).tracking.dependencies).toHaveLength(1);
});

it('treats a reordered dependency set as unchanged during an active claim', () => {
  const s = active(),
    down = change(s.id);
  const make = (title: string) =>
    work.create(agent, createSchema.parse({ title, objective: 'Publish a contract.' }));
  const z = make('Z prerequisite'),
    a = make('A prerequisite');
  const dependencies = [z, a].map((w) => ({
    requiresId: w.id,
    stage: 'start' as const,
    condition: 'output_available' as const,
    reason: 'Uses this contract.',
  }));
  streams.updateChange(agent, down.id, { revision: 1, dependencies });
  const assessed = assess(down.id);
  accept(down.id);
  const lease = claim(agent, down.id, {
    revision: assessed.tracking.revision,
    sessionId: randomUUID(),
  });
  for (const reordered of [dependencies, [...dependencies].reverse(), dependencies]) {
    const before = work.get(agent, down.id).tracking;
    const after = streams.updateChange(agent, down.id, {
      revision: before.revision,
      dependencies: reordered,
      progress: 'working',
    }).tracking;
    expect(after.planRevision).toBe(assessed.tracking.planRevision);
    expect(after.assessmentFingerprint).toBe(assessed.tracking.assessmentFingerprint);
    expect(after.assessmentState).toBe('current');
    expect(after.claim?.id).toBe(lease.claim?.id);
  }
  const before = work.get(agent, down.id).tracking;
  expect(() =>
    streams.updateChange(agent, down.id, {
      revision: before.revision,
      dependencies: [{ ...dependencies[0], reason: 'A changed contract.' }, dependencies[1]],
    }),
  ).toThrow('Release');
});

it('replays a lost claim response using the caller-retained secret without extending its lease', () => {
  const w = change();
  accept(w.id);
  const input = {
    revision: 1,
    sessionId: randomUUID(),
    token: randomBytes(32).toString('base64url'),
    leaseSeconds: 60,
  };
  const original = streams.claim(agent, w.id, input);
  now += 10000;
  streams.updateChange(other, w.id, { revision: 1, progress: 'working' });
  const recovered = streams.claim(agent, w.id, input);
  expect(recovered).toEqual(original);
  expect(store.raw.prepare('SELECT count(*) n FROM collaboration_claims').get()).toEqual({ n: 1 });
  expect(() => streams.claim(other, w.id, input)).toThrow('active claim');
  const secondCredential = auth.actor(auth.issue('agent', agent.id).secret, 'bearer');
  expect(() => streams.claim(secondCredential, w.id, input)).toThrow('active claim');
  expect(() => streams.claim(agent, w.id, { ...input, sessionId: randomUUID() })).toThrow(
    'active claim',
  );
  expect(() =>
    streams.claim(agent, w.id, { ...input, token: randomBytes(32).toString('base64url') }),
  ).toThrow('active claim');
  expect(JSON.stringify(work.get(agent, w.id))).not.toContain(input.token);
  expect(
    JSON.stringify(work.list(agent, { view: 'all', status: 'any', q: '', limit: 50, offset: 0 })),
  ).not.toContain(input.token);
  expect(JSON.stringify(streams.context(agent, { changeId: w.id }))).not.toContain(input.token);
  streams.renew(agent, recovered.claim!.id, {
    sessionId: input.sessionId,
    token: input.token,
    release: true,
  });
  expect(() => streams.claim(agent, w.id, input)).toThrow('no longer active');
  expect(work.get(agent, w.id).tracking.claim?.state).toBe('released');
});

it('requires a retained secret and does not silently restart an expired claim attempt', () => {
  const w = change();
  accept(w.id);
  expect(() =>
    streams.claim(agent, w.id, { revision: 1, sessionId: randomUUID() } as Parameters<
      StreamService['claim']
    >[2]),
  ).toThrow();
  const input = {
    revision: 1,
    sessionId: randomUUID(),
    token: randomBytes(32).toString('base64url'),
    leaseSeconds: 60,
  };
  const original = streams.claim(agent, w.id, input);
  now += 61000;
  expect(() => streams.claim(agent, w.id, input)).toThrow('no longer active');
  const next = streams.claim(agent, w.id, {
    ...input,
    token: randomBytes(32).toString('base64url'),
  });
  expect(next.claim?.id).not.toBe(original.claim?.id);
});

it('keeps outstanding human questions ahead of routine findings in both human and agent pages', () => {
  const s = active();
  const question = streams.recordContext(agent, s.id, {
    kind: 'question',
    body: 'Which repository?',
    needsHuman: true,
    idempotencyKey: 'human-question',
  });
  for (let i = 0; i < 31; i++)
    streams.recordContext(agent, s.id, {
      kind: 'finding',
      body: `Routine finding ${i}`,
      idempotencyKey: `routine${i}`,
    });
  expect(streams.contextEntries(owner, s.id).items[0].id).toBe(question.id);
  const context = streams.context(agent, { streamId: s.id });
  if (context.selectionRequired) throw new Error('Selection lost');
  expect(context.entries.items[0].id).toBe(question.id);
  expect(context.entries.nextOffset).toBe(12);
  const next = streams.context(agent, { streamId: s.id, entryOffset: context.entries.nextOffset! });
  if (next.selectionRequired) throw new Error('Selection lost');
  expect(next.entries.items.some((e) => e.id === question.id)).toBe(false);
  new OversightService(streams).answer(owner, question.id, {
    revision: 1,
    answer: 'Proceed within scope.',
    idempotencyKey: 'answer',
  });
  expect(streams.list(owner, { view: 'inbox' }).total).toBe(0);
  expect(streams.contextEntries(owner, s.id).items[0].kind).toBe('finding');
});

it('enforces the serialized byte limit for escaped text and preserves full records and pagination', () => {
  const escaped = '\u0000'.repeat(3000);
  const s = streams.submit(agent, {
    title: 'Escaped context',
    outcome: escaped,
    constraints: escaped,
    context: escaped,
    idempotencyKey: 'escaped',
  });
  const w = work.create(
    agent,
    createSchema.parse({ title: 'Escaped output', objective: escaped, streamId: s.id }),
  );
  streams.updateChange(agent, w.id, {
    revision: 1,
    expectedOutput: escaped,
    progressNote: escaped,
    baseRef: '\u0000'.repeat(500),
    areas: Array.from({ length: 5 }, () => '\u0000'.repeat(200)),
    resources: Array.from({ length: 5 }, () => '\u0000'.repeat(200)),
  });
  store.raw.prepare('UPDATE actors SET name=? WHERE id=?').run('\u0000'.repeat(8000), agent.id);
  for (let i = 0; i < 35; i++)
    streams.recordContext(agent, s.id, {
      kind: 'question',
      body: escaped,
      needsHuman: true,
      idempotencyKey: `escaped${i}`,
    });
  let entryOffset = 0;
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const context = streams.context(agent, { changeId: w.id, entryOffset, limit: 30 });
    if (context.selectionRequired) throw new Error('Selection lost');
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(48000);
    expect(context.changes.items[0].id).toBe(w.id);
    context.entries.items.forEach((e) => seen.add(e.id));
    if (context.entries.nextOffset === null) break;
    expect(context.entries.nextOffset).toBeGreaterThan(entryOffset);
    entryOffset = context.entries.nextOffset;
  }
  expect(seen.size).toBe(35);
  expect(streams.get(agent, s.id).outcome).toBe(escaped);
  expect(work.get(agent, w.id).tracking.expectedOutput).toBe(escaped);
});

it('reduces a single oversized output summary and bounds discovery responses too', () => {
  const escaped = '\u0000'.repeat(3000);
  store.raw.prepare('UPDATE actors SET name=? WHERE id=?').run('\u0000'.repeat(8000), agent.id);
  const s = streams.submit(agent, {
      title: '\u0000'.repeat(180),
      outcome: escaped,
      constraints: escaped,
      context: escaped,
      idempotencyKey: 'urls',
    }),
    w = work.create(
      agent,
      createSchema.parse({ title: '\u0000'.repeat(180), objective: escaped, streamId: s.id }),
    );
  streams.action(owner, s.id, { revision: 1, action: 'accept' });
  accept(w.id);
  for (let i = 0; i < 2; i++)
    streams.recordOutput(agent, w.id, {
      kind: 'other',
      url: `https://example.com/${i}/` + '\u0000'.repeat(1950),
      label: '\u0000'.repeat(180),
      codeRevision: '\u0000'.repeat(500),
      state: 'available',
      idempotencyKey: `url${i}`,
    });
  const pending = streams.update(agent, s.id, {
    revision: 2,
    proposedScope: { title: '\u0000'.repeat(180), outcome: escaped, constraints: escaped },
  });
  expect(pending.pendingScope).not.toBeNull();
  const dependencies = Array.from({ length: 4 }, () => {
    const up = work.create(
      agent,
      createSchema.parse({ title: '\u0000'.repeat(180), objective: escaped }),
    );
    return {
      requiresId: up.id,
      stage: 'start' as const,
      condition: 'output_available' as const,
      reason: '\u0000'.repeat(1000),
    };
  });
  streams.updateChange(agent, w.id, {
    revision: 1,
    dependencies,
    expectedOutput: escaped,
    progressNote: escaped,
    baseRef: '\u0000'.repeat(500),
    areas: Array.from({ length: 5 }, () => '\u0000'.repeat(200)),
    resources: Array.from({ length: 5 }, () => '\u0000'.repeat(200)),
  });
  claim(agent, w.id, { revision: 2, sessionId: randomUUID() });
  const context = streams.context(agent, { changeId: w.id });
  if (context.selectionRequired) throw new Error('Selection lost');
  expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(48000);
  expect(context.changes.items[0].outputCount).toBe(2);
  expect(context.changes.items[0].tracking.outputs.length).toBeLessThan(2);
  expect(streams.outputs(agent, w.id).items).toHaveLength(2);
  for (let i = 0; i < 30; i++)
    streams.submit(agent, {
      title: '\u0000'.repeat(180),
      outcome: escaped,
      idempotencyKey: `discovery${i}`,
    });
  const discovery = streams.context(agent, { limit: 30 });
  expect(Buffer.byteLength(JSON.stringify(discovery))).toBeLessThanOrEqual(48000);
});

it('reads scope and assessment evidence from one SQLite snapshot during concurrent edits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'work-inbox-assessment-snapshot-'));
  const first = openStore(join(dir, 'work.sqlite')),
    second = openStore(join(dir, 'work.sqlite'));
  const reader = new WorkService(first),
    writer = new WorkService(second),
    service = new StreamService(reader),
    diskAuth = new Auth(first);
  try {
    const source = diskAuth.actor(diskAuth.register('agent', 'Snapshot fixture').secret, 'bearer');
    const w = reader.create(
      source,
      createSchema.parse({ title: 'Original scope', objective: 'Original contract' }),
    );
    const original = reader.get(source, w.id);
    const row = reader.row.bind(reader);
    let changed = false;
    const hook = vi.spyOn(reader, 'row').mockImplementation((actor, id) => {
      const before = row(actor, id);
      if (!changed) {
        changed = true;
        writer.edit(owner, id, before.revision, {
          title: before.title,
          objective: 'Changed by another connection',
          acceptanceCriteria: [],
          priority: 'normal',
          references: [],
        });
      }
      return before;
    });
    const snapshot = reader.get(source, w.id);
    hook.mockRestore();
    expect(snapshot.objective).toBe('Original contract');
    expect(snapshot.tracking.assessmentFingerprint).toBe(original.tracking.assessmentFingerprint);
    const current = reader.get(source, w.id);
    expect(current.objective).toBe('Changed by another connection');
    expect(current.tracking.assessmentFingerprint).not.toBe(
      snapshot.tracking.assessmentFingerprint,
    );
    expect(() =>
      service.updateChange(source, w.id, {
        revision: snapshot.tracking.revision,
        assessmentFingerprint: snapshot.tracking.assessmentFingerprint,
        assessDependencies: true,
      }),
    ).toThrow('Assessment context changed');
  } finally {
    first.close();
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
