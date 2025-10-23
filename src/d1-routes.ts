import { Hono } from 'hono';
import { z } from 'zod';
// Assuming 'Env' includes your D1, AI, R2, BROWSER bindings
// type Env = {...}

const app = new Hono<{ Bindings: Env }>();

// === App Configuration Routes ===

const appRoutes = new Hono<{ Bindings: Env }>();

// -- Categories --
appRoutes.get('/categories', async (c) => {
  // Fetch all categories from use_case_categories
  // const categories = await c.env.DB.prepare("SELECT * FROM use_case_categories").all();
  return c.json({ /* categories */ });
});

appRoutes.post('/categories', async (c) => {
  // const body = await c.req.json();
  // Validate body: { name: string, description?: string, icon?: string }
  // Insert into use_case_categories
  return c.json({ /* new category */ }, 201);
});

appRoutes.get('/categories/:categoryId', async (c) => {
    // const categoryId = c.req.param('categoryId');
    // Fetch specific category
    return c.json({ /* category */ });
});

appRoutes.put('/categories/:categoryId', async (c) => {
    // const categoryId = c.req.param('categoryId');
    // const body = await c.req.json();
    // Validate body: { name?: string, description?: string, icon?: string }
    // Update category
    return c.json({ /* updated category */ });
});

appRoutes.delete('/categories/:categoryId', async (c) => {
    // const categoryId = c.req.param('categoryId');
    // Delete category (consider cascade)
    return c.body(null, 204);
});


// -- Apps --
appRoutes.get('/category/:categoryId/apps', async (c) => {
  // const categoryId = c.req.param('categoryId');
  // Fetch apps within a category
  return c.json({ /* apps */ });
});

appRoutes.post('/category/:categoryId/apps', async (c) => {
  // const categoryId = c.req.param('categoryId');
  // const body = await c.req.json();
  // Validate body: { name: string, description?: string, icon?: string, default_prompt?: string, ... }
  // Insert into scrape_apps
  return c.json({ /* new app */ }, 201);
});

appRoutes.get('/apps/:appId', async (c) => {
    // const appId = c.req.param('appId');
    // Fetch specific app details (potentially join with sites)
    return c.json({ /* app details */ });
});

appRoutes.put('/apps/:appId', async (c) => {
    // const appId = c.req.param('appId');
    // const body = await c.req.json();
    // Validate body
    // Update scrape_apps
    return c.json({ /* updated app */ });
});

appRoutes.delete('/apps/:appId', async (c) => {
    // const appId = c.req.param('appId');
    // Delete app (consider cascade)
    return c.body(null, 204);
});

// -- Sites within Apps --
appRoutes.get('/apps/:appId/sites', async (c) => {
    // const appId = c.req.param('appId');
    // Fetch all sites for an app
    return c.json({ /* sites */ });
});

appRoutes.post('/apps/:appId/sites', async (c) => {
    // const appId = c.req.param('appId');
    // const body = await c.req.json();
    // Validate body: { name: string, url: string, override_prompt?: string, ... }
    // Insert into app_sites
    return c.json({ /* new site */ }, 201);
});

appRoutes.get('/sites/:siteId', async (c) => {
    // const siteId = c.req.param('siteId');
    // Fetch specific site details (potentially join with dom_elements)
    return c.json({ /* site details */ });
});

appRoutes.put('/sites/:siteId', async (c) => {
    // const siteId = c.req.param('siteId');
    // const body = await c.req.json();
    // Validate body
    // Update app_sites
    return c.json({ /* updated site */ });
});

appRoutes.delete('/sites/:siteId', async (c) => {
    // const siteId = c.req.param('siteId');
    // Delete site
    return c.body(null, 204);
});

// -- DOM Elements for Sites --
appRoutes.get('/sites/:siteId/dom-elements', async (c) => {
    // const siteId = c.req.param('siteId');
    // Fetch DOM elements for a site
    return c.json({ /* elements */ });
});

appRoutes.post('/sites/:siteId/dom-elements', async (c) => {
    // const siteId = c.req.param('siteId');
    // const body = await c.req.json();
    // Validate body: { selector: string, description?: string, interaction_rule?: string }
    // Insert into dom_elements
    return c.json({ /* new element */ }, 201);
});

