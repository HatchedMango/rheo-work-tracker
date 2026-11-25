import { createHash } from 'node:crypto';
import type { Store } from '../db/index.js';
import type { DesignTarget } from '../shared/design-context.js';
export function designSelection(store: Store, target: DesignTarget) {
  const streamId =
    target.kind === 'stream'
      ? target.id
      : (
          store.raw.prepare('SELECT streamId FROM change_meta WHERE workId=?').get(target.id) as {
            streamId: string | null;
          }
        ).streamId;
  // UNION terminates even if corrupt legacy ancestry contains a cycle.
  const ancestorIds = streamId
    ? (
        store.raw
          .prepare(
            `WITH RECURSIVE chain(id,parentId) AS (SELECT id,parentId FROM streams WHERE id=? UNION SELECT s.id,s.parentId FROM streams s JOIN chain c ON s.id=c.parentId) SELECT id FROM chain`,
          )
          .all(streamId) as { id: string }[]
      ).map((x) => x.id)
    : [];
  const ancestors = ancestorIds.map(() => '?').join(',') || 'NULL';
  const where = `(d.targetKind=? AND d.targetId=?) OR (d.kind='invariant' AND d.targetKind='stream' AND d.targetId IN (${ancestors}) AND json_extract(d.content,'$.inherit')=1 AND json_extract(d.content,'$.status')='active') OR (d.kind='assumption' AND EXISTS(SELECT 1 FROM assumption_reviews r WHERE r.assumptionId=d.id AND r.changeId=?))`;
  const args = [target.kind, target.id, ...ancestorIds, target.kind === 'change' ? target.id : ''];
  return { where, args };
}
export function designVersion(store: Store, target: DesignTarget) {
  const { where, args } = designSelection(store, target);
  const state = {
    records: store.raw
      .prepare(`SELECT d.id,d.revision FROM design_records d WHERE ${where} ORDER BY d.id`)
      .all(...args),
    reviews:
      target.kind === 'change'
        ? store.raw
            .prepare(
              'SELECT assumptionId,revision FROM assumption_reviews WHERE changeId=? ORDER BY assumptionId',
            )
            .all(target.id)
        : [],
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
