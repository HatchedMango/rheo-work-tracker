-- Recover undecided work captured through the former backlog intake path.
-- Preserve resolved decisions, closed work, and any existing attention/history.
INSERT INTO attention (id, workId, kind, createdAt)
SELECT 'intake-review:' || a.id, w.id, 'assignment', MAX(w.updatedAt + 1, unixepoch() * 1000)
FROM work w JOIN assignments a ON a.workId = w.id
WHERE w.lifecycle IN ('open', 'blocked') AND w.ownerId IS NULL
  AND a.state = 'proposed' AND a.decidedAt IS NULL
  AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.workId = w.id)
  AND NOT EXISTS (SELECT 1 FROM attention t WHERE t.workId = w.id AND t.kind = 'assignment');

INSERT INTO events (id, workId, actorId, type, message, data, "references", createdAt)
SELECT 'intake-review-event:' || a.id, a.workId, 'system', 'assignment_requested',
  'Sent to inbox for review; previously captured without an assignment decision.', '{}', '[]', t.createdAt
FROM assignments a JOIN attention t ON t.id = 'intake-review:' || a.id;

UPDATE work SET revision = revision + 1,
  updatedAt = (SELECT t.createdAt FROM attention t WHERE t.workId = work.id AND t.id LIKE 'intake-review:%')
WHERE id IN (SELECT workId FROM attention WHERE id LIKE 'intake-review:%');
