CREATE TABLE workflow_permissions(credentialId TEXT PRIMARY KEY REFERENCES credentials(id),relayFeedback INTEGER NOT NULL DEFAULT 0 CHECK(relayFeedback IN (0,1)),updatedAt INTEGER NOT NULL);
CREATE TABLE workflow_sessions(
 id TEXT PRIMARY KEY,credentialId TEXT NOT NULL REFERENCES credentials(id),sessionId TEXT NOT NULL,client TEXT NOT NULL,project TEXT NOT NULL,
 streamId TEXT REFERENCES streams(id),changeId TEXT REFERENCES work(id),turnId TEXT NOT NULL,
 lastEvent TEXT NOT NULL,lastEventAt INTEGER NOT NULL,lastContextAt INTEGER,lastCheckpointAt INTEGER,checkpointTurnId TEXT,
 needsCheckpoint INTEGER NOT NULL DEFAULT 1,summary TEXT NOT NULL DEFAULT '',pendingWrites INTEGER NOT NULL DEFAULT 0,queueReportedAt INTEGER,
 UNIQUE(credentialId,sessionId),CHECK(streamId IS NOT NULL OR changeId IS NOT NULL)
);
CREATE INDEX workflow_sessions_stream ON workflow_sessions(streamId,lastEventAt);
CREATE TABLE workflow_receipts(credentialId TEXT NOT NULL REFERENCES credentials(id),eventId TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,createdAt INTEGER NOT NULL,PRIMARY KEY(credentialId,eventId));
ALTER TABLE human_actions ADD COLUMN responseSource TEXT;
ALTER TABLE stream_context ADD COLUMN answerSource TEXT;
