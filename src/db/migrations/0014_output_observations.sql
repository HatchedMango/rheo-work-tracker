-- Observations never replace an agent output report or change work progress.
CREATE TABLE output_observations (
  id TEXT PRIMARY KEY,
  outputId TEXT NOT NULL REFERENCES change_outputs(id) ON DELETE CASCADE,
  outputRevision INTEGER NOT NULL,
  checkedBy TEXT NOT NULL REFERENCES actors(id),
  checkedAt INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source='gitlab'),
  status TEXT NOT NULL CHECK(status IN ('observed','unavailable')),
  mrState TEXT,
  codeRevision TEXT,
  pipelineStatus TEXT,
  message TEXT NOT NULL
);
CREATE INDEX output_observations_latest ON output_observations(outputId, checkedAt DESC);
