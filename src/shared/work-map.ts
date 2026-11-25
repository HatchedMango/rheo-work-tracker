import type { FlowEdge, Node } from './oversight.js';
export type MapNode = {
  designContextVersion?: string;
  id: string;
  kind: Node['kind'] | 'question';
  groupId: string;
  streamId: string | null;
  title: string;
  purpose: string;
  update: string;
  status: string;
  tone: 'active' | 'waiting' | 'attention' | 'quiet' | 'planned';
  assessment: 'unknown' | 'current' | 'stale';
  prerequisiteCount: number;
  requestRevision?: number;
  dependencyAssessment: import('./dependency-assessments.js').DependencyAssessment | null;
  quiet: boolean;
  reference: boolean;
  conversationUrl: string | null;
  sessions?: import('./sessions.js').SessionLinks;
  outputs: { label: string; url: string; id?: string; revision?: number }[];
};
export type MapEdge = Omit<FlowEdge, 'source' | 'title'> & {
  sourceId: string;
  targetId: string;
};
export type WorkMap = {
  rootId: string;
  groups: { id: string; parentId: string | null; title: string; depth: number }[];
  nodes: MapNode[];
  edges: MapEdge[];
  omittedNodes: number;
  omittedEdges: number;
  moreStreams: boolean;
  complete: boolean;
};
// Stage-valid relationships can form a node-level loop. Keep those nodes stable
// rather than invent a topological order or reject a valid plan.
export function orderMapNodes(nodes: MapNode[], edges: MapEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  const outgoing = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of edges) {
    if (!byId.has(e.sourceId) || !byId.has(e.targetId)) continue;
    incoming.get(e.targetId)!.add(e.sourceId);
    outgoing.get(e.sourceId)!.add(e.targetId);
  }
  const priority = { attention: 0, active: 1, waiting: 2, planned: 3, quiet: 4 };
  const compare = (a: string, b: string) => {
    const x = byId.get(a)!,
      y = byId.get(b)!;
    return (
      priority[x.tone] - priority[y.tone] || x.title.localeCompare(y.title) || a.localeCompare(b)
    );
  };
  const ready = nodes
    .filter((n) => !incoming.get(n.id)!.size)
    .map((n) => n.id)
    .sort(compare);
  const ordered: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const next of outgoing.get(id)!) {
      incoming.get(next)!.delete(id);
      if (!incoming.get(next)!.size) {
        ready.push(next);
        ready.sort(compare);
      }
    }
  }
  const done = new Set(ordered);
  const remaining = nodes
    .filter((n) => !done.has(n.id))
    .map((n) => n.id)
    .sort(compare);
  return {
    nodes: [...ordered, ...remaining].map((id) => byId.get(id)!),
    stagedLoop: remaining.length > 0,
  };
}
