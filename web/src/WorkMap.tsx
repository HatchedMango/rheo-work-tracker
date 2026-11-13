import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, Hand, Layers, MessageCircle } from 'lucide-react';
import {
  orderMapNodes,
  type MapNode,
  type WorkMap as MapData,
  type MapEdge,
} from '../../src/shared/work-map.js';
import { conversationLink } from '../../src/shared/conversation.js';
import { BriefContent } from './WorkContent.js';
import { StatusBadge } from './UI.js';
const remembered = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
};
const conditionLabel: Record<MapEdge['condition'], string> = {
  done: 'Action done',
  output_available: 'Output available',
  integrated: 'Output integrated',
  outcome_available: 'Outcome available',
  outcome_accepted: 'Outcome finished',
};
export function StreamWorkMap({
  data,
  onWork,
  onStream,
  onBrowse,
  loadRequest,
}: {
  data: MapData;
  onWork: (id: string) => void;
  onStream: (id: string) => void;
  onBrowse: () => void;
  loadRequest: (path: string) => Promise<{
    body?: string;
    description?: string;
    doneWhen?: string;
    answer?: string | null;
    response?: string;
  }>;
}) {
  const ordered = orderMapNodes(data.nodes, data.edges),
    byId = new Map(data.nodes.map((n) => [n.id, n]));
  const fallback =
    ordered.nodes.find((n) => n.tone === 'attention' && !n.quiet && !n.reference) ??
    ordered.nodes.find((n) => n.tone === 'active' && !n.quiet && !n.reference) ??
    ordered.nodes.find((n) => n.kind !== 'stream' && !n.quiet && !n.reference) ??
    ordered.nodes.find((n) => n.kind !== 'stream') ??
    data.nodes[0];
  const [selectedId, setSelectedId] = useState(
    () => remembered('work-map-selection:' + data.rootId) ?? fallback?.id,
  );
  const selected = byId.get(selectedId ?? '') ?? fallback;
  const [fullRequest, setFullRequest] = useState<{
    id: string;
    body?: string;
    description?: string;
    doneWhen?: string;
    answer?: string | null;
    response?: string;
  } | null>(null);
  const [requestError, setRequestError] = useState('');
  useEffect(() => {
    setFullRequest(null);
    setRequestError('');
    if (!selected || !['human_action', 'question'].includes(selected.kind)) return;
    let cancelled = false;
    loadRequest(
      selected.kind === 'question' ? `/context/${selected.id}` : `/human-actions/${selected.id}`,
    )
      .then((r) => {
        if (!cancelled) setFullRequest({ ...r, id: selected.id });
      })
      .catch(() => {
        if (!cancelled) setRequestError('Could not load the full request.');
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.status, loadRequest]);

  const [preferred, setPreferred] = useState(
    remembered('work-map-view') === 'list' ? 'list' : 'map',
  );
  const [width, setWidth] = useState(1000),
    [paths, setPaths] = useState<{ edge: MapEdge; d: string }[]>([]);
  const container = useRef<HTMLElement>(null),
    graph = useRef<HTMLDivElement>(null);
  const mode = width < 620 ? 'list' : preferred;
  const marker = 'map-arrow-' + data.rootId;
  function select(id: string) {
    setSelectedId(id);
    remember('work-map-selection:' + data.rootId, id);
    if (matchMedia('(max-width: 900px)').matches)
      requestAnimationFrame(() =>
        container.current?.querySelector('.work-map-inspector')?.scrollIntoView({
          block: 'start',
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        }),
      );
  }
  function changeMode(mode: string) {
    setPreferred(mode);
    remember('work-map-view', mode);
  }
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    setWidth(el.getBoundingClientRect().width);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = graph.current;
    if (!el || mode !== 'map') {
      setPaths([]);
      return;
    }
    const draw = () => {
      const bounds = el.getBoundingClientRect();
      const positions = new Map(
        Array.from(el.querySelectorAll<HTMLElement>('[data-map-node]')).map((n) => [
          n.dataset.mapNode!,
          n.getBoundingClientRect(),
        ]),
      );
      setPaths(
        data.edges
          .filter(
            (e) =>
              data.edges.length <= 40 || e.sourceId === selected?.id || e.targetId === selected?.id,
          )
          .flatMap((edge) => {
            const a = positions.get(edge.sourceId),
              b = positions.get(edge.targetId);
            if (!a || !b) return [];
            const ax = a.left + a.width / 2,
              ay = a.top + a.height / 2,
              bx = b.left + b.width / 2,
              by = b.top + b.height / 2;
            let d: string;
            const sameRow = Math.abs(ay - by) < Math.min(a.height, b.height) / 2;
            const obstruction = [...positions.entries()].some(
              ([id, r]) =>
                id !== edge.sourceId &&
                id !== edge.targetId &&
                r.left < Math.max(ax, bx) &&
                r.right > Math.min(ax, bx) &&
                r.top < Math.max(ay, by) + 1 &&
                r.bottom > Math.min(ay, by) - 1,
            );
            if (
              sameRow &&
              !obstruction &&
              byId.get(edge.sourceId)?.groupId === byId.get(edge.targetId)?.groupId
            ) {
              const forward = bx > ax,
                x1 = (forward ? a.right : a.left) - bounds.left,
                x2 = (forward ? b.left : b.right) - bounds.left,
                y1 = ay - bounds.top,
                y2 = by - bounds.top;
              const bend = Math.max(12, Math.abs(x2 - x1) / 2);
              d = `M ${x1} ${y1} C ${x1 + (forward ? bend : -bend)} ${y1}, ${x2 + (forward ? -bend : bend)} ${y2}, ${x2} ${y2}`;
            } else {
              // Use row gaps and an outside rail. A direct curve through an
              // unrelated card would falsely imply that it is on this path.
              const down = by > ay,
                x1 = ax - bounds.left,
                x2 = bx - bounds.left,
                y1 = (down ? a.bottom : a.top) - bounds.top,
                y2 = (sameRow || down ? b.top : b.bottom) - bounds.top,
                outside1 = y1 + (down ? 8 : -8),
                outside2 = y2 + (sameRow || down ? -8 : 8);
              d = sameRow
                ? `M ${x1} ${y1} V ${outside1} H ${x2} V ${y2}`
                : `M ${x1} ${y1} V ${outside1} H 7 V ${outside2} H ${x2} V ${y2}`;
            }
            return [{ edge, d }];
          }),
      );
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    el.querySelectorAll('[data-map-node]').forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [data, mode, selected?.id]);
  const groups = [
    ...data.groups,
    ...(data.nodes.some((n) => n.reference)
      ? [{ id: 'linked', parentId: null, title: 'Linked work', depth: 0 }]
      : []),
  ];
  const incoming = data.edges.filter((e) => e.targetId === selected?.id),
    outgoing = data.edges.filter((e) => e.sourceId === selected?.id);
  function badge(n: MapNode) {
    return (
      <StatusBadge
        state={
          n.tone === 'active'
            ? 'working'
            : n.tone === 'attention'
              ? 'needs_decision'
              : n.tone === 'waiting'
                ? 'blocked'
                : n.tone === 'quiet'
                  ? 'quiet'
                  : 'planned'
        }
        label={n.status}
      />
    );
  }
  function nodeButton(n: MapNode) {
    const unmet = data.edges.filter((e) => e.targetId === n.id && !e.satisfied);
    return (
      <button
        key={n.id}
        type="button"
        className={`work-map-node${n.quiet ? ' is-quiet' : ''}`}
        data-map-node={n.id}
        data-kind={n.kind}
        aria-pressed={n.id === selected?.id}
        onClick={() => select(n.id)}
      >
        <span className="work-map-node-meta">
          {n.kind === 'human_action' && <Hand size={13} aria-hidden="true" />}
          {n.kind === 'question' && <MessageCircle size={13} aria-hidden="true" />}
          {n.kind === 'stream' && <Layers size={13} aria-hidden="true" />}
          {badge(n)}
          {n.reference && <small>Linked</small>}
        </span>
        <strong>{n.title}</strong>
        {n.status === 'In progress' && unmet.length > 0 && (
          <span className="work-map-blocker">
            {unmet.some((e) => e.stage === 'start')
              ? 'Start prerequisite unmet'
              : 'Waiting to deliver'}
          </span>
        )}
      </button>
    );
  }
  return (
    <section className="stream-work" aria-label="Stream work" ref={container}>
      <div className="stream-work-toolbar">
        <h3>Work</h3>
        <div className="tabs" role="group" aria-label="Work presentation">
          <button
            type="button"
            className={mode === 'map' ? 'active' : ''}
            aria-pressed={mode === 'map'}
            disabled={width < 620}
            title={width < 620 ? 'Map is available in a wider window' : undefined}
            onClick={() => changeMode('map')}
          >
            Map
          </button>
          <button
            type="button"
            className={mode === 'list' ? 'active' : ''}
            aria-pressed={mode === 'list'}
            onClick={() => changeMode('list')}
          >
            List
          </button>
        </div>
      </div>
      {!data.complete && (
        <p className="map-incomplete" role="status">
          This view contains part of the work. Open a feeding stream to focus it, or{' '}
          <button className="text-button" onClick={onBrowse}>
            browse all changes
          </button>
          .
        </p>
      )}
      <div className="work-map-caption">
        {data.edges.length ? (
          <>
            <span>{mode === 'map' ? 'Arrows' : 'Links'} show prerequisites</span>
            {mode === 'map' && (
              <span>
                Solid: start · Dashed: delivery
                {data.edges.length > 40 ? ' · Selected links shown' : ''}
              </span>
            )}
          </>
        ) : (
          <span>No prerequisite links recorded{data.complete ? '' : ' in this view'}</span>
        )}
        {ordered.stagedLoop && <span>Some relationships apply at different stages.</span>}
      </div>
      <div className={`work-map-layout mode-${mode}`}>
        <div className="work-map-groups" ref={graph}>
          {mode === 'map' && (
            <svg className="work-map-edges" aria-hidden="true">
              <defs>
                {['selected', 'waiting', 'quiet'].map((tone) => (
                  <marker
                    key={tone}
                    id={marker + '-' + tone}
                    viewBox="0 0 8 8"
                    refX="8"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M0 0 L8 4 L0 8 Z" className={'map-arrow-' + tone} />
                  </marker>
                ))}
              </defs>
              {paths.map(({ edge, d }) => {
                const related = edge.sourceId === selected?.id || edge.targetId === selected?.id;
                const tone = related ? 'selected' : !edge.satisfied ? 'waiting' : 'quiet';
                return (
                  <path
                    key={edge.sourceId + edge.targetId + edge.stage}
                    d={d}
                    fill="none"
                    className={`work-map-edge ${tone}`}
                    strokeDasharray={edge.stage === 'deliver' ? '5 4' : undefined}
                    markerEnd={`url(#${marker}-${tone})`}
                  />
                );
              })}
            </svg>
          )}
          {groups.map((group) => {
            const header = byId.get(group.id),
              members = ordered.nodes.filter(
                (n) =>
                  (n.kind !== 'stream' && n.groupId === group.id) ||
                  (n.reference && n.kind === 'stream' && n.groupId === group.id),
              );
            const active = members.filter((n) => !n.quiet),
              quiet = members.filter((n) => n.quiet);
            const parent = data.groups.find((g) => g.id === group.parentId);
            return (
              <section
                key={group.id}
                className="work-map-group"
                aria-label={group.id === data.rootId ? 'Work in this stream' : group.title}
              >
                <div className="work-map-group-heading">
                  {header ? (
                    <button
                      className="text-button"
                      data-map-node={header.id}
                      aria-pressed={header.id === selected?.id}
                      onClick={() => select(header.id)}
                    >
                      <Layers size={14} aria-hidden="true" />
                      {group.id === data.rootId ? 'This stream' : group.title}
                      {group.id !== data.rootId && <ChevronRight size={13} aria-hidden="true" />}
                    </button>
                  ) : (
                    <h4>{group.title}</h4>
                  )}
                  {parent && parent.id !== data.rootId && (
                    <span className="map-parent">Within {parent.title}</span>
                  )}
                </div>
                {active.length > 0 && (
                  <div className="work-map-nodes">{active.map(nodeButton)}</div>
                )}
                {quiet.length > 0 && (
                  <div className="work-map-delivered">
                    <span className="fine">Earlier work · {quiet.length}</span>
                    <div className="work-map-nodes">{quiet.map(nodeButton)}</div>
                  </div>
                )}
                {!members.length && header && <p className="fine">{header.purpose}</p>}
              </section>
            );
          })}
        </div>
        {selected && (
          <aside className="work-map-inspector" aria-label="Selected work" aria-live="polite">
            <div className="map-inspector-title">
              {badge(selected)}
              {selected.reference && <span className="fine">Linked reference</span>}
            </div>
            <h3>{selected.title}</h3>
            <BriefContent
              text={
                fullRequest?.id === selected.id
                  ? fullRequest.body || fullRequest.description || selected.purpose
                  : selected.purpose
              }
              limit={260}
            />
            {fullRequest?.id === selected.id && fullRequest.description && fullRequest.doneWhen && (
              <p className="fine">Needed: {fullRequest.doneWhen}</p>
            )}
            {requestError && (
              <p role="alert" className="error">
                {requestError}
              </p>
            )}
            {selected.update && selected.update !== selected.purpose && (
              <div className="map-selected-update">
                <BriefContent
                  text={
                    fullRequest?.id === selected.id
                      ? fullRequest.answer || fullRequest.response || selected.update
                      : selected.update
                  }
                  limit={220}
                />
              </div>
            )}
            {!['human_action', 'question'].includes(selected.kind) &&
              !selected.quiet &&
              selected.assessment !== 'current' && (
                <p className="map-uncertainty">
                  {selected.assessment === 'stale'
                    ? 'Relationships need checking against newer work.'
                    : incoming.length
                      ? 'Recorded links have not been checked for completeness.'
                      : 'Prerequisites have not been assessed.'}
                </p>
              )}
            {incoming.length > 0 ? (
              <div className="map-relation-list">
                <h4>Needs</h4>
                {incoming.map((edge) => (
                  <div className="map-relation" key={edge.sourceId + edge.stage}>
                    <button className="text-button" onClick={() => select(edge.sourceId)}>
                      {byId.get(edge.sourceId)!.title}
                    </button>
                    <small>
                      {edge.stage === 'start' ? 'Before starting' : 'Before delivering'} ·{' '}
                      {conditionLabel[edge.condition]} ·{' '}
                      {edge.satisfied ? 'Recorded satisfied' : 'Waiting'}
                    </small>
                    {edge.reason && <BriefContent text={edge.reason} limit={150} />}
                  </div>
                ))}
              </div>
            ) : (
              !['human_action', 'question'].includes(selected.kind) &&
              selected.assessment === 'current' && (
                <p className="fine">
                  {selected.prerequisiteCount
                    ? 'Prerequisites are outside this view.'
                    : 'No prerequisites were identified.'}
                </p>
              )
            )}
            {outgoing.length > 0 && (
              <div className="map-relation-list">
                <h4>Feeds into</h4>
                {outgoing.map((edge) => (
                  <button
                    key={edge.targetId + edge.stage}
                    className="text-button"
                    onClick={() => select(edge.targetId)}
                  >
                    {byId.get(edge.targetId)!.title}
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
            {selected.outputs.length > 0 && (
              <div className="map-relation-list">
                <h4>Outputs</h4>
                {selected.outputs.map((o) => (
                  <a key={o.url} href={o.url} target="_blank" rel="noopener noreferrer">
                    {o.label}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                ))}
              </div>
            )}
            <div className="map-open-actions">
              {selected.kind === 'change' && (
                <button className="secondary" onClick={() => onWork(selected.id)}>
                  Open change <ChevronRight size={13} />
                </button>
              )}
              {selected.kind === 'stream' && selected.id !== data.rootId && (
                <button className="secondary" onClick={() => onStream(selected.id)}>
                  Open stream <ChevronRight size={13} />
                </button>
              )}
              {['human_action', 'question'].includes(selected.kind) &&
                conversationLink(selected.conversationUrl) && (
                  <a
                    className="text-button"
                    href={conversationLink(selected.conversationUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open chat <ArrowUpRight size={13} />
                  </a>
                )}
            </div>
            {!data.complete && (
              <p className="fine">Some related work or links may be outside this view.</p>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
