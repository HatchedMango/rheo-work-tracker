import { StatusBadge } from './UI.js';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  ArrowUpRight,
  Hand,
  MessageCircle,
  CircleHelp,
  ArrowRight,
} from 'lucide-react';
import type { Stream, ContextEntry, Output } from '../../src/shared/streams.js';
import type { AttentionItem, HumanAction } from '../../src/shared/oversight.js';
import type { OversightService } from '../../src/services/oversight.js';
import { WorkContent } from './WorkContent.js';
type Request = <T>(path: string, body?: unknown) => Promise<T>;
type Overview = ReturnType<OversightService['overview']>;
type StreamDetail = ReturnType<OversightService['detail']>;
const when = (n: number) =>
  new Date(n).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
function Pager({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return total > 30 ? (
    <div className="pagination">
      <button
        className="secondary"
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - 30))}
      >
        Previous
      </button>
      <span>
        {offset + 1}–{Math.min(offset + 30, total)} of {total}
      </span>
      <button
        className="secondary"
        disabled={offset + 30 >= total}
        onClick={() => onChange(offset + 30)}
      >
        Next
      </button>
    </div>
  ) : null;
}
function RequestCard({
  item,
  request,
  onStream,
  onWork,
  onRefresh,
}: {
  item: AttentionItem;
  request: Request;
  onStream: (id: string) => void;
  onWork: (id: string) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [record, setRecord] = useState<HumanAction | ContextEntry | null>(null),
    [response, setResponse] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attempts = useRef(new Map<string, string>());
  useEffect(() => {
    if (!expanded || !['action', 'question'].includes(item.kind)) return;
    let cancelled = false;
    request<HumanAction | ContextEntry>(
      item.kind === 'action' ? `/human-actions/${item.entityId}` : `/context/${item.entityId}`,
    )
      .then((r) => {
        if (!cancelled) setRecord(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, item.entityId, item.kind, request]);
  async function save(state = 'done') {
    if (!record) return;
    setBusy(true);
    setError('');
    const body =
      item.kind === 'question'
        ? { revision: record.revision, answer: response }
        : { revision: record.revision, state, response };
    const fingerprint = JSON.stringify(body);
    let key = attempts.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      attempts.current.set(fingerprint, key);
    }
    try {
      await request(
        item.kind === 'question'
          ? `/context/${item.entityId}/answer`
          : `/human-actions/${item.entityId}/respond`,
        { ...body, idempotencyKey: key },
      );
      setExpanded(false);
      setResponse('');
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const respondable = ['question', 'action'].includes(item.kind);
  return (
    <article className="request-card" data-kind={item.kind}>
      <div className="request-heading">
        <span className="eyebrow">
          {item.kind === 'action' ? (
            <Hand size={14} aria-hidden="true" />
          ) : item.kind === 'question' ? (
            <MessageCircle size={14} aria-hidden="true" />
          ) : (
            <CircleHelp size={14} aria-hidden="true" />
          )}
          {item.kind === 'action'
            ? 'Human action'
            : item.kind === 'question'
              ? 'Question'
              : item.kind === 'scope'
                ? 'Scope decision'
                : item.kind === 'review'
                  ? 'Review requested'
                  : item.kind === 'coverage'
                    ? 'Scope coverage'
                    : 'Decision'}
        </span>
        <button
          className="text-button"
          onClick={() =>
            item.streamId ? onStream(item.streamId) : item.workId && onWork(item.workId)
          }
        >
          {item.streamTitle ?? 'Ungrouped work'} <ChevronRight size={13} />
        </button>
      </div>
      <h3>
        <button
          className="request-title"
          onClick={() =>
            respondable
              ? setExpanded((x) => !x)
              : item.workId
                ? onWork(item.workId)
                : item.streamId && onStream(item.streamId)
          }
        >
          {item.title}
        </button>
      </h3>
      {item.body !== item.title && <p>{item.body}</p>}
      {item.direct.length > 0 && (
        <div className="unlock-list">
          <span>
            <ArrowRight size={13} aria-hidden="true" />
            Unlocks
          </span>
          {item.direct.map((d) => (
            <button
              className="text-button"
              key={d.id}
              onClick={() => (d.kind === 'change' ? onWork(d.id) : onStream(d.id))}
            >
              {d.title}
              <ChevronRight size={12} />
            </button>
          ))}
        </div>
      )}
      {item.affectedStreams.length > 0 && (
        <p className="muted">Affects {item.affectedStreams.map((s) => s.title).join(' → ')}</p>
      )}
      {respondable ? (
        <>
          <button
            className={expanded ? 'secondary' : 'primary'}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? 'Close response' : item.kind === 'question' ? 'Answer' : 'Respond'}
          </button>
          {expanded && (
            <form
              className="human-response"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {record && item.kind === 'action' && (
                <>
                  <p>{(record as HumanAction).description}</p>
                  {(record as HumanAction).waitingOn && (
                    <p>Waiting on {(record as HumanAction).waitingOn}</p>
                  )}
                </>
              )}
              <label>
                {item.kind === 'question' ? 'Your answer' : 'Response'}
                <textarea
                  required
                  maxLength={4000}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="primary" disabled={busy || !record || !response.trim()}>
                  {item.kind === 'question' ? 'Save answer' : 'Mark done'}
                </button>
                {item.kind === 'action' && (
                  <>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || !record || !response.trim()}
                      onClick={() => void save('in_progress')}
                    >
                      Still working on it
                    </button>
                    <button
                      className="secondary danger"
                      type="button"
                      disabled={busy || !record || !response.trim()}
                      onClick={() => void save('cancelled')}
                    >
                      Cancel request
                    </button>
                  </>
                )}
              </div>
            </form>
          )}
        </>
      ) : (
        <button
          className="primary"
          onClick={() =>
            item.workId ? onWork(item.workId) : item.streamId && onStream(item.streamId)
          }
        >
          Review <ArrowUpRight size={13} />
        </button>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
    </article>
  );
}
export function Oversight({
  view,
  streamId,
  request,
  onStream,
  onWork,
  onUngrouped,
  onRefresh,
}: {
  view: 'streams' | 'needs';
  streamId: string | null;
  request: Request;
  onStream: (id: string | null) => void;
  onWork: (id: string) => void;
  onUngrouped: () => void;
  onRefresh: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null),
    [attention, setAttention] = useState<{ items: AttentionItem[]; total: number } | null>(null),
    [detail, setDetail] = useState<StreamDetail | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [offset, setOffset] = useState(0),
    [detailOffset, setDetailOffset] = useState(0),
    [history, setHistory] = useState(false),
    [showChanges, setShowChanges] = useState(false);
  const reload = () => {
    setRefresh((n) => n + 1);
    onRefresh();
  };
  useEffect(() => {
    setOffset(0);
    setDetailOffset(0);
    setShowChanges(false);
    setError('');
  }, [view, streamId]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [o, t, d] = await Promise.all([
          !streamId && view === 'streams'
            ? request<Overview>(
                `/oversight/streams?view=${history ? 'history' : 'active'}&offset=${offset}`,
              )
            : Promise.resolve(null),
          request<{ items: AttentionItem[]; total: number }>(
            `/attention?offset=${streamId ? 0 : offset}${streamId ? `&streamId=${streamId}` : ''}`,
          ),
          streamId
            ? request<StreamDetail>(`/streams/${streamId}/overview?offset=${detailOffset}`)
            : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setOverview(o);
          setAttention(t);
          setDetail(d);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [view, streamId, request, refresh, offset, detailOffset, history]);
  async function action(action: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await request(`/streams/${detail.stream.id}/actions`, {
        revision: detail.stream.revision,
        action,
      });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function coverExisting() {
    if (!detail) return;
    setBusy(true);
    try {
      await request(`/streams/${detail.stream.id}/coverage`, {
        streamRevision: detail.stream.revision,
        changeIds: detail.changes.items
          .filter(
            (w) =>
              w.assignment?.state === 'proposed' ||
              (w.assignment?.state === 'covered' && !w.tracking.coverage),
          )
          .map((w) => w.id),
        streamIds: detail.children.items
          .filter((s) => s.state === 'proposed' || (s.coverageApprovalId && !s.coverage))
          .map((s) => s.id),
      });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const card = (i: AttentionItem) => (
    <RequestCard
      key={i.id}
      item={i}
      request={request}
      onStream={(id) => onStream(id)}
      onWork={onWork}
      onRefresh={reload}
    />
  );
  if (streamId) {
    if (!detail || detail.stream.id !== streamId)
      return <p role="status">{error || 'Loading stream…'}</p>;
    const s = detail.stream;
    return (
      <section className="oversight-detail" aria-label="Stream detail">
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        <button className="text-button" onClick={() => onStream(null)}>
          <ArrowLeft size={14} />
          All streams
        </button>
        <nav className="breadcrumbs" aria-label="Stream ancestry">
          {[...detail.ancestors].reverse().map((p) => (
            <button key={p.id} className="text-button" onClick={() => onStream(p.id)}>
              {p.title}
              <ChevronRight size={12} />
            </button>
          ))}
        </nav>
        <div className="stream-title">
          <h2>{s.title}</h2>
          <StatusBadge state={s.state}>
            {s.state === 'proposed' ? 'Needs decision' : s.state}
          </StatusBadge>
        </div>
        <WorkContent text={s.outcome} />
        <p className="muted">
          {detail.summary.delivered} of {detail.summary.changes} changes delivered across this
          stream
        </p>
        {s.constraints && (
          <details>
            <summary>Scope & constraints</summary>
            <WorkContent text={s.constraints} />
          </details>
        )}
        {s.coverage && (
          <p className="muted">
            Routine work covered by{' '}
            {detail.ancestors.find((p) => p.id === s.coverage!.streamId)?.title ?? s.title} · scope{' '}
            {s.coverage.scopeRevision}
          </p>
        )}
        <div className="button-row">
          {s.state === 'proposed' && (
            <>
              <button className="primary" disabled={busy} onClick={() => void action('accept')}>
                Approve direction & routine work
              </button>
              <button className="secondary" disabled={busy} onClick={() => void action('decline')}>
                Decline
              </button>
            </>
          )}
          {s.state === 'active' && !s.approvalId && !s.coverage && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void action('enable_coverage')}
            >
              Enable routine work coverage
            </button>
          )}
          {['active', 'paused'].includes(s.state) && (
            <>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void action(s.state === 'active' ? 'pause' : 'resume')}
              >
                {s.state === 'active' ? 'Pause' : 'Resume'}
              </button>
              <button
                className={s.reviewRequested === 1 ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => void action('close')}
              >
                Accept outcome & close
              </button>
            </>
          )}
          {['closed', 'declined'].includes(s.state) && (
            <button className="secondary" disabled={busy} onClick={() => void action('reopen')}>
              Reopen stream
            </button>
          )}
          {s.reviewRequested === 1 && (
            <button className="secondary" disabled={busy} onClick={() => void action('keep_open')}>
              Reviewed · keep open
            </button>
          )}
        </div>
        {s.pendingScope && (
          <section className="oversight-section scope-decision">
            <h3>Proposed scope</h3>
            <h4>{s.pendingScope.title}</h4>
            <WorkContent text={s.pendingScope.outcome} />
            <WorkContent text={s.pendingScope.constraints} />
            <div className="button-row">
              <button
                className="primary"
                disabled={busy}
                onClick={() => void action('accept_scope')}
              >
                Approve scope
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void action('reject_scope')}
              >
                Keep current scope
              </button>
            </div>
          </section>
        )}
        {(s.progressSummary || s.phase || s.outcomeAvailableAt) && (
          <section className="progress-report">
            {s.phase && <span className="eyebrow">{s.phase}</span>}
            {s.progressSummary && <WorkContent text={s.progressSummary} />}
            {s.outcomeAvailableAt && <p>Outcome reported available</p>}
            {s.reportedAt && <small>Reported {when(s.reportedAt)}</small>}
          </section>
        )}
        {detail.sync.items.length > 0 && (
          <details className="sync-summary">
            <summary>
              {detail.sync.items.some((item) => item.state === 'needs_update')
                ? 'Chat update pending'
                : `Progress recorded ${when(detail.sync.items[0].lastCheckpointAt!)}`}
            </summary>
            {detail.sync.items.map((session) => (
              <div key={session.id} className="fine">
                <strong>{session.client === 'codex' ? 'Codex' : 'Claude Code'}</strong>
                {' · '}
                {session.lastCheckpointAt
                  ? `Checkpoint ${when(session.lastCheckpointAt)}`
                  : 'No checkpoint yet'}
                {session.needsCheckpoint ? ' · Latest turn not recorded' : ''}
                {session.pendingWrites ? ` · ${session.pendingWrites} pending at last check` : ''}
                {session.summary && <p>{session.summary}</p>}
              </div>
            ))}
          </details>
        )}
        {s.dependencies.length > 0 && (
          <section className="oversight-section">
            <h3>Prerequisites</h3>
            {s.dependencies.map((d) => (
              <div key={d.source.id + d.stage} className="prerequisite-row">
                <span>
                  {d.satisfied ? '✓' : 'Waiting'} ·{' '}
                  {d.stage === 'start' ? 'To start' : 'To deliver'}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    d.source.kind === 'stream'
                      ? onStream(d.source.id)
                      : d.source.kind === 'change'
                        ? onWork(d.source.id)
                        : document.getElementById('stream-requests')?.scrollIntoView({
                            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                              ? 'auto'
                              : 'smooth',
                          })
                  }
                >
                  {d.title}
                </button>
                <p>
                  {d.reason} · {d.condition.replaceAll('_', ' ')}
                  {d.satisfied ? ` (${d.evidence})` : ''}
                </p>
              </div>
            ))}
            <small>Dependency assessment: {s.assessmentState}</small>
          </section>
        )}
        <section className="oversight-section" id="stream-requests">
          <h3>Needs you {attention?.total ? `· ${attention.total}` : ''}</h3>
          {attention?.items.filter((i) => !['stream_approval', 'scope'].includes(i.kind)).map(card)}
          {attention?.total === 0 && <p className="muted">Nothing waiting on you.</p>}
          {attention && attention.total > attention.items.length && (
            <button
              className="secondary"
              onClick={() => {
                onStream(null);
              }}
            >
              See all requests
            </button>
          )}
        </section>
        <section className="oversight-section">
          <h3>
            Feeding streams <span className="muted">{detail.children.total}</span>
          </h3>
          {detail.children.items.map((child) => (
            <button className="feeding-row" key={child.id} onClick={() => onStream(child.id)}>
              <div>
                <strong>{child.title}</strong>
                <p>{child.phase || child.progressSummary || child.outcome}</p>
              </div>
              <span>
                <StatusBadge
                  state={child.dependencies.some((d) => !d.satisfied) ? 'blocked' : child.state}
                  label={
                    child.dependencies.some((d) => !d.satisfied)
                      ? 'Waiting on a prerequisite'
                      : child.state
                  }
                />
                <ChevronRight size={14} />
              </span>
            </button>
          ))}
          {!detail.children.total && <p className="muted">No feeding streams.</p>}
        </section>
        {detail.outputs.items.length > 0 && (
          <section className="oversight-section">
            <h3>Outputs</h3>
            {(detail.outputs.items as (Output & { streamId: string })[]).map((o) => (
              <div key={o.id} className="output-row">
                <a href={o.url} target="_blank" rel="noreferrer">
                  {o.label}
                  <ArrowUpRight size={13} />
                </a>
                <small>
                  {o.state} · reported by {o.actorName}
                  {o.codeRevision ? ` · ${o.codeRevision}` : ''}
                </small>
              </div>
            ))}
          </section>
        )}
        <section className="oversight-section">
          <button
            className="section-toggle"
            aria-expanded={showChanges}
            onClick={() => setShowChanges((x) => !x)}
          >
            <h3>
              Direct changes <span className="muted">{detail.changes.total}</span>
            </h3>
            <ChevronRight className={showChanges ? 'rotated' : ''} size={16} />
          </button>
          {showChanges && (
            <>
              {s.coverage &&
                (detail.changes.items.some(
                  (w) =>
                    w.assignment?.state === 'proposed' ||
                    (w.assignment?.state === 'covered' && !w.tracking.coverage),
                ) ||
                  detail.children.items.some(
                    (c) => c.state === 'proposed' || (c.coverageApprovalId && !c.coverage),
                  )) && (
                  <>
                    <p className="muted">
                      Include the following visible proposals and outdated coverage in this approved
                      scope. This is an owner decision.
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void coverExisting()}
                    >
                      Cover visible proposals
                    </button>
                  </>
                )}
              {detail.changes.items.map((w) => (
                <button key={w.id} className="change-row" onClick={() => onWork(w.id)}>
                  <strong>{w.title}</strong>
                  <span>
                    {w.tracking.progress === 'delivered'
                      ? 'Delivered · reported'
                      : w.tracking.progress}{' '}
                    · {w.assignment?.state === 'covered' ? 'Stream coverage' : w.assignment?.state}
                    <ChevronRight size={13} />
                  </span>
                </button>
              ))}
            </>
          )}
        </section>
        <details className="oversight-section">
          <summary>Context & history</summary>
          {s.context && <WorkContent text={s.context} />}
          {detail.entries.items.map((e) => (
            <article className="context-entry" key={e.id}>
              <small>
                {e.kind} · {e.actorName} · {e.state}
              </small>
              <WorkContent text={e.body} />
              {e.answer && (
                <p>
                  <strong>{e.answerSource ? 'Answer reported from chat:' : 'Answer:'}</strong>{' '}
                  {e.answer}
                </p>
              )}
            </article>
          ))}
          {detail.actions.items
            .filter((a) => ['done', 'cancelled'].includes(a.state))
            .map((h) => (
              <ResolvedAction key={h.id} action={h} request={request} refresh={reload} />
            ))}
          <StreamHistory id={s.id} request={request} />
        </details>
        <Pager
          offset={detailOffset}
          total={Math.max(
            detail.changes.total,
            detail.children.total,
            detail.entries.total,
            detail.actions.total,
            detail.outputs.total,
          )}
          onChange={setDetailOffset}
        />
      </section>
    );
  }
  return (
    <div className="oversight-view">
      {error && (
        <p role="alert" className="error-banner">
          {error}
          <button className="secondary" onClick={reload}>
            Retry
          </button>
        </p>
      )}
      {view === 'needs' ? (
        <>
          <p className="list-count">{attention?.total ?? 0} requests</p>
          <section className="attention-list" aria-label="Requests">
            {attention?.items.map(card)}
            {attention?.total === 0 && (
              <div className="empty-state">
                <h2>Nothing waiting on you</h2>
              </div>
            )}
          </section>
          <Pager offset={offset} total={attention?.total ?? 0} onChange={setOffset} />
        </>
      ) : (
        <>
          <div className="oversight-toolbar">
            <div className="tabs" role="group" aria-label="Stream views">
              <button
                className={!history ? 'active' : ''}
                onClick={() => {
                  setHistory(false);
                  setOffset(0);
                }}
              >
                Active
              </button>
              <button
                className={history ? 'active' : ''}
                onClick={() => {
                  setHistory(true);
                  setOffset(0);
                }}
              >
                History
              </button>
            </div>
            <button className="text-button" onClick={onUngrouped}>
              Browse changes{overview?.ungrouped ? ` · ${overview.ungrouped} ungrouped` : ''}
            </button>
          </div>
          <section className="outcome-list" aria-label="Streams">
            {overview?.items.map((s) => (
              <button key={s.id} className="outcome-card" onClick={() => onStream(s.id)}>
                <div className="card-heading">
                  <h2>{s.title}</h2>
                  <ChevronRight size={18} />
                </div>
                <p className="outcome-text">{s.outcome}</p>
                {s.progressSummary ? (
                  <p>{s.progressSummary}</p>
                ) : (
                  <p className="muted">No progress report yet</p>
                )}
                <div className="outcome-facts">
                  {(s.phase || s.state !== 'active' || !s.summary.working) && (
                    <StatusBadge state={s.state} label={s.phase || s.state} />
                  )}
                  {s.needsYou > 0 && (
                    <StatusBadge state="needs_decision">
                      <Hand size={12} aria-hidden="true" />
                      {s.needsYou} need you
                    </StatusBadge>
                  )}
                  {s.summary.working > 0 && (
                    <StatusBadge state="working">
                      <span className="status-dot" aria-hidden="true" />
                      {s.summary.working} {s.summary.working === 1 ? 'change' : 'changes'} moving
                    </StatusBadge>
                  )}
                  {s.summary.blocked + s.summary.waitingStreams > 0 && (
                    <StatusBadge state="blocked">
                      {s.summary.blocked} changes · {s.summary.waitingStreams} streams waiting
                    </StatusBadge>
                  )}
                  <span className="inventory-count">
                    {s.summary.delivered} of {s.summary.changes} changes delivered
                  </span>
                  {s.childrenCount > 0 && <span>{s.childrenCount} feeding streams</span>}
                </div>
                {s.reportedAt && (
                  <small>
                    Reported by {s.reporterName} · {when(s.reportedAt)}
                  </small>
                )}
              </button>
            ))}
            {overview?.total === 0 && (
              <div className="empty-state">
                <h2>{history ? 'No past streams' : 'No streams yet'}</h2>
                <p>Streams arrive through connected agents.</p>
              </div>
            )}
          </section>
          <Pager offset={offset} total={overview?.total ?? 0} onChange={setOffset} />
        </>
      )}
    </div>
  );
}
function ResolvedAction({
  action,
  request,
  refresh,
}: {
  action: HumanAction;
  request: Request;
  refresh: () => void;
}) {
  const [response, setResponse] = useState(''),
    [error, setError] = useState('');
  return (
    <article className="context-entry">
      <small>{action.state}</small>
      <h4>{action.title}</h4>
      <p>{action.response}</p>
      {action.responseSource && <small>Response reported from chat</small>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await request(`/human-actions/${action.id}/respond`, {
              revision: action.revision,
              state: 'open',
              response,
              idempotencyKey: crypto.randomUUID(),
            });
            refresh();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          Reopen with a reason
          <input value={response} required onChange={(e) => setResponse(e.target.value)} />
        </label>
        <button className="secondary">Reopen request</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
function StreamHistory({ id, request }: { id: string; request: Request }) {
  const [events, setEvents] = useState<{
      items: { id: string; message: string; actorName: string; createdAt: number }[];
      total: number;
    } | null>(null),
    [offset, setOffset] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    request<NonNullable<typeof events>>(`/streams/${id}/events?offset=${offset}`)
      .then((r) => {
        if (!cancelled) setEvents(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, request, offset]);
  return (
    <>
      <h4>Activity</h4>
      {error && <p role="alert">{error}</p>}
      {events?.items.map((e) => (
        <div key={e.id} className="context-entry">
          <p>{e.message}</p>
          <small>
            {e.actorName} · {when(e.createdAt)}
          </small>
        </div>
      ))}
      <Pager offset={offset} total={events?.total ?? 0} onChange={setOffset} />
    </>
  );
}
