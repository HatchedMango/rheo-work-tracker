import type { Store } from '../db/index.js';
import type { Actor } from '../shared/contracts.js';
import {
  dailyTargetSchema,
  timeZoneSchema,
  type DailyProgress,
  type CompletedChange,
} from '../shared/daily-progress.js';
import { ensure } from './errors.js';

export function dayWindow(now: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateKey = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    return ['year', 'month', 'day']
      .map((key) => parts.find((p) => p.type === key)!.value)
      .join('-');
  };
  const day = dateKey(now);
  const boundary = (after: boolean) => {
    let low = now - 36 * 3600000,
      high = now + 36 * 3600000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (after ? dateKey(mid) > day : dateKey(mid) >= day) high = mid;
      else low = mid + 1;
    }
    return low;
  };
  return { day, timeZone, start: boundary(false), end: boundary(true) };
}
export type ProgressWindow = ReturnType<typeof dayWindow>;
export type ProgressSource = (
  store: Store,
  window: ProgressWindow,
  now: number,
) => { count: number; items: CompletedChange[] };
// Keep the metric separate from its visual and target settings, without a provider dependency.
export const changesDoneToday: ProgressSource = (store, window, now) => {
  const end = Math.min(window.end, now + 1);
  const { count } = store.raw
    .prepare('SELECT count(*) count FROM change_completions WHERE completedAt>=? AND completedAt<?')
    .get(window.start, end) as { count: number };
  const items = store.raw
    .prepare(
      `SELECT w.id,w.title,c.completedAt,c.milestone,s.title streamTitle
    FROM change_completions c JOIN work w ON w.id=c.workId
    LEFT JOIN change_meta m ON m.workId=w.id LEFT JOIN streams s ON s.id=m.streamId
    WHERE c.completedAt>=? AND c.completedAt<? ORDER BY c.completedAt DESC,c.workId LIMIT 30`,
    )
    .all(window.start, end) as CompletedChange[];
  return { count, items };
};
export class DailyProgressService {
  constructor(
    private store: Store,
    private clock: () => number = Date.now,
    private source: ProgressSource = changesDoneToday,
  ) {}
  private allow(a: Actor) {
    ensure(
      a.scope === 'owner' && a.ownerId === 'owner',
      403,
      'Daily progress is private to the owner.',
    );
  }
  private preferences() {
    return this.store.raw
      .prepare("SELECT target,revision FROM daily_progress_preferences WHERE id='local'")
      .get() as { target: number; revision: number };
  }
  setTarget(a: Actor, input: unknown) {
    this.allow(a);
    const p = dailyTargetSchema.parse(input);
    const changed = this.store.raw
      .prepare(
        "UPDATE daily_progress_preferences SET target=?,revision=revision+1 WHERE id='local' AND revision=?",
      )
      .run(p.target, p.revision);
    ensure(
      changed.changes === 1,
      409,
      'Your daily goal changed in another window. Save again to use this value.',
    );
    return this.preferences();
  }
  get(a: Actor, timeZone: string): DailyProgress {
    this.allow(a);
    timeZoneSchema.parse(timeZone);
    const now = this.clock(),
      window = dayWindow(now, timeZone);
    return this.store.raw.transaction(() => ({
      ...this.preferences(),
      ...this.source(this.store, window, now),
      metric: 'changes_done' as const,
      day: window.day,
      timeZone,
      nextDayAt: window.end,
      checkedAt: now,
    }))();
  }
}
