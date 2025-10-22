# Stagehand Scraper – Implementation Plan

## Endpoints
- POST `/stagehand`
  - Original Stagehand scraping flow.
  - Uses shared natural-language schema generation.
  - Returns `{ request_id, data, schemaUsed, schemaGenError?, logs }`.

- POST `/judge`
  - Llama 4–based agentic orchestrator loop.
  - Tools exposed to the model:
    - `browser_navigate_to_url(url)`
    - `browser_click_element(selector)`
    - `browser_type_text(selector, text)`
    - `browser_wait_for_selector(selector, timeout?)`
    - `browser_get_page_content(mode: 'html'|'text'|'both')`
    - `browser_take_screenshot()`
    - `analyze_screenshot(image_base64, html_snippet?)` → returns `{ style, groups, extractedText }`
    - `request_deeper_analysis(objective, visual_description, extracted_content?)` → @cf/openai/gpt-oss-120b
    - `get_observations_for_pattern(url_pattern, limit?)` → D1
    - `log_observation(observation)` → D1
    - `log_line(level, message, details?)` → D1 logs
  - Judge prompt includes goal, URL, first chunk of HTML, and HistoricalHints from observations.
  - Returns `{ request_id, result, logs }`.

- POST `/json-extract-api`
  - Proxy to Cloudflare Browser Rendering JSON extraction API.
  - Input `{ url, prompt, schema?, response_format? }`.
  - If `schema`/`response_format` absent → auto-generate JSON Schema from natural language via shared utility.
  - Returns `{ request_id, cloudflare: <api_result>, inferredSchema?, logs }`.

- GET `/logs` (WebSocket)
  - Streams logs; supports `?request_id=...` filter.

- GET `/openapi.json`
  - Dynamic OpenAPI for endpoints.

- GET `/docs`
  - Swagger UI (served via ASSETS/public).

## Shared Schema Utility
File: `src/utils/schemaGen.ts`
- `describeFields(env, prompt)` → returns array of field descriptions via Workers AI structured tool.
- `zodFromDescription(desc)` → builds Zod schema for Stagehand extract.
- `jsonSchemaFromDescription(desc)` → converts field descriptions to JSON Schema.

## Judge (Llama 4) Flow
1. Build context: goal, URL, HTML snippet, HistoricalHints (from D1 observations for URL pattern).
2. Llama 4 returns structured JSON (achieved, confidence, reason, pageAnalysis, nextAction) or function calls using tools above.
3. If screenshot required, Llama 4 can consume image or call `analyze_screenshot` for structured style/groupings/extractedText.
4. For complex planning, Llama 4 tool-calls `request_deeper_analysis`, which invokes `@cf/openai/gpt-oss-120b` with textual inputs only, and then continues plan.
5. After each step, write observation row to `agentic_observations` with URL pattern, action, outcome, confidence, and notes.

## Observations Learning
- Table: `agentic_observations` (see migrations/0001).
- Prior rows for a URL pattern are summarized into HistoricalHints: top actions/selectors, recent success rate.
- Hints are injected into judge prompt each iteration.

## UI
- `/` logs page auto-follows current request; supports clicking prior requests (uses `?request_id=`).
- `/docs` shows API docs via Swagger UI.

## Configuration & Secrets
- Uses `env.DB` (D1), `env.AI` (Workers AI), `env.BROWSER` (Browser Rendering playground binding), ASSETS for static files.
- `/json-extract-api` uses `env.CLOUDFLARE_API_TOKEN`, `env.CLOUDFLARE_ACCOUNT_ID`.

## Deliverables
- New endpoints and utilities wired into `src/index.ts`.
- New `src/utils/schemaGen.ts` utility.
- Updated OpenAPI and static docs page.
- Observations integrated with judge and available for future surfacing.

