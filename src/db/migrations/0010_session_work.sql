CREATE TABLE session_work (
 id TEXT PRIMARY KEY,
 workflowSessionId TEXT NOT NULL REFERENCES workflow_sessions(id),
 selectionKey TEXT NOT NULL,
 streamId TEXT REFERENCES streams(id),
 changeId TEXT REFERENCES work(id),
 firstSeenAt INTEGER NOT NULL,
 lastSeenAt INTEGER NOT NULL,
 lastEvent TEXT NOT NULL,
 summary TEXT NOT NULL DEFAULT '',
 lastCheckpointAt INTEGER,
 UNIQUE(workflowSessionId,selectionKey),
 CHECK(streamId IS NOT NULL OR changeId IS NOT NULL)
);
CREATE INDEX session_work_stream ON session_work(streamId,lastSeenAt DESC);
CREATE INDEX session_work_change ON session_work(changeId,lastSeenAt DESC);
INSERT INTO session_work(id,workflowSessionId,selectionKey,streamId,changeId,firstSeenAt,lastSeenAt,lastEvent,summary,lastCheckpointAt)
 SELECT id,id,coalesce(streamId,'') || ':' || coalesce(changeId,''),streamId,changeId,lastEventAt,lastEventAt,lastEvent,summary,lastCheckpointAt FROM workflow_sessions;
