-- Migration number: 0002   2025-10-22T05:00:00.000Z
-- Description: Add model_used column to scraper_logs table

ALTER TABLE scraper_logs ADD COLUMN model_used TEXT;
