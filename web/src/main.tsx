import { StatusBadge, WorkerStatus } from './UI.js';
import { Oversight } from './Oversight.js';
import { ChangeTrackingView } from './Streams.js';
import type { Stream } from '../../src/shared/streams.js';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Inbox,
  Layers3,
  GitPullRequest,
  Plug,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Check,
  ChevronRight,
  Search,
  X,
  TerminalSquare,
  Activity,
  Link as LinkIcon,
} from 'lucide-react';
import type { Detail } from '../../src/db/schema.js';
import type { WorkList, Status } from '../../src/services/work.js';
import type { Action, Content } from '../../src/shared/contracts.js';
import {
  activeStatuses,
  historyStatuses,
  statusLabels,
  workStatus,
} from '../../src/shared/work-status.js';
import type { WorkStatus } from '../../src/shared/work-status.js';
import './styles.css';
import { Connections } from './Connections.js';
import { WorkContent, BriefContent, ActivityContent, ContextChanges } from './WorkContent.js';
const views = ['active', 'history'] as const;
type View = 'streams' | 'needs' | 'inbox' | 'connections' | (typeof views)[number];
type StatusFilter = 'any' | WorkStatus;
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let sessionRequest: Promise<void> | undefined;
function ensureLocalSession(): Promise<void> {
  if (!sessionRequest) {
    sessionRequest = (async () => {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const result = await response.json();
        throw new RequestError(
          response.status,
          result.message || 'Could not open the local workspace.',
        );
      }
    })().catch((error) => {
      sessionRequest = undefined;
      throw error;
    });
  }
  return sessionRequest;
}
async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const send = () =>
    fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  await ensureLocalSession();
  const attemptedSession = sessionRequest;
  let r = await send();
  // An expired/cleared cookie renews silently. Only an explicit 401 is retried;
  // uncertain writes and network failures are never blindly replayed.
  if (r.status === 401) {
    if (sessionRequest === attemptedSession) sessionRequest = undefined;
    await ensureLocalSession();
    r = await send();
  }
  const result = await r.json();
  if (!r.ok) throw new RequestError(r.status, result.message || 'Request failed.');
  return result;
}
function currentLocation(): {
  view: View;
  id: string | null;
  streamId: string | null;
  filter: StatusFilter;
} {
  const params = new URLSearchParams(location.search);
  const raw = params.get('view') || (params.has('work') ? 'active' : 'streams');
  const legacy: Record<string, { view: View; filter: StatusFilter }> = {
    inbox: { view: 'needs', filter: 'any' },
    settings: { view: 'connections', filter: 'any' },
    all: { view: 'active', filter: 'any' },
    backlog: { view: 'active', filter: 'backlog' },
    queued: { view: 'active', filter: 'queued' },
    running: { view: 'active', filter: 'running' },
    review: { view: 'active', filter: 'review' },
    completed: { view: 'history', filter: 'completed' },
    cancelled: { view: 'history', filter: 'cancelled' },
  };
  const view =
    legacy[raw]?.view ||
    (['streams', 'needs', 'inbox', 'connections', ...views].includes(raw)
      ? (raw as View)
      : 'streams');
  const requested = params.get('status') || legacy[raw]?.filter || 'any';
  const allowed: readonly string[] =
    view === 'history' ? historyStatuses : view === 'active' ? activeStatuses : [];
  const filter = allowed.includes(requested) ? (requested as WorkStatus) : 'any';
  return { view, id: params.get('work'), streamId: params.get('stream'), filter };
}
function time(n: number) {
  return new Date(n).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
function Badge({
  state,
  label,
  covered = false,
  progress,
  requested = false,
}: {
  state: string;
  label?: string;
  covered?: boolean;
  progress?: string;
  requested?: boolean;
}) {
  if (!label && ['accepted', 'backlog'].includes(state)) {
    if (progress === 'working') return <StatusBadge state="working" label="In progress" />;
    if (progress === 'blocked') return <StatusBadge state="blocked" label="Waiting" />;
    if (progress === 'review') return <StatusBadge state="available" label="Ready" />;
    if (progress === 'planned' || progress === 'unreported' || covered)
      return <StatusBadge state="planned" label="Planned" />;
  }
  if (state === 'delivered') return <StatusBadge state="delivered" label="Delivered" />;
  if (covered && state === 'accepted')
    return <StatusBadge state="covered" label="Stream coverage" />;
  return (
    <StatusBadge
      state={label === 'Needs decision' ? 'needs_decision' : state}
      label={
        label ||
        (state === 'review'
          ? 'Review ready'
          : statusLabels[state as WorkStatus]?.toLowerCase() || state.replaceAll('_', ' '))
      }
    />
  );
}
function App() {
  const [route, setRoute] = useState(currentLocation);
  const [status, setStatus] = useState<Status | null>(null);
  const [list, setList] = useState<WorkList>({ items: [], total: 0 });
  const [streams, setStreams] = useState<Stream[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState<'edit' | null>(null);
  const [note, setNote] = useState('');
  const [changes, setChanges] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = (
    view: View,
    id: string | null = null,
    filter: StatusFilter = view === route.view ? route.filter : 'any',
    streamId: string | null = view === route.view ? route.streamId : null,
  ) => {
    const p = new URLSearchParams({ view });
    if (id) p.set('work', id);
    if (streamId) p.set('stream', streamId);
    if (filter !== 'any') p.set('status', filter);
    history.pushState({}, '', `/?${p}`);
    setRoute({ view, id, filter, streamId });
    setError('');
    if (view !== route.view || filter !== route.filter) setOffset(0);
  };
  useEffect(() => {
    const listener = () => {
      setRoute(currentLocation());
      setOffset(0);
    };
    addEventListener('popstate', listener);
    return () => removeEventListener('popstate', listener);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    // Remove legacy login fragments; old bookmarks now open the workspace directly.
    if (location.hash.startsWith('#login='))
      history.replaceState({}, '', location.pathname + location.search);
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [s, l, d, streamList] = await Promise.all([
          api<Status>('/status'),
          ['connections', 'streams', 'needs'].includes(route.view)
            ? Promise.resolve({ items: [], total: 0 })
            : api<WorkList>(
                `/work?${new URLSearchParams({ view: route.view, status: route.filter, q: search, limit: '40', offset: String(offset), ...(route.streamId ? { streamId: route.streamId } : {}) })}`,
              ),
          route.id ? api<Detail>(`/work/${route.id}`) : Promise.resolve(null),
          ['connections', 'streams', 'needs'].includes(route.view)
            ? Promise.resolve({ items: [], total: 0 })
            : api<{ items: Stream[]; total: number }>(
                `/streams?view=${route.view === 'inbox' ? 'inbox' : route.view === 'history' ? 'history' : 'active'}&q=${encodeURIComponent(search)}&limit=100`,
              ),
        ]);
        if (!cancelled) {
          setStreams(streamList.items);
          setStatus(s);
          setList(l);
          setDetail(d);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }
    setLoading(true);
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [route.view, route.id, route.streamId, route.filter, search, offset, refresh]);
  useEffect(() => {
    setNote('');
    setChanges('');
  }, [route.id]);
  useEffect(() => {
    if (compose) {
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [compose]);
  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setRefresh((v) => v + 1);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function action(action: Action['action']) {
    if (!detail) return;
    if (
      await mutate(async () => {
        setDetail(
          await api<Detail>(`/work/${detail.id}/actions`, {
            action,
            revision: detail.revision,
            message: changes,
          }),
        );
      })
    )
      setChanges('');
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const ref = String(f.get('reference') || '').trim();
    const body: Content = {
      title: String(f.get('title')),
      objective: String(f.get('objective')),
      priority: String(f.get('priority')) as Content['priority'],
      acceptanceCriteria: String(f.get('criteria'))
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      references: ref ? [{ system: 'link', url: ref }] : [],
    };
    if (!detail) return;
    body.references = [...detail.references.map(({ system, url }) => ({ system, url }))];
    if (ref && !body.references.some((r) => r.url === ref))
      body.references.push({ system: 'link', url: ref });
    await mutate(async () => {
      const d = await api<Detail>(
        `/work/${detail.id}`,
        { ...body, revision: detail.revision },
        'PUT',
      );
      setCompose(null);
      navigate(route.view, d.id);
    });
  }
  const inbox = route.view === 'inbox';
  const settings = route.view === 'connections';
  const title =
    route.view === 'streams'
      ? 'Streams'
      : route.view === 'needs'
        ? 'Needs you'
        : inbox
          ? 'Inbox'
          : settings
            ? 'Connections'
            : 'Changes';
  const oversightView =
    (['streams', 'needs'].includes(route.view) || !!route.streamId) && !route.id && !settings;
  const run = detail?.runs.find((r) =>
    ['queued', 'claimed', 'running', 'awaiting_review'].includes(r.state),
  );
  const editable = detail?.lifecycle === 'open' && !run;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate('streams');
          }}
        >
          <span className="brand-icon">
            <Layers3 size={21} />
          </span>
          Work Inbox
        </a>
        <nav aria-label="Primary">
          <button
            className={route.view === 'streams' ? 'selected' : ''}
            onClick={() => navigate('streams')}
          >
            <Layers3 size={18} />
            Streams
          </button>
          <button
            className={route.view === 'needs' ? 'selected' : ''}
            onClick={() => navigate('needs')}
          >
            <Inbox size={18} />
            Needs you
            {!!status?.inboxCount && (
              <span className="nav-count needs-attention">{status.inboxCount}</span>
            )}
          </button>
          <button
            className={!oversightView && !settings ? 'selected' : ''}
            onClick={() => navigate('active')}
          >
            <GitPullRequest size={18} />
            Changes
          </button>
          <button className={settings ? 'selected' : ''} onClick={() => navigate('connections')}>
            <Plug size={18} />
            Connections
          </button>
        </nav>
        {status?.workers.some((worker) => worker.online) && (
          <div className="sidebar-note">
            <WorkerStatus workers={status.workers} />
          </div>
        )}
      </aside>
      <main className={`main ${route.id || route.streamId ? 'has-selection' : ''}`}>
        <header className="page-header">
          <h1>{title}</h1>
        </header>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button
              onClick={() => {
                setError('');
                setRefresh((v) => v + 1);
              }}
            >
              Retry
            </button>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {settings ? (
          <Connections request={api} workers={status?.workers} />
        ) : oversightView ? (
          <Oversight
            view={route.view === 'needs' ? 'needs' : 'streams'}
            streamId={route.streamId}
            request={api}
            onStream={(id) => navigate('streams', null, 'any', id)}
            onWork={(id) => navigate('active', id)}
            onUngrouped={() => navigate('active')}
            onRefresh={() => setRefresh((v) => v + 1)}
          />
        ) : (
          <>
            <div className="toolbar">
              {inbox ? (
                <span className="list-count">
                  {list.total + streams.length}{' '}
                  {list.total + streams.length === 1 ? 'item' : 'items'}
                </span>
              ) : (
                <div className="work-controls">
                  <div className="tabs" role="group" aria-label="Work views">
                    {views.map((v) => (
                      <button
                        key={v}
                        className={route.view === v ? 'active' : ''}
                        aria-pressed={route.view === v}
                        onClick={() => navigate(v)}
                      >
                        {v === 'active' ? 'Active' : 'History'}
                        {route.view === v && <span>{list.total}</span>}
                      </button>
                    ))}
                  </div>
                  <select
                    aria-label="Filter by status"
                    value={route.filter}
                    onChange={(e) => navigate(route.view, null, e.target.value as StatusFilter)}
                  >
                    <option value="any">All statuses</option>
                    {(route.view === 'history' ? historyStatuses : activeStatuses)
                      .filter((state) => !['accepted', 'declined'].includes(state))
                      .map((value) => (
                        <option key={value} value={value}>
                          {statusLabels[value]}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Search work"
                  placeholder="Search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            <div className={`workspace ${route.id || route.streamId ? 'with-detail' : ''}`}>
              <section className="work-list" aria-label="Work items">
                {loading && list.items.length === 0 ? (
                  <p className="list-loading" role="status">
                    Loading your work…
                  </p>
                ) : list.items.length === 0 ? (
                  <div className="empty-state">
                    <h2>
                      {search
                        ? 'No matches'
                        : inbox
                          ? streams.length
                            ? 'No change decisions'
                            : 'Inbox empty'
                          : route.filter !== 'any'
                            ? `No ${statusLabels[route.filter].toLowerCase()} work`
                            : route.view === 'history'
                              ? 'No history'
                              : 'No active work'}
                    </h2>
                    {!search &&
                      ['inbox', 'active'].includes(route.view) &&
                      route.filter === 'any' && (
                        <p>
                          {inbox
                            ? 'New assignments and results appear here.'
                            : 'Work arrives through connected agents.'}
                        </p>
                      )}
                    {!search &&
                      ['inbox', 'active'].includes(route.view) &&
                      route.filter === 'any' && (
                        <button className="text-button" onClick={() => navigate('connections')}>
                          Connect an agent <ArrowUpRight size={14} />
                        </button>
                      )}
                  </div>
                ) : (
                  list.items.map((w) => {
                    const state = workStatus(w, w.run, w.assignment);
                    return (
                      <button
                        className={`work-card ${route.id === w.id ? 'chosen' : ''}`}
                        key={w.id}
                        aria-pressed={route.id === w.id}
                        aria-labelledby={`work-title-${w.id}`}
                        aria-describedby={`work-meta-${w.id}`}
                        onClick={() => navigate(route.view, w.id)}
                      >
                        <div className="card-heading">
                          <h3 id={`work-title-${w.id}`}>{w.title}</h3>
                          {w.priority !== 'normal' && (
                            <span className={`priority ${w.priority}`}>
                              <span />
                              {w.priority}
                            </span>
                          )}
                        </div>
                        <div className="card-bottom" id={`work-meta-${w.id}`}>
                          {w.priority !== 'normal' && (
                            <span className="sr-only">{w.priority} priority.</span>
                          )}
                          <Badge
                            state={state}
                            progress={w.tracking.progress}
                            requested={w.tracking.reviewRequested === 1}
                            covered={w.assignment?.state === 'covered'}
                          />
                          {w.tracking.streamTitle && (
                            <span className="row-stream" title={w.tracking.streamTitle}>
                              {w.tracking.streamTitle}
                            </span>
                          )}
                          <ChevronRight size={16} aria-hidden="true" />
                        </div>
                      </button>
                    );
                  })
                )}
                {list.total > 40 && (
                  <div className="pagination">
                    <button
                      disabled={!offset}
                      onClick={() => setOffset((o) => Math.max(0, o - 40))}
                    >
                      Previous
                    </button>
                    <span>
                      {offset + 1}–{Math.min(offset + 40, list.total)} / {list.total}
                    </span>
                    <button
                      disabled={offset + 40 >= list.total}
                      onClick={() => setOffset((o) => o + 40)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </section>
              {route.id ? (
                <section className="detail" aria-label="Work detail" key={route.id}>
                  <div className="detail-top">
                    <button className="text-button" onClick={() => navigate(route.view)}>
                      <ArrowLeft size={15} />
                      Back to list
                    </button>
                    <div className="detail-tools">
                      {editable && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => setCompose('edit')}
                        >
                          Edit context
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label="Close detail"
                        onClick={() => navigate(route.view)}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                  {!detail || detail.id !== route.id ? (
                    <p role="status">Loading detail…</p>
                  ) : (
                    <>
                      <div className="detail-meta">
                        <Badge
                          state={workStatus(detail, detail.runs[0] || null, detail.assignment)}
                          progress={detail.tracking.progress}
                          requested={detail.tracking.reviewRequested === 1}
                          covered={detail.assignment?.state === 'covered'}
                        />
                        {detail.priority !== 'normal' && (
                          <span className={`priority ${detail.priority}`}>
                            <span />
                            {detail.priority}
                          </span>
                        )}
                      </div>
                      <h2 className="detail-title">{detail.title}</h2>
                      {detail.lifecycle === 'open' && (
                        <details
                          className="action-panel"
                          open={!!run || detail.attention.some((a) => a.kind === 'failure')}
                        >
                          <summary>{run ? 'Execution' : 'Manage change'}</summary>
                          <div className="action-panel-body">
                            {detail.attention.some((a) => a.kind === 'failure') && (
                              <div className="failure-note">
                                <strong>The last attempt was interrupted.</strong>
                                <p>No automatic retry was started.</p>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => void action('dismiss_failure')}
                                >
                                  Acknowledge failure
                                </button>
                              </div>
                            )}
                            {run?.state === 'awaiting_review' ? (
                              <>
                                <h3>Review result</h3>
                                <div className="action-buttons">
                                  <button
                                    className="primary"
                                    disabled={busy}
                                    onClick={() => void action('approve')}
                                  >
                                    <Check size={16} />
                                    Approve result &amp; complete
                                  </button>
                                </div>
                                <label className="changes-label">
                                  Changes needed
                                  <textarea
                                    rows={2}
                                    placeholder="What should change before another attempt?"
                                    value={changes}
                                    onChange={(e) => setChanges(e.target.value)}
                                  />
                                </label>
                                <button
                                  className="secondary"
                                  disabled={busy || !changes.trim()}
                                  onClick={() => void action('changes')}
                                >
                                  Request changes
                                </button>
                              </>
                            ) : run ? (
                              <>
                                <h3>{run.state === 'queued' ? 'Queued' : 'Running'}</h3>
                                <p>
                                  <WorkerStatus workers={status?.workers} />
                                </p>
                                <Badge state={run.state} />
                              </>
                            ) : (
                              <>
                                <div className="action-buttons">
                                  <button
                                    className="primary"
                                    disabled={busy}
                                    onClick={() => void action('complete')}
                                  >
                                    <Check size={16} />
                                    Mark complete
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </details>
                      )}
                      <section className="detail-section" aria-label="Details">
                        <h3>Details</h3>
                        <BriefContent text={detail.objective} />
                      </section>
                      {detail.acceptanceCriteria.length > 0 && (
                        <details className="detail-section criteria-details">
                          <summary>Success criteria</summary>
                          <ul className="criteria">
                            {detail.acceptanceCriteria.map((c, i) => (
                              <li key={i}>
                                <span className="criterion-number" aria-hidden="true">
                                  {i + 1}
                                </span>
                                <WorkContent text={c} />
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <ChangeTrackingView
                        work={detail}
                        onStream={(id) => navigate('active', null, 'any', id)}
                        onChange={(id) => navigate(route.view, id)}
                      />
                      {detail.references.length > 0 && (
                        <div className="detail-section">
                          <h3>References</h3>
                          {detail.references.map((r) => (
                            <a
                              className="reference"
                              key={r.id}
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <LinkIcon size={14} />
                              {r.system}
                              <ArrowUpRight size={13} />
                            </a>
                          ))}
                        </div>
                      )}
                      {detail.runs.length > 0 && (
                        <div className="detail-section">
                          <h3>
                            Runs <span className="subtle-count">{detail.runs.length}</span>
                          </h3>
                          {detail.runs.map((r, i) => (
                            <details className="run-box" key={r.id} open={i === 0}>
                              <summary>
                                <TerminalSquare size={16} />
                                Attempt · {time(r.createdAt)}
                                <Badge state={r.state} />
                              </summary>
                              {r.summary && <WorkContent text={r.summary} />}
                              {r.failure && <p className="failure-note">{r.failure}</p>}
                              {r.artifact && <pre className="artifact">{r.artifact}</pre>}
                              {!r.summary && !r.failure && (
                                <p className="fine">Progress appears in the activity below.</p>
                              )}
                            </details>
                          ))}
                        </div>
                      )}
                      <details className="detail-section activity-details">
                        <summary>
                          <Activity size={16} />
                          Activity{' '}
                          {detail.events.length >= 300 && (
                            <span className="fine">Latest 300 events</span>
                          )}
                        </summary>
                        <form
                          className="note-form"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (
                              await mutate(() =>
                                api(`/work/${detail.id}/updates`, { message: note }),
                              )
                            )
                              setNote('');
                          }}
                        >
                          <label className="sr-only" htmlFor="note">
                            Add a note
                          </label>
                          <textarea
                            id="note"
                            placeholder="Add a note…"
                            rows={2}
                            maxLength={8000}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                          />
                          <button className="secondary" disabled={busy || !note.trim()}>
                            <Plus size={14} />
                            Add note
                          </button>
                        </form>
                        <ol className="timeline">
                          {detail.events.map((e) => (
                            <li key={e.id}>
                              <span className={`event-dot ${e.type === 'note' ? 'note' : ''}`} />
                              <div>
                                <div className="event-byline">
                                  <strong>{e.actorName}</strong>
                                  <span>{time(e.createdAt)}</span>
                                </div>
                                <ActivityContent text={e.message} />
                                {e.type === 'edited' && <ContextChanges data={e.data} />}
                                {e.references.map((r, i) => (
                                  <a
                                    key={i}
                                    className="reference"
                                    href={r.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {r.system}
                                    <ArrowUpRight size={12} />
                                  </a>
                                ))}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </details>
                      {detail.lifecycle === 'open' && (
                        <details className="detail-footer">
                          <summary>Other actions</summary>
                          <button
                            className="text-button danger"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  'Cancel this work and any active attempt? Its history will be kept.',
                                )
                              )
                                void action('cancel');
                            }}
                          >
                            Cancel work
                          </button>
                        </details>
                      )}
                    </>
                  )}
                </section>
              ) : null}
            </div>
          </>
        )}
      </main>
      <dialog
        ref={dialog}
        onCancel={(event) => {
          event.preventDefault();
          setCompose(null);
        }}
        aria-labelledby="compose-title"
        className="compose-dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="compose-title">Edit context</h2>
          </div>
          <button className="icon-button" aria-label="Close form" onClick={() => setCompose(null)}>
            <X size={20} />
          </button>
        </div>
        {compose && (
          <form key={`${compose}-${detail?.id}`} onSubmit={(e) => void save(e)}>
            <label>
              Title
              <input
                name="title"
                required
                maxLength={180}
                autoFocus
                placeholder="What needs doing?"
                defaultValue={detail?.title}
              />
            </label>
            <label>
              Objective
              <textarea
                name="objective"
                required
                maxLength={16000}
                rows={4}
                placeholder="Describe the outcome and useful context."
                defaultValue={detail?.objective}
              />
            </label>
            <label>
              Acceptance criteria <span className="optional">optional · one per line</span>
              <textarea
                name="criteria"
                rows={3}
                defaultValue={detail?.acceptanceCriteria.join('\n')}
              />
            </label>
            <div className="form-row">
              <label>
                Priority
                <select name="priority" defaultValue={detail?.priority}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
            <label>
              Add a reference <span className="optional">optional · HTTP(S)</span>
              <input name="reference" type="url" maxLength={2000} placeholder="https://…" />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="dialog-footer">
              <button className="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
                <ArrowUpRight size={16} />
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
