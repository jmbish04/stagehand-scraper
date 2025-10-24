-- Migration number: 0003   2025-10-25T00:00:00.000Z
-- Description: Add tables for requests, steps, assets, apps, and extend observations

CREATE TABLE IF NOT EXISTS scrape_requests (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  goal TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  schema_source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  outcome TEXT NOT NULL DEFAULT 'unknown',
  model_used TEXT,
  error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS request_steps (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  goal TEXT,
  current_url TEXT,
  thoughts TEXT,
  planned_action TEXT,
  expected_outcome TEXT,
  actual_outcome TEXT,
  action_payload TEXT,
  result_payload TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES scrape_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_request_steps_request ON request_steps (request_id);

CREATE TABLE IF NOT EXISTS request_step_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content BLOB,
  text_content TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES scrape_requests(id),
  FOREIGN KEY (step_id) REFERENCES request_steps(id)
);

CREATE INDEX IF NOT EXISTS idx_request_step_assets_step ON request_step_assets (step_id);

CREATE TABLE IF NOT EXISTS scrape_results (
  request_id TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  analysis TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES scrape_requests(id)
);

CREATE TABLE IF NOT EXISTS app_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  schema_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES app_categories(id)
);

CREATE TABLE IF NOT EXISTS app_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL,
  site_name TEXT,
  url TEXT,
  prompt_override TEXT,
  schema_override TEXT,
  interaction_rules TEXT,
  discovery_suggestions TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

ALTER TABLE agentic_observations ADD COLUMN agent_thoughts TEXT;
ALTER TABLE agentic_observations ADD COLUMN planned_action TEXT;
ALTER TABLE agentic_observations ADD COLUMN actual_action TEXT;
