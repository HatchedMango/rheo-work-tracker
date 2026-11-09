CREATE TABLE agent_connections (
  id TEXT PRIMARY KEY,
  credentialId TEXT NOT NULL REFERENCES credentials(id),
  actorId TEXT NOT NULL REFERENCES actors(id),
  name TEXT NOT NULL,
  client TEXT NOT NULL CHECK(client IN ('codex','claude-desktop','other')),
  credentialPath TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  initializedAt INTEGER,
  lastToolAt INTEGER,
  lastTool TEXT,
  clientName TEXT,
  lastCheckedAt INTEGER,
  checkOk INTEGER
);
