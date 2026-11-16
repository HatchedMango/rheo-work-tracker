import { it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/db/index.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { OversightService } from '../src/services/oversight.js';
import { Auth } from '../src/services/auth.js';
import { requestGuidanceSchema } from '../src/shared/request-guidance.js';
import type { Actor } from '../src/shared/contracts.js';
let store: ReturnType<typeof openStore>,
  streams: StreamService,
  flow: OversightService,
  agent: Actor;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
beforeEach(() => {
  store = openStore(':memory:');
  streams = new StreamService(new WorkService(store));
  flow = new OversightService(streams);
  const auth = new Auth(store);
  agent = auth.actor(auth.register('agent', 'First').secret, 'bearer');
});
afterEach(() => store.close());
const guidance = {
  steps: ['Open Terminal.', 'Copy and run the command.'],
  copy: { label: 'sign-in command', text: 'example auth login' },
  why: 'This unlocks the trial.',
};
it('round-trips structured action/question guidance through full records and Needs you, without implying a response', () => {
  const s = streams.submit(agent, {
    title: 'Make input useful',
    outcome: 'Clear requests',
    idempotencyKey: randomUUID(),
  });
  const action = flow.createAction(agent, {
    streamId: s.id,
    title: 'Sign in',
    description: 'Long background',
    doneWhen: 'Confirm in chat',
    guidance,
    idempotencyKey: randomUUID(),
  });
  const question = streams.recordContext(agent, s.id, {
    kind: 'question',
    body: 'Which account should we use?',
    needsHuman: true,
    guidance: { recommendation: 'Use the team account.', why: 'Keeps work shared.' },
    idempotencyKey: randomUUID(),
  });
  expect(flow.action(owner, action.id)).toMatchObject({ guidance, state: 'open', response: '' });
  expect(streams.entry(owner, question.id).guidance?.recommendation).toBe('Use the team account.');
  expect(
    streams.contextEntries(owner, s.id).items.find((e) => e.id === question.id)?.guidance?.why,
  ).toBe('Keeps work shared.');
  const items = flow.attention(owner).items;
  expect(items.find((i) => i.entityId === action.id)).toMatchObject({
    guidance,
    doneWhen: 'Confirm in chat',
  });
  expect(items.find((i) => i.entityId === question.id)?.guidance?.recommendation).toBe(
    'Use the team account.',
  );
});
it('revises the same request with author/revision/idempotency checks while preserving real blockers and response state', () => {
  const s = streams.submit(agent, {
    title: 'Requests',
    outcome: 'Clear',
    idempotencyKey: randomUUID(),
  });
  const action = flow.createAction(agent, {
    streamId: s.id,
    title: 'Verbose request',
    description: 'Background',
    doneWhen: 'Report access',
    idempotencyKey: randomUUID(),
  });
  const second = new Auth(store).actor(
    new Auth(store).register('agent', 'Second').secret,
    'bearer',
  );
  expect(() =>
    flow.reviseAction(second, action.id, { revision: 1, guidance, idempotencyKey: randomUUID() }),
  ).toThrow('author or owner');
  const edit = { revision: 1, title: 'Sign in', guidance, idempotencyKey: randomUUID() };
  const revised = flow.reviseAction(agent, action.id, edit);
  expect(revised).toMatchObject({
    id: action.id,
    revision: 2,
    state: 'open',
    response: '',
    description: 'Background',
    doneWhen: 'Report access',
    createdBy: agent.id,
  });
  expect(flow.reviseAction(agent, action.id, edit).revision).toBe(2);
  expect(() =>
    flow.reviseAction(agent, action.id, { ...edit, idempotencyKey: randomUUID() }),
  ).toThrow('Request changed');
  expect(flow.attention(owner).items).toHaveLength(1);
  flow.respond(owner, action.id, {
    revision: 2,
    state: 'done',
    response: 'Signed in.',
    idempotencyKey: randomUUID(),
  });
  expect(() =>
    flow.reviseAction(agent, action.id, {
      revision: 3,
      title: 'Rewritten after completion',
      idempotencyKey: randomUUID(),
    }),
  ).toThrow('Only open requests');
  expect(flow.action(owner, action.id)).toMatchObject({ state: 'done', response: 'Signed in.' });
});
it('bounds copy-only instructions and preserves omitted guidance without changing legacy retry fingerprints', () => {
  expect(() => requestGuidanceSchema.parse({ steps: Array(6).fill('step') })).toThrow();
  expect(() =>
    requestGuidanceSchema.parse({ copy: { label: 'Run', text: 'x', url: 'javascript:bad' } }),
  ).toThrow();
  const s = streams.submit(agent, {
    title: 'Legacy',
    outcome: 'Keep requests',
    idempotencyKey: randomUUID(),
  });
  const input = {
    streamId: s.id,
    title: 'Legacy action',
    doneWhen: 'Human answers',
    idempotencyKey: randomUUID(),
  };
  const action = flow.createAction(agent, input);
  expect(flow.createAction(agent, input).id).toBe(action.id);
  expect(action.guidance).toEqual({ steps: [], why: '', recommendation: '' });
  expect(() =>
    streams.recordContext(agent, s.id, {
      kind: 'finding',
      body: 'Not a question',
      guidance,
      idempotencyKey: randomUUID(),
    }),
  ).toThrow('for questions');
});
