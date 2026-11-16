import { RequestInstructions } from './RequestInstructions.js';
import { DependencyAssessmentView } from './DependencyAssessment.js';
import { StreamWorkMap } from './WorkMap.js';
import type { WorkMap } from '../../src/shared/work-map.js';
import { conversationLink } from '../../src/shared/conversation.js';
import { StatusBadge } from './UI.js';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  ArrowUpRight,
  Hand,
  MessageCircle,
  ArrowRight,
} from 'lucide-react';
import type { Stream, ContextEntry, Output } from '../../src/shared/streams.js';
import type { AttentionItem, HumanAction } from '../../src/shared/oversight.js';
import type { OversightService } from '../../src/services/oversight.js';
import { WorkContent, BriefContent, briefText } from './WorkContent.js';
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
  onStream,
  onWork,
}: {
  item: AttentionItem;
  onStream: (id: string) => void;
  onWork: (id: string) => void;
}) {
  const chat = conversationLink(item.conversationUrl);
  return (
    <article className="request-card" data-kind={item.kind}>
      <div className="request-heading">
        <span className="eyebrow">
          {item.kind === 'action' ? (
            <Hand size={14} aria-hidden="true" />
          ) : (
            <MessageCircle size={14} aria-hidden="true" />
          )}
          {item.kind === 'action' ? 'Action' : 'Question'}
        </span>
        {item.streamId && (
          <button className="text-button" onClick={() => onStream(item.streamId!)}>
            {item.streamTitle} <ChevronRight size={13} />
          </button>
        )}
      </div>
      <h3>{briefText(item.title, 180)}</h3>
      {item.title.length > 180 && (
        <details>
          <summary>More</summary>
          <WorkContent text={item.title} />
        </details>
      )}
      <RequestInstructions
        guidance={item.guidance}
        background={item.body !== item.title ? item.body : ''}
        doneWhen={item.doneWhen}
      />
      {item.direct.length > 0 && (
        <div className="unlock-list">
          <span>
            <ArrowRight size={13} aria-hidden="true" /> Unlocks
          </span>
          <button
            className="text-button"
            onClick={() =>
              item.direct[0].kind === 'change'
                ? onWork(item.direct[0].id)
                : onStream(item.direct[0].id)
            }
          >
            {item.direct[0].title} <ChevronRight size={12} />
          </button>
          {item.direct.length > 1 && <span className="muted">+{item.direct.length - 1}</span>}
        </div>
      )}
      {chat && (
        <a className="text-button chat-link" href={chat} target="_blank" rel="noopener noreferrer">
          Open chat <ArrowUpRight size={13} aria-hidden="true" />
        </a>
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
    [map, setMap] = useState<WorkMap | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [offset, setOffset] = useState(0),
    [detailOffset, setDetailOffset] = useState(0),
    [history, setHistory] = useState(false);
  const reload = () => {
    setRefresh((n) => n + 1);
    onRefresh();
  };
  useEffect(() => {
    setOffset(0);
    setDetailOffset(0);
    setError('');
  }, [view, streamId]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [o, t, d, m, e] = await Promise.all([
          !streamId && view === 'streams'
            ? request<Overview>(
                `/oversight/streams?view=${history ? 'history' : 'active'}&offset=${offset}`,
              )
            : Promise.resolve(null),
          request<{ items: AttentionItem[]; total: number }>(
            `/attention?offset=${streamId ? 0 : offset}${streamId ? `&streamId=${streamId}` : ''}`,
          ),
          streamId ? request<StreamDetail>(`/streams/${streamId}/overview`) : Promise.resolve(null),
          streamId ? request<WorkMap>(`/streams/${streamId}/map`) : Promise.resolve(null),
          streamId
            ? request<StreamDetail['entries']>(
                `/streams/${streamId}/context?offset=${detailOffset}`,
              )
            : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setOverview(o);
          setAttention(t);
          setDetail(d && e ? { ...d, entries: e } : d);
          setMap(m);
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
  const card = (i: AttentionItem) => (
    <RequestCard key={i.id} item={i} onStream={(id) => onStream(id)} onWork={onWork} />
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
          <StatusBadge state={s.state}>{s.state === 'proposed' ? 'Planned' : s.state}</StatusBadge>
        </div>
        {map && map.rootId === s.id ? (
          <StreamWorkMap
            key={s.id}
            data={map}
            onWork={onWork}
            onStream={onStream}
            onBrowse={onUngrouped}
            loadRequest={request}
            request={request}
          />
        ) : (
          <p role="status">Loading work…</p>
        )}
        {attention?.items.some((i) => !map?.nodes.some((n) => n.id === i.entityId)) && (
          <section className="oversight-section" id="stream-requests">
            <h3>Needs you {attention?.total ? `· ${attention.total}` : ''}</h3>
            {attention?.items.filter((i) => !map?.nodes.some((n) => n.id === i.entityId)).map(card)}
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
        )}
        <details className="oversight-section">
          <summary>Details & history</summary>
          <BriefContent text={s.outcome} />
          {s.constraints && (
            <details>
              <summary>Scope</summary>
              <WorkContent text={s.constraints} />
            </details>
          )}
          <details className="stream-management">
            <summary>Manage stream</summary>
            <div className="button-row">
              {['active', 'proposed', 'paused'].includes(s.state) && (
                <>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action(s.state === 'paused' ? 'resume' : 'pause')}
                  >
                    {s.state === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action('close')}
                  >
                    Finish stream
                  </button>
                </>
              )}
              {['closed', 'declined'].includes(s.state) && (
                <button className="secondary" disabled={busy} onClick={() => void action('reopen')}>
                  Reopen stream
                </button>
              )}
            </div>
          </details>

          {s.progressSummary && <BriefContent text={s.progressSummary} />}

          {detail.outputs.items.length > 0 && (
            <section className="oversight-section">
              <h3>Outputs</h3>
              {(detail.outputs.items as (Output & { streamId: string })[]).map((o) => (
                <div key={o.id} className="output-row">
                  <a href={o.url} target="_blank" rel="noreferrer">
                    {o.label}
                    <ArrowUpRight size={13} />
                  </a>
                  <details className="output-evidence">
                    <summary>Evidence</summary>
                    <small>
                      {o.state} · reported by {o.actorName}
                      {o.codeRevision ? ` · ${o.codeRevision}` : ''}
                    </small>
                  </details>
                </div>
              ))}
            </section>
          )}
          {s.pendingScope && (
            <details>
              <summary>Earlier scope proposal</summary>
              <WorkContent text={s.pendingScope.outcome} />
            </details>
          )}
          {s.coverage && (
            <p className="muted">
              Routine work covered by{' '}
              {detail.ancestors.find((p) => p.id === s.coverage!.streamId)?.title ?? s.title} ·
              scope {s.coverage.scopeRevision}
            </p>
          )}
          <DependencyAssessmentView assessment={s.dependencyAssessment} />

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
          <Pager offset={detailOffset} total={detail.entries.total} onChange={setDetailOffset} />
          <StreamHistory id={s.id} request={request} />
        </details>
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
                <p className="outcome-text">{briefText(s.progressSummary || s.outcome, 180)}</p>
                <div className="outcome-facts">
                  {(s.phase || s.state !== 'active') && (
                    <StatusBadge state={s.state} label={briefText(s.phase || s.state, 40)} />
                  )}
                  {s.needsYou > 0 && (
                    <StatusBadge state="needs_decision">
                      <Hand size={12} aria-hidden="true" />
                      {s.needsYou} {s.needsYou === 1 ? 'needs' : 'need'} you
                    </StatusBadge>
                  )}
                  {s.summary.working > 0 && (
                    <StatusBadge state="working">
                      <span className="status-dot" aria-hidden="true" />
                      In progress
                    </StatusBadge>
                  )}
                  {s.summary.blocked + s.summary.waitingStreams > 0 && (
                    <StatusBadge state="blocked">
                      {s.summary.working > 0 ? 'Partly blocked' : 'Waiting'}
                    </StatusBadge>
                  )}
                  {s.summary.delivered > 0 && (
                    <span className="inventory-count">{s.summary.delivered} delivered</span>
                  )}
                  {s.childrenCount > 0 && <span>{s.childrenCount} feeding streams</span>}
                </div>
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
