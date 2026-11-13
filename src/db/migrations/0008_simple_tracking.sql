-- Tracking is distinct from a human accepting responsibility. Preserve decisions.
CREATE TABLE assignments_tracking (id TEXT PRIMARY KEY,workId TEXT NOT NULL REFERENCES work(id),recipientId TEXT NOT NULL REFERENCES actors(id),state TEXT NOT NULL CHECK(state IN ('tracked','proposed','accepted','declined','withdrawn','covered')),decidedAt INTEGER);
INSERT INTO assignments_tracking SELECT * FROM assignments;
DROP TABLE assignments;
ALTER TABLE assignments_tracking RENAME TO assignments;
CREATE UNIQUE INDEX assignment_work ON assignments(workId);
ALTER TABLE stream_context ADD COLUMN conversationUrl TEXT;
ALTER TABLE human_actions ADD COLUMN conversationUrl TEXT;
