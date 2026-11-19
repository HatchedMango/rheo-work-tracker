-- SQLite cannot extend a CHECK constraint in place. No tables reference this
-- table; workflow/session permissions reference the unchanged credential IDs.
CREATE TABLE agent_connections_next (
  id TEXT PRIMARY KEY,
  credentialId TEXT NOT NULL REFERENCES credentials(id),
  actorId TEXT NOT NULL REFERENCES actors(id),
  name TEXT NOT NULL,
  client TEXT NOT NULL CHECK(client IN ('codex','claude-code','claude-desktop','other')),
  credentialPath TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  initializedAt INTEGER,
  lastToolAt INTEGER,
  lastTool TEXT,
  clientName TEXT,
  lastCheckedAt INTEGER,
  checkOk INTEGER,
  completedAt INTEGER
);
INSERT INTO agent_connections_next (
  id,credentialId,actorId,name,client,credentialPath,idempotencyKey,createdAt,
  initializedAt,lastToolAt,lastTool,clientName,lastCheckedAt,checkOk,completedAt
)
SELECT id,credentialId,actorId,name,client,credentialPath,idempotencyKey,createdAt,
  initializedAt,lastToolAt,lastTool,clientName,lastCheckedAt,checkOk,completedAt
FROM agent_connections;
DROP TABLE agent_connections;
ALTER TABLE agent_connections_next RENAME TO agent_connections;
