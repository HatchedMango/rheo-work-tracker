CREATE TABLE streams (
 id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id), createdBy TEXT NOT NULL REFERENCES actors(id),
 title TEXT NOT NULL, outcome TEXT NOT NULL, constraints TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL CHECK(state IN ('proposed','active','paused','closed','declined')),
 revision INTEGER NOT NULL DEFAULT 1, scopeRevision INTEGER NOT NULL DEFAULT 1, pendingScope TEXT,
 createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE stream_events (id TEXT PRIMARY KEY, streamId TEXT NOT NULL REFERENCES streams(id), actorId TEXT NOT NULL REFERENCES actors(id), type TEXT NOT NULL, message TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', createdAt INTEGER NOT NULL);
CREATE INDEX stream_events_recent ON stream_events(streamId,createdAt);
CREATE TRIGGER stream_events_no_update BEFORE UPDATE ON stream_events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TRIGGER stream_events_no_delete BEFORE DELETE ON stream_events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TABLE change_meta (
 workId TEXT PRIMARY KEY REFERENCES work(id), streamId TEXT REFERENCES streams(id), expectedOutput TEXT NOT NULL DEFAULT '',
 areas TEXT NOT NULL DEFAULT '[]', resources TEXT NOT NULL DEFAULT '[]', baseRef TEXT NOT NULL DEFAULT '',
 progress TEXT NOT NULL DEFAULT 'unreported' CHECK(progress IN ('unreported','planned','working','blocked','review')),
 progressNote TEXT NOT NULL DEFAULT '', reportedBy TEXT REFERENCES actors(id), reportedAt INTEGER,
 revision INTEGER NOT NULL DEFAULT 1, planRevision INTEGER NOT NULL DEFAULT 1, assessment TEXT, assessedBy TEXT REFERENCES actors(id), assessedAt INTEGER
);
INSERT INTO change_meta(workId) SELECT id FROM work;
CREATE INDEX changes_stream ON change_meta(streamId);
CREATE TABLE change_dependencies (
 changeId TEXT NOT NULL REFERENCES work(id), requiresId TEXT NOT NULL REFERENCES work(id),
 stage TEXT NOT NULL CHECK(stage IN ('start','integrate')), condition TEXT NOT NULL CHECK(condition IN ('output_available','integrated')),
 reason TEXT NOT NULL, PRIMARY KEY(changeId,requiresId,stage), CHECK(changeId != requiresId)
);
CREATE TABLE stream_context (
 id TEXT PRIMARY KEY, streamId TEXT NOT NULL REFERENCES streams(id), kind TEXT NOT NULL CHECK(kind IN ('decision','finding','question','constraint')),
 body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved','superseded')),
 needsHuman INTEGER NOT NULL DEFAULT 0 CHECK(needsHuman IN (0,1)), createdBy TEXT NOT NULL REFERENCES actors(id), revision INTEGER NOT NULL DEFAULT 1, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE change_outputs (
 id TEXT PRIMARY KEY, workId TEXT NOT NULL REFERENCES work(id), kind TEXT NOT NULL CHECK(kind IN ('mr','document','finding','release','other')),
 url TEXT NOT NULL, label TEXT NOT NULL, codeRevision TEXT NOT NULL DEFAULT '', state TEXT NOT NULL CHECK(state IN ('available','integrated')),
 reportedBy TEXT NOT NULL REFERENCES actors(id), reportedAt INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(workId,url,reportedBy)
);
CREATE TABLE collaboration_claims (
 id TEXT PRIMARY KEY, workId TEXT NOT NULL REFERENCES work(id), actorId TEXT NOT NULL REFERENCES actors(id), credentialId TEXT NOT NULL REFERENCES credentials(id),
 sessionId TEXT NOT NULL, tokenHash TEXT NOT NULL, planRevision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','released','expired','revoked')), expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX one_collaboration_claim ON collaboration_claims(workId) WHERE state='active';
CREATE TABLE workflow_reads (credentialId TEXT PRIMARY KEY REFERENCES credentials(id), workflowVersion TEXT NOT NULL, project TEXT NOT NULL, streamId TEXT REFERENCES streams(id), lastReadAt INTEGER NOT NULL);
