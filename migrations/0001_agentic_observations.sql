-- Migration number: 0001   2025-10-22T00:00:00.000Z
-- Description: Create agentic_observations table for learning by URL pattern

CREATE TABLE IF NOT EXISTS agentic_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  request_id TEXT,
  url TEXT,                 -- full url observed
  url_pattern TEXT NOT NULL, -- normalized/patterned hostname+path (e.g., example.com/products/*)
  action_type TEXT NOT NULL, -- waitForSelector|click|type|navigate|none
  selector TEXT,
  text TEXT,
  navigate_url TEXT,
  goal TEXT,                -- high-level goal provided by user
  achieved INTEGER,         -- 1 true / 0 false at time of logging
  confidence REAL,          -- optional confidence 0..1
  outcome TEXT,             -- success|fail|partial
  reason TEXT,              -- model reasoning/notes
  page_title TEXT,
  page_style TEXT,
  page_groups TEXT,         -- JSON string of groups
  extracted_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_obs_pattern ON agentic_observations (url_pattern);
CREATE INDEX IF NOT EXISTS idx_obs_time ON agentic_observations (timestamp);
CREATE INDEX IF NOT EXISTS idx_obs_request ON agentic_observations (request_id);

