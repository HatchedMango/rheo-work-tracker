import type { Store } from '../db/index.js';
import type { Coverage, StreamRow } from '../shared/oversight.js';
import { ensure } from './errors.js';
export function lineage(store: Store, id: string): StreamRow[] {
  return store.raw
    .prepare(
      `WITH RECURSIVE chain AS (SELECT id,parentId,title,state,scopeRevision,approvalId,coverageApprovalId,','||id||',' path FROM streams WHERE id=? UNION ALL SELECT s.id,s.parentId,s.title,s.state,s.scopeRevision,s.approvalId,s.coverageApprovalId,c.path||s.id||',' FROM streams s JOIN chain c ON c.parentId=s.id WHERE instr(c.path,','||s.id||',')=0) SELECT * FROM chain`,
    )
    .all(id) as StreamRow[];
}
function grant(store: Store, id: string): Coverage | null {
  const row = store.raw
    .prepare(
      `SELECT a.id approvalId,a.streamId,a.scopeRevision,a.actorId approvedBy,a.createdAt FROM stream_approvals a JOIN streams s ON s.id=a.streamId WHERE a.id=? AND s.approvalId=a.id AND s.scopeRevision=a.scopeRevision`,
    )
    .get(id) as Coverage | undefined;
  return row ?? null;
}
export function activeLineage(store: Store, id: string | null) {
  if (!id) return true;
  const chain = lineage(store, id);
  return chain.length > 0 && chain.every((s) => ['active', 'proposed'].includes(s.state));
}
export function routineCoverage(store: Store, id: string | null): Coverage | null {
  if (!id || !activeLineage(store, id)) return null;
  for (const s of lineage(store, id)) {
    if (s.approvalId) {
      const g = grant(store, s.approvalId);
      if (g) return g;
    }
  }
  return null;
}
export function recordedCoverage(
  store: Store,
  streamId: string | null,
  approvalId: string | null,
): Coverage | null {
  if (!streamId || !approvalId) return null;
  const g = grant(store, approvalId);
  return g && lineage(store, streamId).some((s) => s.id === g.streamId) ? g : null;
}
export function effectiveCoverage(
  store: Store,
  streamId: string | null,
  approvalId: string | null,
): Coverage | null {
  return activeLineage(store, streamId) ? recordedCoverage(store, streamId, approvalId) : null;
}
export function assertChangeMove(
  store: Store,
  scope: string,
  from: string | null,
  to: string | null,
  coverageId: string | null,
) {
  if (from === to) return;
  if (scope !== 'owner' && from && to)
    ensure(
      lineage(store, from).at(-1)?.id === lineage(store, to).at(-1)?.id,
      403,
      'Moving work across stream boundaries requires the owner.',
    );
}
export function subtreeIds(store: Store, id: string) {
  return (
    store.raw
      .prepare(
        `WITH RECURSIVE tree(id) AS (SELECT id FROM streams WHERE id=? UNION SELECT s.id FROM streams s JOIN tree p ON s.parentId=p.id) SELECT id FROM tree`,
      )
      .all(id) as { id: string }[]
  ).map((x) => x.id);
}
export function revokeInactiveClaims(store: Store, now: number) {
  const claims = store.raw
    .prepare(
      `SELECT c.id,m.streamId,m.coverageApprovalId,m.deliveredAt,a.state assignment FROM collaboration_claims c JOIN change_meta m ON m.workId=c.workId JOIN assignments a ON a.workId=c.workId WHERE c.state='active'`,
    )
    .all() as {
    id: string;
    streamId: string | null;
    coverageApprovalId: string | null;
    deliveredAt: number | null;
    assignment: string;
  }[];
  for (const c of claims)
    if (
      c.deliveredAt !== null ||
      !activeLineage(store, c.streamId) ||
      ['declined', 'withdrawn'].includes(c.assignment)
    )
      store.raw
        .prepare(`UPDATE collaboration_claims SET state='revoked',updatedAt=? WHERE id=?`)
        .run(now, c.id);
}
