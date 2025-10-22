-- Migration number: 0000   2025-10-21T19:44:00.000Z
-- Description: Create the initial scraper_logs table

DROP TABLE IF EXISTS scraper_logs;

CREATE TABLE scraper_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    request_id TEXT,
    level TEXT CHECK(level IN ('INFO', 'WARN', 'ERROR', 'DEBUG')) NOT NULL,
    message TEXT NOT NULL,
    url TEXT,
    prompt TEXT,
    selector TEXT,
    error_stack TEXT,
    details TEXT
);

CREATE INDEX IF NOT EXISTS idx_scraper_logs_timestamp ON scraper_logs (timestamp);
CREATE INDEX IF NOT EXISTS idx_scraper_logs_level ON scraper_logs (level);
CREATE INDEX IF NOT EXISTS idx_scraper_logs_request ON scraper_logs (request_id);
