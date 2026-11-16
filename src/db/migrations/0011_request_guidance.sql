ALTER TABLE human_actions ADD COLUMN guidance TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(guidance));
ALTER TABLE stream_context ADD COLUMN guidance TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(guidance));
