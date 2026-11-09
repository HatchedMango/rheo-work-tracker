ALTER TABLE agent_connections ADD COLUMN completedAt INTEGER;
-- Preserve connections that were already verified under the previous flow.
UPDATE agent_connections SET completedAt = lastToolAt WHERE lastToolAt IS NOT NULL;
