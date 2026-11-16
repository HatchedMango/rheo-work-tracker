CREATE TABLE daily_progress_preferences (
 id TEXT PRIMARY KEY CHECK(id='local'),
 target INTEGER NOT NULL DEFAULT 5 CHECK(target BETWEEN 1 AND 1000),
 revision INTEGER NOT NULL DEFAULT 1
);
INSERT INTO daily_progress_preferences(id) VALUES ('local');

-- One durable credit per change. Reopening never creates another completion.
CREATE TABLE change_completions (
 workId TEXT PRIMARY KEY REFERENCES work(id),
 completedAt INTEGER NOT NULL CHECK(completedAt>=0),
 milestone TEXT NOT NULL CHECK(milestone IN ('delivered','completed'))
);
CREATE INDEX change_completions_date ON change_completions(completedAt,workId);

-- Recover the earliest explicit completion evidence, including older delivery
-- timestamps retained in a later reopening event. Do not invent missing dates.
WITH candidates(workId,completedAt,milestone) AS (
 SELECT workId,createdAt,'delivered' FROM events
 WHERE type='tracking_updated'
   AND CASE WHEN json_valid(data) THEN json_extract(data,'$.after.progress') END='delivered'
 UNION ALL
 SELECT workId,json_extract(data,'$.before.deliveredAt'),'delivered' FROM events
 WHERE type='tracking_updated' AND CASE WHEN json_valid(data) THEN json_type(data,'$.before.deliveredAt') END='integer'
 UNION ALL
 SELECT workId,createdAt,'completed' FROM events
 WHERE type IN ('complete','approve','relayed_complete','relayed_approve')
 UNION ALL
 SELECT workId,deliveredAt,'delivered' FROM change_meta WHERE deliveredAt IS NOT NULL
), ranked AS (
 SELECT workId,completedAt,milestone,ROW_NUMBER() OVER (PARTITION BY workId ORDER BY completedAt,milestone) AS ordinal
 FROM candidates WHERE completedAt>=0
)
INSERT INTO change_completions(workId,completedAt,milestone)
 SELECT workId,completedAt,milestone FROM ranked WHERE ordinal=1;

CREATE TRIGGER change_first_delivery AFTER UPDATE OF deliveredAt ON change_meta
WHEN NEW.deliveredAt IS NOT NULL AND OLD.deliveredAt IS NULL
BEGIN
 INSERT OR IGNORE INTO change_completions(workId,completedAt,milestone) VALUES (NEW.workId,NEW.deliveredAt,'delivered');
END;
CREATE TRIGGER change_inserted_delivery AFTER INSERT ON change_meta
WHEN NEW.deliveredAt IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO change_completions(workId,completedAt,milestone) VALUES (NEW.workId,NEW.deliveredAt,'delivered');
END;
CREATE TRIGGER change_first_manual_completion AFTER UPDATE OF lifecycle ON work
WHEN NEW.lifecycle='completed' AND OLD.lifecycle!='completed'
BEGIN
 INSERT OR IGNORE INTO change_completions(workId,completedAt,milestone) VALUES (NEW.id,NEW.updatedAt,'completed');
END;
