import type { MapEdge, MapNode } from '../../src/shared/work-map.js';

const priority = { attention: 0, active: 1, waiting: 2, planned: 3, quiet: 4 };

// Columns express outstanding start gates, not readiness certification. Delivery
// gates and satisfied links remain visible without postponing an otherwise usable card.
export function workMapLayout(nodes: MapNode[], edges: MapEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const compare = (a: string, b: string) => {
    const x = byId.get(a)!,
      y = byId.get(b)!;
    return (
      priority[x.tone] - priority[y.tone] || x.title.localeCompare(y.title) || a.localeCompare(b)
    );
  };
  const links = edges.filter((e) => byId.has(e.sourceId) && byId.has(e.targetId));
  const starts = links.filter((e) => e.stage === 'start' && !e.satisfied);
  const next = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  const neighbors = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of links) {
    neighbors.get(e.sourceId)!.add(e.targetId);
    neighbors.get(e.targetId)!.add(e.sourceId);
  }
  for (const e of starts) next.get(e.sourceId)!.add(e.targetId);

  // Condense loops rather than dropping nodes or inventing an ordering inside one.
  let serial = 0;
  const index = new Map<string, number>(),
    low = new Map<string, number>();
  const stack: string[] = [],
    onStack = new Set<string>();
  const clusters: string[][] = [],
    clusterOf = new Map<string, number>();
  function visit(id: string) {
    index.set(id, serial);
    low.set(id, serial++);
    stack.push(id);
    onStack.add(id);
    for (const target of [...next.get(id)!].sort(compare)) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const cluster: string[] = [];
    let item: string;
    do {
      item = stack.pop()!;
      onStack.delete(item);
      clusterOf.set(item, clusters.length);
      cluster.push(item);
    } while (item !== id);
    clusters.push(cluster.sort(compare));
  }
  for (const id of [...byId.keys()].sort(compare)) if (!index.has(id)) visit(id);
  const ranks = new Map<number, number>();
  function rank(cluster: number): number {
    if (ranks.has(cluster)) return ranks.get(cluster)!;
    const parents = starts.filter(
      (e) => clusterOf.get(e.targetId) === cluster && clusterOf.get(e.sourceId) !== cluster,
    );
    const value = Math.max(0, ...parents.map((e) => rank(clusterOf.get(e.sourceId)!) + 1));
    ranks.set(cluster, value);
    return value;
  }
  clusters.forEach((_, i) => rank(i));

  // Reserve a contiguous band for each connected branch. Unrelated cards cannot
  // become obstacles between its prerequisites and dependents.
  const seen = new Set<string>(),
    components: string[][] = [];
  for (const id of [...byId.keys()].sort(compare)) {
    if (seen.has(id)) continue;
    const component: string[] = [],
      pending = [id];
    seen.add(id);
    while (pending.length) {
      const current = pending.pop()!;
      component.push(current);
      for (const neighbor of neighbors.get(current)!)
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          pending.push(neighbor);
        }
    }
    components.push(component);
  }
  const positions = new Map<string, { column: number; row: number }>();
  let rowOffset = 0;
  const columns = Math.max(0, ...ranks.values()) + 1;
  for (const component of components) {
    let height = 0;
    for (let column = 0; column < columns; column++) {
      const members = component.filter((id) => ranks.get(clusterOf.get(id)!) === column);
      const preferredRow = (id: string) => {
        const parents = starts
          .filter((e) => e.targetId === id)
          .flatMap((e) =>
            positions.has(e.sourceId) ? [positions.get(e.sourceId)!.row - rowOffset] : [],
          );
        return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : 0;
      };
      members.sort((a, b) => preferredRow(a) - preferredRow(b) || compare(a, b));
      const occupied = new Set<number>();
      for (const id of members) {
        let row = Math.round(preferredRow(id));
        while (occupied.has(row)) row++;
        occupied.add(row);
        height = Math.max(height, row + 1);
        positions.set(id, { column, row: rowOffset + row });
      }
    }
    rowOffset += height;
  }
  return {
    positions,
    columns: Math.max(1, ...[...positions.values()].map((p) => p.column + 1)),
    rows: rowOffset,
  };
}

export function verticalMapLayout(layout: ReturnType<typeof workMapLayout>, columns: number) {
  const positions = new Map<string, { column: number; row: number }>();
  let offset = 0;
  for (let rank = 0; rank < layout.columns; rank++) {
    const members = [...layout.positions]
      .filter(([, p]) => p.column === rank)
      .sort((a, b) => a[1].row - b[1].row);
    members.forEach(([id], i) =>
      positions.set(id, { column: i % columns, row: offset + Math.floor(i / columns) }),
    );
    offset += Math.ceil(members.length / columns);
  }
  return { positions, columns, rows: offset };
}
