import type { MapEdge } from '../../src/shared/work-map.js';
type Point = { x: number; y: number };
export type MapBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  groupId: string;
  heading?: boolean;
  anchorLeft?: number;
  anchorRight?: number;
};
const centerX = (box: MapBox) =>
  ((box.anchorLeft ?? box.left) + (box.anchorRight ?? box.right)) / 2;
const centerY = (box: MapBox) => (box.top + box.bottom) / 2;
// Round real bends rather than applying a border-like dashed rectangle to the map.
function rounded(points: Point[]) {
  const clean = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  let d = `M ${clean[0].x} ${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1],
      p = clean[i],
      next = clean[i + 1];
    const before = Math.hypot(p.x - prev.x, p.y - prev.y),
      after = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(8, before / 2, after / 2);
    if (!r || (p.x - prev.x) * (next.y - p.y) === (p.y - prev.y) * (next.x - p.x)) {
      d += ` L ${p.x} ${p.y}`;
      continue;
    }
    const a = { x: p.x - ((p.x - prev.x) / before) * r, y: p.y - ((p.y - prev.y) / before) * r };
    const b = { x: p.x + ((next.x - p.x) / after) * r, y: p.y + ((next.y - p.y) / after) * r };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  const end = clean[clean.length - 1];
  return d + ` L ${end.x} ${end.y}`;
}
export function workMapPath(
  edge: MapEdge,
  boxes: Map<string, MapBox>,
  index: number,
  siblings: MapEdge[],
) {
  const a = boxes.get(edge.sourceId),
    b = boxes.get(edge.targetId);
  if (!a || !b) return null;
  const ax = centerX(a),
    ay = centerY(a),
    bx = centerX(b),
    by = centerY(b);
  const others = [...boxes]
    .filter(([id]) => id !== edge.sourceId && id !== edge.targetId)
    .map(([, box]) => box);
  const blocked = (x1: number, y1: number, x2: number, y2: number) =>
    others.some(
      (r) =>
        r.left - 5 < Math.max(x1, x2) &&
        r.right + 5 > Math.min(x1, x2) &&
        r.top - 5 < Math.max(y1, y2) + 1 &&
        r.bottom + 5 > Math.min(y1, y2) - 1,
    );
  const leftRail = Math.max(
    5,
    Math.min(...[...boxes.values()].map((r) => r.left)) - 12 - (index % 3) * 7,
  );
  if (b.heading && a.groupId === b.groupId && a.top >= b.bottom) {
    const slot = siblings.findIndex((e) => e.sourceId === edge.sourceId && e.stage === edge.stage);
    const left = (b.anchorLeft ?? b.left) + 10,
      right = (b.anchorRight ?? b.right) - 10;
    const port = left + (Math.max(0, right - left) * (slot + 1)) / (siblings.length + 1);
    const lane = b.bottom + 10 + (slot % 3) * 6;
    if (!blocked(ax, a.top - 5, ax, lane))
      return rounded([
        { x: ax, y: a.top },
        { x: ax, y: lane },
        { x: port, y: lane },
        { x: port, y: b.bottom },
      ]);
    // A wrapped card feeds the heading through the outer gutter, never the card above it.
    const exit = !blocked(a.left - 5, ay, leftRail, ay)
      ? [
          { x: a.left, y: ay },
          { x: leftRail, y: ay },
        ]
      : [
          { x: ax, y: a.top },
          { x: ax, y: a.top - 13 },
          { x: leftRail, y: a.top - 13 },
        ];
    return rounded([
      ...exit,
      { x: leftRail, y: lane },
      { x: port, y: lane },
      { x: port, y: b.bottom },
    ]);
  }
  const sameRow = Math.abs(ay - by) < Math.min(a.bottom - a.top, b.bottom - b.top) / 2;
  if (sameRow && !blocked(ax, ay, bx, by) && a.groupId === b.groupId) {
    const forward = bx > ax,
      x1 = forward ? a.right : a.left,
      x2 = forward ? b.left : b.right;
    const bend = Math.max(12, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${ay} C ${x1 + (forward ? bend : -bend)} ${ay}, ${x2 + (forward ? -bend : bend)} ${by}, ${x2} ${by}`;
  }
  if (sameRow) {
    const lane = Math.min(a.top, b.top) - 13;
    return rounded([
      { x: ax, y: a.top },
      { x: ax, y: lane },
      { x: bx, y: lane },
      { x: bx, y: b.top },
    ]);
  }
  const down = by > ay,
    y1 = down ? a.bottom : a.top,
    y2 = down ? b.top : b.bottom;
  // Adjacent rows usually have a clear shared gutter: use it directly rather
  // than making an unnecessary lap around the outside of the whole graph.
  for (const lane of [y1 + (down ? 14 : -14), y2 + (down ? -14 : 14)]) {
    if (!blocked(ax, y1, ax, lane) && !blocked(ax, lane, bx, lane) && !blocked(bx, lane, bx, y2))
      return rounded([
        { x: ax, y: y1 },
        { x: ax, y: lane },
        { x: bx, y: lane },
        { x: bx, y: y2 },
      ]);
  }
  return rounded([
    { x: ax, y: y1 },
    { x: ax, y: y1 + (down ? 13 : -13) },
    { x: leftRail, y: y1 + (down ? 13 : -13) },
    { x: leftRail, y: y2 + (down ? -13 : 13) },
    { x: bx, y: y2 + (down ? -13 : 13) },
    { x: bx, y: y2 },
  ]);
}
