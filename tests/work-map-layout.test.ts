import { expect, test } from 'vitest';
import type { MapEdge, MapNode } from '../src/shared/work-map.js';
import { workMapLayout, verticalMapLayout } from '../web/src/work-map-layout.js';

const node = (id: string, groupId = 'stream'): MapNode => ({
  id,
  groupId,
  streamId: groupId,
  kind: 'change',
  title: id,
  purpose: '',
  update: '',
  status: 'Planned',
  tone: 'planned',
  assessment: 'unknown',
  prerequisiteCount: 0,
  dependencyAssessment: null,
  quiet: false,
  reference: false,
  conversationUrl: null,
  outputs: [],
});
const edge = (
  sourceId: string,
  targetId: string,
  stage: 'start' | 'deliver' = 'start',
  satisfied = false,
): MapEdge => ({
  sourceId,
  targetId,
  stage,
  condition: 'output_available',
  reason: '',
  satisfied,
  evidence: 'unknown',
});

test('chains stay aligned while unrelated ready work cannot split them', () => {
  const nodes = ['A build', 'B unrelated', 'C verify', 'D release'].map((id) => node(id));
  const edges = [edge(nodes[0].id, nodes[2].id), edge(nodes[2].id, nodes[3].id)];
  const { positions: p } = workMapLayout(nodes, edges);
  expect(p.get(nodes[0].id)).toEqual({ column: 0, row: 0 });
  expect(p.get(nodes[2].id)).toEqual({ column: 1, row: 0 });
  expect(p.get(nodes[3].id)).toEqual({ column: 2, row: 0 });
  expect(p.get(nodes[1].id)).toEqual({ column: 0, row: 1 });
  expect(workMapLayout([...nodes].reverse(), [...edges].reverse()).positions).toEqual(p);
});

test('branches and joins share columns across stream membership', () => {
  const nodes = [node('A'), node('B', 'child'), node('C'), node('D')];
  const edges = [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D')];
  const { positions: p } = workMapLayout(nodes, edges);
  expect(p.get('B')!.column).toBe(1);
  expect(p.get('C')!.column).toBe(1);
  expect(p.get('D')!.column).toBe(2);
  expect(p.get('B')!.row).not.toBe(p.get('C')!.row);
  expect(new Set([...p.values()].map((v) => `${v.column}:${v.row}`)).size).toBe(4);
});

test('satisfied and delivery-only gates do not postpone starting; loops lose no cards', () => {
  const nodes = ['A', 'B', 'C', 'D'].map((id) => node(id));
  const { positions: p } = workMapLayout(nodes, [
    edge('A', 'B', 'deliver'),
    edge('B', 'C', 'start', true),
    edge('C', 'D'),
    edge('D', 'C'),
  ]);
  expect(p.get('A')!.column).toBe(0);
  expect(p.get('B')!.column).toBe(0);
  expect(p.get('C')!.column).toBe(p.get('D')!.column);
  expect(p.size).toBe(4);
  // This function never manufactures a readiness assessment from an empty edge list.
  expect(nodes.every((n) => n.dependencyAssessment === null)).toBe(true);
});

test('narrow flow keeps every prerequisite above its dependent without collisions', () => {
  const nodes = ['A', 'B', 'C', 'D', 'E'].map((id) => node(id));
  const edges = [edge('A', 'C'), edge('B', 'C'), edge('C', 'D')];
  const wide = workMapLayout(nodes, edges);
  for (const columns of [1, 2]) {
    const { positions: p } = verticalMapLayout(wide, columns);
    expect(p.size).toBe(nodes.length);
    for (const e of edges) expect(p.get(e.sourceId)!.row).toBeLessThan(p.get(e.targetId)!.row);
    expect(new Set([...p.values()].map((v) => `${v.column}:${v.row}`)).size).toBe(nodes.length);
  }
});
