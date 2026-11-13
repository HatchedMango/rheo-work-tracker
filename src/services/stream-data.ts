import type { Store } from '../db/index.js';
import type { ChangeTracking, Claim, Output, Dependency } from '../shared/streams.js';
import { flowFingerprint, flowDependencies } from './flow.js';
import { effectiveCoverage, activeLineage } from './coverage.js';
export type Meta = Omit<
  ChangeTracking,
  | 'streamTitle'
  | 'reporterName'
  | 'assessmentState'
  | 'assessmentFingerprint'
  | 'dependencies'
  | 'outputs'
  | 'claim'
  | 'areas'
  | 'resources'
  | 'coverage'
  | 'prerequisites'
> & { areas: string; resources: string; assessment: string | null };
export function planFingerprint(store: Store, id: string) {
  return flowFingerprint(store, { id, kind: 'change' });
}
export function readClaim(store: Store, id: string, now: number): Claim | null {
  const c = store.raw
    .prepare(
      `SELECT c.id,c.workId,c.actorId,a.name actorName,c.sessionId,c.planRevision,c.state,c.expiresAt,c.createdAt,c.updatedAt,cr.revokedAt,cr.expiresAt credentialExpiresAt,w.lifecycle,s.state streamState,m.streamId,m.coverageApprovalId,m.deliveredAt,(SELECT state FROM assignments WHERE workId=w.id) assignment FROM collaboration_claims c JOIN actors a ON a.id=c.actorId JOIN credentials cr ON cr.id=c.credentialId JOIN work w ON w.id=c.workId JOIN change_meta m ON m.workId=c.workId LEFT JOIN streams s ON s.id=m.streamId WHERE c.workId=? ORDER BY c.createdAt DESC,c.rowid DESC LIMIT 1`,
    )
    .get(id) as
    | (Claim & {
        revokedAt: number | null;
        credentialExpiresAt: number | null;
        lifecycle: string;
        streamState: string | null;
        streamId: string | null;
        coverageApprovalId: string | null;
        deliveredAt: number | null;
        assignment: string;
      })
    | undefined;
  if (!c) return null;
  const {
    revokedAt,
    credentialExpiresAt,
    lifecycle,
    streamState,
    streamId,
    coverageApprovalId,
    deliveredAt,
    assignment,
    ...claim
  } = c;
  if (
    claim.state === 'active' &&
    (revokedAt !== null ||
      (credentialExpiresAt !== null && credentialExpiresAt <= now) ||
      lifecycle !== 'open' ||
      deliveredAt !== null ||
      !activeLineage(store, streamId) ||
      ['declined', 'withdrawn'].includes(assignment) ||
      (streamState !== null && !['active', 'proposed'].includes(streamState)))
  )
    claim.state = 'revoked';
  else if (claim.state === 'active' && claim.expiresAt <= now) claim.state = 'expired';
  return claim;
}
export function readTracking(store: Store, id: string, now: number): ChangeTracking {
  const m = store.raw
    .prepare(
      `SELECT m.*,s.title streamTitle,a.name reporterName FROM change_meta m LEFT JOIN streams s ON s.id=m.streamId LEFT JOIN actors a ON a.id=m.reportedBy WHERE m.workId=?`,
    )
    .get(id) as Meta & { streamTitle: string | null; reporterName: string | null };
  const dependencies = store.raw
    .prepare(
      `SELECT d.requiresId,d.stage,d.condition,d.reason,w.title,EXISTS(SELECT 1 FROM change_outputs o WHERE o.workId=d.requiresId AND (d.condition='output_available' OR o.state='integrated')) satisfied FROM change_dependencies d JOIN work w ON w.id=d.requiresId WHERE changeId=? ORDER BY d.stage,w.title`,
    )
    .all(id) as (Omit<Dependency, 'satisfied' | 'evidence'> & { satisfied: number })[];
  const outputs = store.raw
    .prepare(
      `SELECT o.*,a.name actorName FROM change_outputs o JOIN actors a ON a.id=o.reportedBy WHERE o.workId=? ORDER BY reportedAt DESC,o.rowid DESC LIMIT 100`,
    )
    .all(id) as Output[];
  const { assessment, ...rest } = m;
  const assessmentFingerprint = planFingerprint(store, id);
  return {
    ...rest,
    progress: m.deliveredAt !== null ? 'delivered' : m.progress,
    coverage: effectiveCoverage(store, m.streamId, m.coverageApprovalId),
    prerequisites: flowDependencies(store, id),
    areas: JSON.parse(m.areas),
    resources: JSON.parse(m.resources),
    assessmentFingerprint,
    assessmentState: !assessment
      ? 'unknown'
      : assessment === assessmentFingerprint
        ? 'current'
        : 'stale',
    dependencies: dependencies.map((d) => ({
      ...d,
      satisfied: !!d.satisfied,
      evidence: d.satisfied ? 'reported' : 'unknown',
    })),
    outputs,
    claim: readClaim(store, id, now),
  };
}
