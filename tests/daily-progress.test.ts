import { it, expect, beforeEach, afterEach } from 'vitest';
import { openStore } from '../src/db/index.js';
import { dayWindow, DailyProgressService } from '../src/services/daily-progress.js';
import { goalProgress } from '../src/shared/goal-progress.js';
import { WorkService } from '../src/services/work.js';
import { StreamService } from '../src/services/streams.js';
import { Auth } from '../src/services/auth.js';
import { createSchema, type Actor } from '../src/shared/contracts.js';
let store: ReturnType<typeof openStore>,
  now: number,
  work: WorkService,
  streams: StreamService,
  progress: DailyProgressService,
  agent: Actor;
const owner: Actor = { id: 'owner', scope: 'owner', ownerId: 'owner' };
beforeEach(() => {
  store = openStore(':memory:');
  now = Date.parse('2026-11-16T18:00:00Z');
  work = new WorkService(store, () => now);
  streams = new StreamService(work);
  progress = new DailyProgressService(store, () => now);
  const auth = new Auth(store);
  agent = auth.actor(auth.register('agent', 'Agent').secret, 'bearer');
});
afterEach(() => store.close());
const create = (title = 'A change') =>
  work.create(agent, createSchema.parse({ title, objective: title }));
const report = (id: string, state: 'delivered' | 'working' | 'review') =>
  streams.updateChange(agent, id, {
    revision: work.get(agent, id).tracking.revision,
    progress: state,
    progressNote: state === 'working' ? 'Reopening to refine it.' : 'Work updated.',
  });
it('counts delivered and manually completed changes immediately, never counting other statuses', () => {
  const done = create('Delivered'),
    manual = create('Manually complete'),
    waiting = create('Review'),
    cancelled = create('Cancelled');
  report(done.id, 'delivered');
  report(waiting.id, 'review');
  work.action(owner, manual.id, { action: 'complete', revision: manual.revision, message: '' });
  work.action(owner, cancelled.id, { action: 'cancel', revision: cancelled.revision, message: '' });
  expect(progress.get(owner, 'America/Chicago')).toMatchObject({
    count: 2,
    target: 5,
    metric: 'changes_done',
    day: '2026-11-16',
  });
  expect(
    progress
      .get(owner, 'America/Chicago')
      .items.map((x) => x.title)
      .sort(),
  ).toEqual(['Delivered', 'Manually complete']);
  work.action(owner, done.id, {
    action: 'complete',
    revision: work.get(owner, done.id).revision,
    message: '',
  });
  expect(progress.get(owner, 'America/Chicago').count).toBe(2);
});
it('preserves first completion through repeated reports, reopening, and redelivery on another day', () => {
  const change = create();
  report(change.id, 'delivered');
  const first = now;
  now += 10000;
  report(change.id, 'delivered');
  report(change.id, 'working');
  expect(progress.get(owner, 'America/Chicago').count).toBe(1);
  now = Date.parse('2026-11-17T18:00:00Z');
  report(change.id, 'delivered');
  expect(progress.get(owner, 'America/Chicago').count).toBe(0);
  expect(
    store.raw.prepare('SELECT completedAt FROM change_completions WHERE workId=?').get(change.id),
  ).toEqual({ completedAt: first });
});
it('uses actual local completion dates and never changes historical credit when reports are edited', () => {
  now = Date.parse('2026-11-16T05:59:59Z');
  const prior = create('Prior day');
  report(prior.id, 'delivered');
  now = Date.parse('2026-11-16T06:00:00Z');
  const current = create('Today');
  report(current.id, 'delivered');
  now = Date.parse('2026-11-16T18:00:00Z');
  report(prior.id, 'delivered');
  expect(progress.get(owner, 'America/Chicago').items.map((x) => x.id)).toEqual([current.id]);
  expect(progress.get(owner, 'UTC').count).toBe(2);
});
it('protects owner settings with revisions and retains a complete count when the detail list is limited', () => {
  for (let i = 0; i < 35; i++) report(create('Change ' + i).id, 'delivered');
  expect(progress.get(owner, 'UTC')).toMatchObject({ count: 35, target: 5 });
  expect(progress.get(owner, 'UTC').items).toHaveLength(30);
  expect(progress.setTarget(owner, { target: 8, revision: 1 })).toEqual({ target: 8, revision: 2 });
  expect(() => progress.setTarget(owner, { target: 2, revision: 1 })).toThrow('goal changed');
  expect(() => progress.setTarget(owner, { target: 0, revision: 2 })).toThrow();
  expect(() => progress.get(agent, 'UTC')).toThrow('private to the owner');
  expect(() => progress.get(owner, 'not-a-zone')).toThrow();
  expect(new DailyProgressService(store, () => now).get(owner, 'UTC').target).toBe(8);
});
it('records completion atomically with the milestone instead of crediting rolled-back updates', () => {
  const change = create();
  expect(() =>
    store.raw.transaction(() => {
      store.raw.prepare('UPDATE change_meta SET deliveredAt=? WHERE workId=?').run(now, change.id);
      throw new Error('Roll back');
    })(),
  ).toThrow('Roll back');
  expect(progress.get(owner, 'UTC').count).toBe(0);
});
it('uses real calendar days through DST and UTC offsets', () => {
  const spring = dayWindow(Date.parse('2026-03-08T18:00:00Z'), 'America/Chicago');
  const autumn = dayWindow(Date.parse('2026-11-01T18:00:00Z'), 'America/Chicago');
  expect(spring.end - spring.start).toBe(23 * 3600000);
  expect(autumn.end - autumn.start).toBe(25 * 3600000);
  expect(dayWindow(Date.parse('2026-11-16T12:00:00Z'), 'Pacific/Kiritimati').day).toBe(
    '2026-11-17',
  );
});
it('keeps percentages and over-goal totals uncapped', () => {
  expect(goalProgress(3, 5)).toMatchObject({ percent: 60, remaining: 2, over: 0 });
  expect(goalProgress(5, 5)).toMatchObject({ percent: 100, remaining: 0, over: 0 });
  expect(goalProgress(999, 1000)).toMatchObject({ percent: 99, remaining: 1 });
  expect(goalProgress(8, 5)).toMatchObject({ percent: 160, over: 3, bonusFraction: 0.6 });
  expect(goalProgress(11, 5).bonusFraction).toBeGreaterThanOrEqual(
    goalProgress(10, 5).bonusFraction,
  );
  expect(goalProgress(18, 5)).toMatchObject({ percent: 360, over: 13, bonusFraction: 1 });
});
