CREATE TABLE design_records (
  id TEXT PRIMARY KEY,
  targetKind TEXT NOT NULL CHECK(targetKind IN ('stream','change')),
  targetId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('assumption','invariant','verification')),
  content TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  createdBy TEXT NOT NULL REFERENCES actors(id),
  updatedBy TEXT NOT NULL REFERENCES actors(id),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX design_records_target ON design_records(targetKind,targetId,kind);
CREATE TABLE assumption_reviews (
  changeId TEXT NOT NULL REFERENCES work(id),
  assumptionId TEXT NOT NULL REFERENCES design_records(id),
  assumptionRevision INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL,
  reviewedBy TEXT NOT NULL REFERENCES actors(id),
  reviewedAt INTEGER NOT NULL,
  PRIMARY KEY(changeId,assumptionId)
);
