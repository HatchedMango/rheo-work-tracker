import type { Store } from '../db/index.js';
import type { Node, FlowEdge } from '../shared/oversight.js';
import { hash } from './auth.js';
import { ensure } from './errors.js';
import { lineage } from './coverage.js';
export function assertNode(store: Store, node: Node) {
  const row = store.raw.prepare('SELECT kind FROM oversight_nodes WHERE id=?').get(node.id) as
    { kind: string } | undefined;
  ensure(row && row.kind === node.kind, 404, 'Referenced work, stream or human action not found.');
  return row;
}
export function flowDependencies(store: Store, id: string): FlowEdge[] {
  const rows = store.raw
    .prepare(
      `SELECT d.sourceId id,n.kind,d.stage,d.condition,d.reason,coalesce(w.title,s.title,a.title) title,
 CASE d.condition WHEN 'done' THEN a.state='done' WHEN 'outcome_available' THEN s.outcomeAvailableAt IS NOT NULL WHEN 'outcome_accepted' THEN s.state='closed'
 WHEN 'output_available' THEN EXISTS(SELECT 1 FROM change_outputs o WHERE o.workId=d.sourceId)
 WHEN 'integrated' THEN EXISTS(SELECT 1 FROM change_outputs o WHERE o.workId=d.sourceId AND o.state='integrated') ELSE 0 END satisfied
 FROM flow_dependencies d JOIN oversight_nodes n ON n.id=d.sourceId LEFT JOIN work w ON w.id=d.sourceId LEFT JOIN streams s ON s.id=d.sourceId LEFT JOIN human_actions a ON a.id=d.sourceId WHERE d.targetId=? ORDER BY d.stage,d.sourceId`,
    )
    .all(id) as {
    id: string;
    kind: Node['kind'];
    stage: FlowEdge['stage'];
    condition: FlowEdge['condition'];
    reason: string;
    title: string;
    satisfied: number;
  }[];
  return rows.map(({ id, kind, satisfied, ...rest }) => ({
    ...rest,
    source: { id, kind },
    satisfied: !!satisfied,
    evidence: satisfied
      ? kind === 'human_action' || rest.condition === 'outcome_accepted'
        ? kind === 'human_action' &&
          (
            store.raw.prepare('SELECT responseSource FROM human_actions WHERE id=?').get(id) as {
              responseSource: string | null;
            }
          )?.responseSource
          ? 'reported'
          : 'human'
        : 'reported'
      : 'unknown',
  }));
}
export function validateFlowGraph(store: Store) {
  const edges = new Map<string, Set<string>>(),
    add = (a: string, b: string) => {
      const list = edges.get(a) ?? new Set<string>();
      list.add(b);
      edges.set(a, list);
    };
  const nodes = store.raw.prepare('SELECT * FROM oversight_nodes').all() as Node[];
  const kinds = new Map(nodes.map((n) => [n.id, n.kind]));
  for (const n of nodes) {
    if (n.kind === 'change') {
      add(n.id + ':start', n.id + ':output_available');
      add(n.id + ':output_available', n.id + ':integrated');
    } else if (n.kind === 'stream') {
      add(n.id + ':start', n.id + ':outcome_available');
      add(n.id + ':outcome_available', n.id + ':outcome_accepted');
    }
  }
  const rows = store.raw.prepare('SELECT * FROM flow_dependencies').all() as {
    targetId: string;
    sourceId: string;
    stage: string;
    condition: string;
  }[];
  for (const d of rows)
    add(
      d.sourceId + ':' + d.condition,
      d.targetId +
        ':' +
        (d.stage === 'start'
          ? 'start'
          : kinds.get(d.targetId) === 'stream'
            ? 'outcome_available'
            : 'integrated'),
    );
  const done = new Set<string>(),
    visiting = new Set<string>();
  // Iterative DFS keeps long legitimate plans from overflowing the JS call stack.
  for (const root of edges.keys()) {
    if (done.has(root)) continue;
    const stack: [string, boolean][] = [[root, false]];
    while (stack.length) {
      const [id, exit] = stack.pop()!;
      if (exit) {
        visiting.delete(id);
        done.add(id);
        continue;
      }
      if (done.has(id)) continue;
      ensure(!visiting.has(id), 400, 'These prerequisites create an impossible ordering cycle.');
      visiting.add(id);
      stack.push([id, true]);
      for (const next of edges.get(id) ?? []) stack.push([next, false]);
    }
  }
}
export function syncLegacyEdges(store: Store, id: string) {
  store.raw
    .prepare(
      `DELETE FROM flow_dependencies WHERE targetId=? AND sourceId IN (SELECT id FROM oversight_nodes WHERE kind='change')`,
    )
    .run(id);
  store.raw
    .prepare(
      `INSERT INTO flow_dependencies SELECT changeId,requiresId,CASE stage WHEN 'integrate' THEN 'deliver' ELSE stage END,condition,reason FROM change_dependencies WHERE changeId=?`,
    )
    .run(id);
  validateFlowGraph(store);
}
export function replaceEdges(
  store: Store,
  target: Node,
  deps: Omit<FlowEdge, 'title' | 'satisfied' | 'evidence'>[],
) {
  assertNode(store, target);
  ensure(target.kind !== 'human_action', 400, 'Human actions cannot be dependency targets.');
  const seen = new Set<string>();
  for (const d of deps) {
    assertNode(store, d.source);
    ensure(d.source.id !== target.id, 400, 'An item cannot depend on itself.');
    const key = d.source.id + ':' + d.stage;
    ensure(!seen.has(key), 400, 'Duplicate dependency stage.');
    seen.add(key);
    const allowed =
      d.source.kind === 'change'
        ? ['output_available', 'integrated']
        : d.source.kind === 'stream'
          ? ['outcome_available', 'outcome_accepted']
          : ['done'];
    ensure(allowed.includes(d.condition), 400, 'Condition does not match the prerequisite type.');
  }
  store.raw.prepare('DELETE FROM flow_dependencies WHERE targetId=?').run(target.id);
  for (const d of deps)
    store.raw
      .prepare('INSERT INTO flow_dependencies VALUES (?,?,?,?,?)')
      .run(target.id, d.source.id, d.stage, d.condition, d.reason);
  validateFlowGraph(store);
  if (target.kind === 'change') {
    store.raw.prepare('DELETE FROM change_dependencies WHERE changeId=?').run(target.id);
    for (const d of deps.filter((x) => x.source.kind === 'change'))
      store.raw
        .prepare('INSERT INTO change_dependencies VALUES (?,?,?,?,?)')
        .run(
          target.id,
          d.source.id,
          d.stage === 'deliver' ? 'integrate' : 'start',
          d.condition,
          d.reason,
        );
  }
}
function snapshot(store: Store, node: Node): unknown {
  if (node.kind === 'human_action')
    return store.raw.prepare('SELECT id,state,revision FROM human_actions WHERE id=?').get(node.id);
  if (node.kind === 'stream')
    return {
      scope: store.raw
        .prepare(
          'SELECT id,title,outcome,constraints,state,parentId,scopeRevision,planRevision,approvalId,coverageApprovalId,outcomeRevision FROM streams WHERE id=?',
        )
        .get(node.id),
      ancestors: lineage(store, node.id),
      outputs: store.raw
        .prepare('SELECT id,revision FROM stream_outputs WHERE streamId=? ORDER BY id')
        .all(node.id),
    };
  const own = store.raw.prepare('SELECT streamId FROM change_meta WHERE workId=?').get(node.id) as {
    streamId: string | null;
  };
  return {
    ancestors: own.streamId ? lineage(store, own.streamId) : [],
    scope: store.raw
      .prepare(
        'SELECT w.id,w.title,w.objective,w.acceptanceCriteria,m.planRevision,m.streamId,m.coverageApprovalId,m.deliveredAt FROM work w JOIN change_meta m ON m.workId=w.id WHERE w.id=?',
      )
      .get(node.id),
    outputs: store.raw
      .prepare('SELECT id,revision FROM change_outputs WHERE workId=? ORDER BY id')
      .all(node.id),
    refs: store.raw
      .prepare('SELECT system,url FROM source_refs WHERE workId=? ORDER BY system,url')
      .all(node.id),
  };
}
export function flowFingerprint(store: Store, node: Node) {
  const edges = flowDependencies(store, node.id).map(({ source, stage, condition, reason }) => ({
    source,
    stage,
    condition,
    reason,
  }));
  const target = snapshot(store, node);
  const meta =
    node.kind === 'change'
      ? (store.raw.prepare('SELECT streamId FROM change_meta WHERE workId=?').get(node.id) as {
          streamId: string | null;
        })
      : null;
  return hash(
    JSON.stringify({
      version: 2,
      target,
      ancestors: meta?.streamId ? lineage(store, meta.streamId) : [],
      edges,
      sources: edges.map((d) => snapshot(store, d.source)),
    }),
  );
}
export function impactIndex(store: Store) {
  const edges = store.raw
    .prepare('SELECT DISTINCT targetId,sourceId FROM flow_dependencies')
    .all() as { targetId: string; sourceId: string }[];
  const streams = store.raw.prepare('SELECT id,title,parentId FROM streams').all() as {
    id: string;
    title: string;
    parentId: string | null;
  }[];
  const parents = new Map(streams.map((s) => [s.id, s.parentId])),
    titles = new Map(streams.map((s) => [s.id, s.title]));
  const work = store.raw
    .prepare('SELECT w.id,w.title,m.streamId FROM work w JOIN change_meta m ON m.workId=w.id')
    .all() as { id: string; title: string; streamId: string | null }[];
  const workMap = new Map(work.map((w) => [w.id, w]));
  const downstream = new Map<string, Set<string>>();
  for (const e of edges) {
    const targets = downstream.get(e.sourceId) ?? new Set<string>();
    targets.add(e.targetId);
    downstream.set(e.sourceId, targets);
  }
  return (sourceId: string) => {
    const direct = [...(downstream.get(sourceId) ?? [])].map((id) => ({
      id,
      kind: workMap.has(id) ? 'change' : 'stream',
      title: workMap.get(id)?.title ?? titles.get(id) ?? 'Unknown',
    }));
    const seen = new Set<string>([sourceId]),
      queue = [sourceId],
      affected = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const next of downstream.get(id) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      if (id === sourceId) continue;
      let stream = workMap.get(id)?.streamId ?? (parents.has(id) ? id : null);
      const visited = new Set<string>();
      while (stream && !visited.has(stream)) {
        visited.add(stream);
        affected.add(stream);
        stream = parents.get(stream) ?? null;
      }
    }
    return { direct, affectedStreams: [...affected].map((id) => ({ id, title: titles.get(id)! })) };
  };
}
export function impact(store: Store, sourceId: string) {
  return impactIndex(store)(sourceId);
}
