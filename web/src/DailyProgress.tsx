import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import { Check, CircleCheck, RefreshCw, Settings2, X } from 'lucide-react';
import type { DailyProgress as Progress } from '../../src/shared/daily-progress.js';
import { goalProgress } from '../../src/shared/goal-progress.js';
type Request = <T>(path: string, body?: unknown, method?: string) => Promise<T>;
export function DailyProgress({ request }: { request: Request }) {
  const [data, setData] = useState<Progress | null>(null),
    [lastTarget, setLastTarget] = useState<number | null>(null),
    [error, setError] = useState(''),
    [formError, setFormError] = useState(''),
    [editing, setEditing] = useState(false),
    [target, setTarget] = useState('5'),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    goalInput = useRef<HTMLInputElement>(null),
    sequence = useRef(0),
    editRevision = useRef<number | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function load() {
    const current = ++sequence.current;
    try {
      const result = await request<Progress>(
        '/daily-progress?timeZone=' + encodeURIComponent(timeZone),
      );
      if (current === sequence.current) {
        setData(result);
        setLastTarget(result.target);
        setError('');
        return result;
      }
    } catch {
      if (current === sequence.current) {
        setError('Progress could not be refreshed.');
        setData((previous) => (previous && Date.now() >= previous.nextDayAt ? null : previous));
      }
    }
  }
  useEffect(() => {
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const timer = setInterval(refresh, 3000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      ++sequence.current;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [request, timeZone]);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => void load(), Math.max(0, data.nextDayAt - Date.now() + 50));
    return () => clearTimeout(timer);
  }, [data?.nextDayAt]);
  useEffect(() => {
    if (editing) {
      dialog.current?.showModal();
      goalInput.current?.focus();
      goalInput.current?.select();
    } else dialog.current?.close();
  }, [editing]);
  const progress = data ? goalProgress(data.count, data.target) : null;
  const open = () => {
    if (!data) return;
    setTarget(String(data.target));
    editRevision.current = data.revision;
    setFormError('');
    setEditing(true);
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    setBusy(true);
    setFormError('');
    try {
      await request('/daily-progress/target', {
        target: Number(target),
        revision: editRevision.current,
      });
      await load();
      setEditing(false);
    } catch (e) {
      setFormError((e as Error).message);
      const latest = await load();
      if (latest) editRevision.current = latest.revision;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section
        className="daily-progress"
        aria-label="Daily change progress"
        data-reached={!!progress && progress.remaining === 0}
      >
        <div className="daily-progress-heading">
          <span>
            <CircleCheck size={15} aria-hidden="true" /> Changes today
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Edit daily goal"
            onClick={open}
            disabled={!data}
          >
            <Settings2 size={14} />
          </button>
        </div>
        <div className="daily-progress-body">
          <div
            className="daily-progress-ring"
            style={
              { '--count-scale': Math.min(1, 4 / String(data?.count ?? 0).length) } as CSSProperties
            }
          >
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="goal-ring-track" cx="60" cy="60" r="46" />
              {!!progress?.goalFraction && (
                <circle
                  className="goal-ring-value"
                  cx="60"
                  cy="60"
                  r="46"
                  pathLength="100"
                  strokeDasharray={`${progress.goalFraction * 100} 100`}
                />
              )}
              {!!progress?.over && (
                <>
                  <circle className="goal-ring-bonus-track" cx="60" cy="60" r="54" />
                  <circle
                    className="goal-ring-bonus"
                    cx="60"
                    cy="60"
                    r="54"
                    pathLength="100"
                    strokeDasharray={`${progress.bonusFraction * 100} 100`}
                  />
                </>
              )}
            </svg>
            <div>
              <strong>{data?.count ?? '—'}</strong>
              <span>done</span>
            </div>
          </div>
          <div className="daily-progress-numbers">
            <button className="daily-target" onClick={open} disabled={!data}>
              Goal <strong>{data?.target ?? lastTarget ?? '—'}</strong>
            </button>
            <p className="daily-result">
              {progress ? (
                progress.over > 0 ? (
                  <>
                    <span className="daily-over">+{progress.over} over goal</span>
                    <span>{progress.percent}% of your goal</span>
                  </>
                ) : progress.remaining === 0 ? (
                  <>
                    <span>
                      <Check size={13} /> Goal reached
                    </span>
                    <span>100% of your goal</span>
                  </>
                ) : (
                  <>
                    <span>{progress.remaining} to go</span>
                    <span>{progress.percent}% of your goal</span>
                  </>
                )
              ) : (
                <span>{error ? 'Progress unavailable' : 'Loading progress…'}</span>
              )}
            </p>
          </div>
        </div>
        {error && (
          <div className="daily-progress-footer" role="status">
            <span>Couldn’t refresh</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh daily progress"
              onClick={() => void load()}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        )}
      </section>
      <dialog
        ref={dialog}
        className="daily-goal-dialog"
        aria-labelledby="daily-goal-heading"
        onCancel={() => setEditing(false)}
      >
        <div className="dialog-heading">
          <h2 id="daily-goal-heading">Your daily goal</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close daily goal"
            onClick={() => setEditing(false)}
          >
            <X size={17} />
          </button>
        </div>
        <p>
          Each change counts once, when it’s first delivered or marked complete. Reopening and
          finishing it again won’t increase the total.
        </p>
        <form onSubmit={save}>
          <label>
            Daily goal
            <input
              type="number"
              ref={goalInput}
              min="1"
              max="1000"
              step="1"
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          <p className="fine">
            Resets at midnight in your time zone ({data?.timeZone ?? timeZone}). Your total keeps
            growing after you reach your goal.
          </p>
          <button type="submit" className="primary" disabled={!data || busy}>
            Save goal
          </button>
        </form>
        {(formError || error) && <p role="alert">{formError || error}</p>}
        {!!data?.items.length && (
          <details className="daily-goal-list">
            <summary>Changes done today · {data.count}</summary>
            {data.items.map((item) => (
              <a key={item.id} href={`/?view=active&work=${encodeURIComponent(item.id)}`}>
                <span>{item.title}</span>
                <small>{item.streamTitle ?? 'Change'}</small>
              </a>
            ))}
            {data.count > data.items.length && (
              <p className="fine">
                Showing the {data.items.length} most recent. All {data.count} count toward your
                goal.
              </p>
            )}
          </details>
        )}
      </dialog>
    </>
  );
}
