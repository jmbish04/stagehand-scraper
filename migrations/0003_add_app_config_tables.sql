-- Migration: 0003_add_app_config_tables.sql
-- Description: Add tables for managing scrape use cases, apps, sites, and configurations.

-- Stores categories for organizing scraping apps (e.g., Travel, Job Search)
CREATE TABLE IF NOT EXISTS use_case_categories (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), -- UUID
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT, -- Optional: identifier for a frontend icon
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Stores individual scraping applications/use cases (e.g., Flight Search, Cloudflare Jobs)
CREATE TABLE IF NOT EXISTS scrape_apps (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), -- UUID
    category_id TEXT NOT NULL REFERENCES use_case_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT, -- Optional: identifier for a frontend icon
    default_prompt TEXT, -- Default prompt for all sites in this app
    default_schema_prompt TEXT, -- Natural language for default schema
    default_schema_json TEXT, -- Default JSON schema (generated or provided)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Stores specific websites configured within an app
CREATE TABLE IF NOT EXISTS app_sites (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), -- UUID
    app_id TEXT NOT NULL REFERENCES scrape_apps(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- User-friendly name (e.g., "Cloudflare Careers")
    url TEXT NOT NULL UNIQUE,
    override_prompt TEXT, -- Site-specific prompt override
    override_schema_prompt TEXT, -- Site-specific schema prompt override
    override_schema_json TEXT, -- Site-specific JSON schema override
    wait_for_selector TEXT, -- Optional: Default selector to wait for
    is_enabled INTEGER DEFAULT 1 NOT NULL CHECK(is_enabled IN (0, 1)), -- Boolean flag
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Stores specific DOM elements identified for a site (potentially by agent discovery)
CREATE TABLE IF NOT EXISTS dom_elements (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), -- UUID
    site_id TEXT NOT NULL REFERENCES app_sites(id) ON DELETE CASCADE,
    selector TEXT NOT NULL, -- CSS selector
    description TEXT, -- What this element represents (e.g., "Main job list container", "Next page button")
    interaction_rule TEXT, -- Optional: Specific instruction (e.g., "click to load more", "wait until visible")
    discovered_by_agent INTEGER DEFAULT 0 NOT NULL CHECK(discovered_by_agent IN (0, 1)), -- Boolean flag
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(site_id, selector)
);

-- Add indices for faster lookups
CREATE INDEX IF NOT EXISTS idx_scrape_apps_category_id ON scrape_apps (category_id);
CREATE INDEX IF NOT EXISTS idx_app_sites_app_id ON app_sites (app_id);
CREATE INDEX IF NOT EXISTS idx_dom_elements_site_id ON dom_elements (site_id);