// Endpoint for Agent Discovery of DOM elements
appRoutes.post('/sites/:siteId/dom-elements/discover', async (c) => {
    // const siteId = c.req.param('siteId');
    // Fetch site URL
    // Trigger a specific agentic task (using /judge logic?) with goal to identify key elements
    // Parse agent output, save suggestions to dom_elements with discovered_by_agent = 1
    return c.json({ /* discovered elements */ });
});

appRoutes.put('/dom-elements/:elementId', async (c) => {
    // const elementId = c.req.param('elementId');
    // const body = await c.req.json();
    // Validate body
    // Update dom_elements
    return c.json({ /* updated element */ });
});

appRoutes.delete('/dom-elements/:elementId', async (c) => {
    // const elementId = c.req.param('elementId');
    // Delete dom_element
    return c.body(null, 204);
});


// === Scraping Execution Routes ===

const scrapeRoutes = new Hono<{ Bindings: Env }>();

// On-Demand Scrape
scrapeRoutes.post('/ondemand', async (c) => {
  // const body = await c.req.json();
  // Validate: url, goal, (schema | schema_prompt), rules?
  const requestId = crypto.randomUUID(); // Generate UUID

  // 1. Generate Schema if schema_prompt provided
  let schemaJson = "{ \"type\": \"object\" }"; // Default/fallback
  // if (body.schema_prompt) { ... call schemaGen ... schemaJson = ... }
  // else if (body.schema) { schemaJson = JSON.stringify(body.schema); }

  // 2. Insert into scrape_requests
  // await c.env.DB.prepare("INSERT INTO scrape_requests (id, on_demand_url, on_demand_prompt, on_demand_schema_json, status) VALUES (?, ?, ?, ?, ?)")
  //   .bind(requestId, body.url, body.goal, schemaJson, 'queued')
  //   .run();

  // 3. Trigger the actual scraping task (e.g., via a Queue or just async call)
   ctx.waitUntil(runScrapeTask(c.env, requestId, { type: 'ondemand', /* pass necessary details */ }));

  // 4. Construct response URLs
  const baseUrl = new URL(c.req.url).origin;
  const response = {
    request_id: requestId,
    monitor_url: `${baseUrl}/requests/${requestId}`, // Frontend URL
    stream_url: `${baseUrl}/api/requests/${requestId}/stream`, // API URL
    stream_curl: `curl -N "${baseUrl}/api/requests/${requestId}/stream"`, // Example
    thoughts_url: `${baseUrl}/api/requests/${requestId}/thoughts`,
    thoughts_curl: `curl "${baseUrl}/api/requests/${requestId}/thoughts"`,
    data_url: `${baseUrl}/api/requests/${requestId}/data`,
    data_curl: `curl "${baseUrl}/api/requests/${requestId}/data"`,
  };

  return c.json(response, 202); // Accepted
});

// Run Scrape via App Config
scrapeRoutes.post('/apps/:appName/run', async (c) => {
  // const appName = c.req.param('appName');
  // const body = await c.req.json(); // Contains overrides like sites_to_skip, sites_to_add, prompt_override, etc.
  const requestId = crypto.randomUUID();

  // 1. Fetch app config (default prompt, schema, sites)
  // const appConfig = await c.env.DB.prepare("...").bind(appName).first();
  // if (!appConfig) return c.json({ error: 'App not found' }, 404);
  // const sites = await c.env.DB.prepare("...").bind(appConfig.id).all();

  // 2. Apply overrides from body
  const runConfig = { /* Determine final config based on app defaults + body overrides */ };

  // 3. Insert into scrape_requests
  // await c.env.DB.prepare("INSERT INTO scrape_requests (id, app_id, app_run_config, status) VALUES (?, ?, ?, ?)")
  //   .bind(requestId, appConfig.id, JSON.stringify(runConfig), 'queued')
  //   .run();

  // 4. Trigger the actual scraping task(s) (potentially one task per site)
  ctx.waitUntil(runScrapeTask(c.env, requestId, { type: 'app', /* pass necessary details */ }));

  // 5. Construct response URLs (similar to ondemand)
  const baseUrl = new URL(c.req.url).origin;
  const response = {
     request_id: requestId,
     monitor_url: `${baseUrl}/requests/${requestId}`, // Frontend URL
     // ... other URLs ...
   };
  return c.json(response, 202); // Accepted
});


// === Request Status & Data Routes ===

const requestRoutes = new Hono<{ Bindings: Env }>();

// Get overall request status and basic info
requestRoutes.get('/:requestId/status', async (c) => {
    // const requestId = c.req.param('requestId');
    // Fetch from scrape_requests
    return c.json({ /* status info */ });
});

