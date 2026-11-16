import type { Store } from '../db/index.js';
import type { Actor } from '../shared/contracts.js';
import type { SessionLinks, SessionLink } from '../shared/sessions.js';
// Batch only the displayed nodes. Change sessions stay with their change; a stream
// heading gets only sessions explicitly selected at stream level.
export function readSessionLinks(
  store: Store,
  actor: Actor,
  ids: string[],
  now = Date.now(),
): Map<string, SessionLinks> {
  if (!ids.length) return new Map();
  const rows = store.raw
    .prepare(
      `WITH associations AS (
    SELECT coalesce(h.changeId,h.streamId) nodeId,h.id,s.sessionId,s.client,s.id workflowSessionId,h.lastSeenAt,
    CASE WHEN s.changeId IS NOT NULL AND h.changeId=s.changeId AND h.streamId IS s.streamId AND h.streamId IS m.streamId AND c.revokedAt IS NULL AND (c.expiresAt IS NULL OR c.expiresAt>?) THEN 1 ELSE 0 END canResume,
    ROW_NUMBER() OVER(PARTITION BY coalesce(h.changeId,h.streamId),s.id ORDER BY h.lastSeenAt DESC,h.id) identityRank
    FROM session_work h JOIN workflow_sessions s ON s.id=h.workflowSessionId JOIN credentials c ON c.id=s.credentialId LEFT JOIN change_meta m ON m.workId=h.changeId
    WHERE coalesce(h.changeId,h.streamId) IN (${ids.map(() => '?').join(',')})
    ${actor.scope === 'agent' ? 'AND s.credentialId=?' : ''}
  ), ranked AS (
    SELECT *,COUNT(*) OVER(PARTITION BY nodeId) total,MAX(canResume) OVER(PARTITION BY nodeId) resumable,
    ROW_NUMBER() OVER(PARTITION BY nodeId ORDER BY lastSeenAt DESC,id) rank
    FROM associations WHERE identityRank=1
  ) SELECT nodeId,id,sessionId,client,total,resumable FROM ranked WHERE rank<=3 ORDER BY nodeId,rank`,
    )
    .all(
      now,
      ...ids,
      ...(actor.scope === 'agent' ? [actor.credentialId ?? ''] : []),
    ) as (SessionLink & {
    nodeId: string;
    total: number;
    resumable: number;
  })[];
  const result = new Map<string, SessionLinks>();
  for (const { nodeId, total, resumable, ...link } of rows) {
    if (!result.has(nodeId)) result.set(nodeId, { items: [], total, resumable: !!resumable });
    result.get(nodeId)!.items.push(link);
  }
  return result;
}
