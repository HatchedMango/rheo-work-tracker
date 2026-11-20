ALTER TABLE workflow_sessions ADD COLUMN intent TEXT NOT NULL DEFAULT 'working' CHECK (intent IN ('reading','working'));