// Get detailed steps for a request (agentic_observations or request_steps)
requestRoutes.get('/:requestId/steps', async (c) => {
    // const requestId = c.req.param('requestId');
    // Fetch steps, maybe join with assets
    return c.json({ /* steps */ });
});

// Get specific asset for a step
requestRoutes.get('/steps/:stepId/assets/:assetType', async (c) => {
    // const stepId = c.req.param('stepId');
    // const assetType = c.req.param('assetType');
    // Fetch asset reference from step_assets
    // Retrieve from R2 or D1 blob based on storage_type/ref
    // Return the asset content (e.g., Response with correct content-type)
    return new Response(/* asset content */);
});

// Stream WebSocket logs (historical if request finished, maybe live proxy?)
requestRoutes.get('/:requestId/stream', async (c) => {
  // const requestId = c.req.param('requestId');
  // For simplicity, fetch historical logs from scraper_logs
  // For live, this would need to proxy to the WebSocket logic or use a different mechanism
  // const logs = await c.env.DB.prepare("SELECT * FROM scraper_logs WHERE request_id = ? ORDER BY timestamp ASC").bind(requestId).all();
  // Format logs as Server-Sent Events (SSE) or newline-delimited JSON
  return new Response(/* Streamed logs */);
});

// Get agent thoughts/observations + final analysis
requestRoutes.get('/:requestId/thoughts', async (c) => {
  // const requestId = c.req.param('requestId');
  // Fetch from agentic_observations or request_steps
  // const observations = await c.env.DB.prepare("...").bind(requestId).all();

  // Optional: Run a final AI analysis pass over the observations/logs
  let analysis = "Analysis not yet implemented.";
  // try {
  //   const analysisPrompt = `Analyze the following scrape observations for request ${requestId} and provide a summary...`;
  //   const aiResponse = await c.env.AI.run('@cf/...', { prompt: analysisPrompt + JSON.stringify(observations) });
  //   analysis = aiResponse.response;
  // } catch (e) { analysis = "Failed to generate AI analysis."; }

  return c.json({
    scrape_observations: observations.results,
    overall_ai_analysis: analysis
  });
});

// Get final extracted data
requestRoutes.get('/:requestId/data', async (c) => {
  // const requestId = c.req.param('requestId');
  // Fetch from extracted_data
  // const dataRecord = await c.env.DB.prepare("SELECT data, schema_json FROM extracted_data WHERE request_id = ?").bind(requestId).first();
  // if (!dataRecord) return c.json({ error: 'Data not found or not yet extracted' }, 404);
  return c.json({
      schema: JSON.parse(dataRecord.schema_json),
      data: JSON.parse(dataRecord.data)
  });
});


// === Main Application Setup ===

// Mount the sub-apps
app.route('/api/apps', appRoutes);
app.route('/api/scrape', scrapeRoutes);
app.route('/api/requests', requestRoutes);

// Add OpenAPI endpoint (could use hono/zod-openapi for auto-generation)
app.get('/openapi.json', (c) => {
    // Manually construct or dynamically generate OpenAPI spec based on routes
    const openapiSpec = { /* ... OpenAPI JSON ... */ };
    return c.json(openapiSpec);
});

// WebSocket route (handled by the main fetch handler in index.ts)
// app.get('/logs', ...) // This logic stays in the main export default fetch

// Frontend serving (handled by ASSETS binding in main fetch handler)
// app.get('/*', ...)

export default app;

// Dummy function to represent the background task execution
async function runScrapeTask(env: Env, requestId: string, config: any) {
  console.log(`Starting scrape task ${requestId}`, config);
  // This function would contain the core logic to:
  // 1. Determine if it's ondemand or app-based
  // 2. Fetch relevant config (prompt, schema, sites, rules)
  // 3. Iterate through sites if it's an app run
  // 4. For each site/URL, invoke the agentic loop (e.g., runEvaluatorOptimizer)
  // 5. Update scrape_requests, request_steps, step_assets, extracted_data as the agent runs
  // 6. Update final status in scrape_requests
  // Remember to pass the requestId and step tracking logic into the agent loop.
  // Use env.DB, env.AI, env.BROWSER, env.R2 as needed.
  // Use logToD1 and broadcastToConnections within the agent loop.
  await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate work
  console.log(`Finished scrape task ${requestId}`);
}
