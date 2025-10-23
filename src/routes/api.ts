import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { zValidator } from "@hono/zod-openapi";
import type { Bindings } from "../bindings";
import {
  enqueueOnDemandScrape,
  getRequestDetails,
  getRequestSummary,
  getStepAssets,
  runScrapeJob,
} from "../services/agent";
import { discoverUsefulSelectors, generateSchemaFromPrompt } from "../services/ai";
import { logEvent } from "../services/logger";
import { subscribeToRequestLogs } from "../services/realtime";
import { listRequestSteps, loadScrapeResult } from "../services/requestStore";
import { withBrowserPage } from "../services/browser";

export const OnDemandSchema = z.object({
  url: z.string().url(),
  goal: z.string().min(1),
  schema: z.record(z.any()).optional(),
  schema_prompt: z.string().optional(),
  rules: z.array(z.record(z.any())).optional(),
});

export const api = new Hono<{ Bindings: Bindings }>();

api.use("*", cors());

api.get("/openapi.json", c => {
  const spec = buildOpenApiDocument();
  return c.json(spec);
});

api.post("/test-schema", zValidator("json", z.object({ prompt: z.string().min(1) })), async c => {
  const { prompt } = c.req.valid("json");
  const schema = await generateSchemaFromPrompt(c.env, prompt);
  return c.json({ schema });
});

api.post("/scrape/ondemand", zValidator("json", OnDemandSchema), async c => {
  const body = c.req.valid("json");
  const schema = body.schema ?? (body.schema_prompt ? await generateSchemaFromPrompt(c.env, body.schema_prompt) : null);

  if (!schema) {
    return c.json({ error: "A schema or schema_prompt must be provided" }, 400);
  }

  const requestId = crypto.randomUUID();
  await enqueueOnDemandScrape(c.env, {
    id: requestId,
    url: body.url,
    goal: body.goal,
    schema: schema as Record<string, unknown>,
    schemaSource: body.schema ? "provided" : "generated",
  });

  c.executionCtx.waitUntil(runScrapeJob(c.env, {
    id: requestId,
    url: body.url,
    goal: body.goal,
    schema: schema as Record<string, unknown>,
    schemaSource: body.schema ? "provided" : "generated",
  }));

  const base = new URL(c.req.url);
  const monitorUrl = new URL(`/request.html?id=${requestId}`, base);
  const streamUrl = new URL(`/api/requests/${requestId}/stream`, base);
  const thoughtsUrl = new URL(`/api/requests/${requestId}/thoughts`, base);
  const dataUrl = new URL(`/api/requests/${requestId}/data`, base);

  const payload = {
    request_id: requestId,
    monitor_url: monitorUrl.toString(),
    stream_url: streamUrl.toString(),
    stream_curl: `curl ${streamUrl.toString()}`,
    thoughts_url: thoughtsUrl.toString(),
    thoughts_curl: `curl ${thoughtsUrl.toString()}`,
    data_url: dataUrl.toString(),
    data_curl: `curl ${dataUrl.toString()}`,
  };

  await logEvent(c.env, "INFO", "On-demand scrape enqueued", { requestId, url: body.url, prompt: body.goal });

  return c.json(payload);
});

api.get("/requests", async c => {
  const requests = await getRequestSummary(c.env);
  return c.json({ requests });
});

api.get("/requests/:id", async c => {
  const id = c.req.param("id");
  const data = await getRequestDetails(c.env, id);
  if (!data) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(data);
});

api.get("/requests/:id/data", async c => {
  const id = c.req.param("id");
  const result = await loadScrapeResult(c.env, id);
  if (!result) {
    return c.json({ error: "No data" }, 404);
  }
  return c.json({
    request_id: result.requestId,
    data: JSON.parse(result.resultJson),
    analysis: result.analysis,
  });
});

api.get("/requests/:id/thoughts", async c => {
  const id = c.req.param("id");
  const steps = await listRequestSteps(c.env, id);
  return c.json({ scrape_observations: steps });
});

api.get("/requests/:id/steps", async c => {
  const id = c.req.param("id");
  const steps = await listRequestSteps(c.env, id);
  return c.json({ steps });
});

api.get("/requests/:id/stream", async c => {
  const id = c.req.param("id");
  const { 0: client, 1: server } = new WebSocketPair();
  const url = new URL(c.req.url);
  const replay = url.searchParams.get("replay") === "true";

  server.accept();
  subscribeToRequestLogs(server, id);

  if (replay) {
    const logs = await c.env.DB.prepare(
      `SELECT timestamp, level, message, request_id as requestId, url, prompt, selector, details
       FROM scraper_logs WHERE request_id = ? ORDER BY datetime(timestamp)`
    )
      .bind(id)
      .all();
    for (const log of logs.results ?? []) {
      server.send(JSON.stringify(log));
    }
  }

  return new Response(null, { status: 101, webSocket: client });
});

api.get("/steps/:id/assets", async c => {
  const id = c.req.param("id");
  const assets = await getStepAssets(c.env, id);
  function toBase64(buffer: ArrayBuffer | null) {
    if (!buffer) return undefined;
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  const serialized = assets.map(asset => ({
    ...asset,
    content: toBase64(asset.content),
  }));

  return c.json({ assets: serialized });
});

api.get("/logs", async c => {
  const url = new URL(c.req.url);
  const requestId = url.searchParams.get("requestId") ?? undefined;
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  subscribeToRequestLogs(server, requestId);
  return new Response(null, { status: 101, webSocket: client });
});

api.get("/apps/categories", async c => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, description, created_at as createdAt FROM app_categories ORDER BY name`
  ).all();
  return c.json({ categories: rows.results ?? [] });
});

api.post("/apps/categories", zValidator("json", z.object({ name: z.string().min(1), description: z.string().optional() })), async c => {
  const body = c.req.valid("json");
  await c.env.DB.prepare(
    `INSERT INTO app_categories (name, description) VALUES (?, ?)`
  ).bind(body.name, body.description ?? null).run();
  return c.json({ ok: true });
});

api.get("/apps/category/:name", async c => {
  const name = c.req.param("name");
  const apps = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.title, a.description, a.prompt, a.schema_json as schemaJson
     FROM apps a
     INNER JOIN app_categories c ON c.id = a.category_id
     WHERE c.name = ?`
  )
    .bind(name)
    .all();
  return c.json({ apps: apps.results ?? [] });
});

api.get("/apps/:name", async c => {
  const name = c.req.param("name");
  const app = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.title, a.description, a.prompt, a.schema_json as schemaJson,
            cat.name as category, cat.description as categoryDescription
     FROM apps a
     INNER JOIN app_categories cat ON cat.id = a.category_id
     WHERE a.name = ?`
  )
    .bind(name)
    .first<{ id: number; name: string; title: string; description: string | null; prompt: string; schemaJson: string | null; category: string; categoryDescription: string | null }>();
  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  const sites = await c.env.DB.prepare(
    `SELECT id, site_name as siteName, url, prompt_override as promptOverride, schema_override as schemaOverride,
            interaction_rules as interactionRules, discovery_suggestions as discoverySuggestions,
            updated_at as updatedAt
     FROM app_sites WHERE app_id = ?`
  )
    .bind(app.id)
    .all();

  return c.json({
    app,
    sites: (sites.results ?? []).map(site => ({
      ...site,
      discoverySuggestions: site.discoverySuggestions ? JSON.parse(site.discoverySuggestions) : null,
    })),
  });
});

api.post("/apps/category/:name/apps", zValidator("json", z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  prompt: z.string().min(1),
  schema_json: z.record(z.any()).optional(),
})), async c => {
  const name = c.req.param("name");
  const body = c.req.valid("json");
  const category = await c.env.DB.prepare(
    `SELECT id FROM app_categories WHERE name = ?`
  ).bind(name).first<{ id: number }>();
  if (!category) {
    return c.json({ error: "Category not found" }, 404);
  }
  await c.env.DB.prepare(
    `INSERT INTO apps (category_id, name, title, description, prompt, schema_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      category.id,
      body.name,
      body.title,
      body.description ?? null,
      body.prompt,
      body.schema_json ? JSON.stringify(body.schema_json) : null,
    )
    .run();
  return c.json({ ok: true });
});

api.post("/apps/:name", zValidator("json", z.object({
  prompt: z.string().min(1),
  schema_json: z.record(z.any()).optional(),
})), async c => {
  const name = c.req.param("name");
  const body = c.req.valid("json");
  await c.env.DB.prepare(
    `UPDATE apps SET prompt = ?, schema_json = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?`
  )
    .bind(body.prompt, body.schema_json ? JSON.stringify(body.schema_json) : null, name)
    .run();
  return c.json({ ok: true });
});

api.post("/apps/run/:name", zValidator("json", z.object({
  url: z.string().url().optional(),
  goal: z.string().optional(),
  schema: z.record(z.any()).optional(),
})), async c => {
  const name = c.req.param("name");
  const body = c.req.valid("json");
  const app = await c.env.DB.prepare(
    `SELECT a.prompt, a.schema_json as schemaJson, s.url as defaultUrl
     FROM apps a
     LEFT JOIN app_sites s ON s.app_id = a.id
     WHERE a.name = ?
     LIMIT 1`
  )
    .bind(name)
    .first<{ prompt: string; schemaJson: string | null; defaultUrl: string | null }>();
  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  const url = body.url ?? app.defaultUrl;
  if (!url) {
    return c.json({ error: "No URL provided" }, 400);
  }

  const schemaJson = body.schema ?? (app.schemaJson ? JSON.parse(app.schemaJson) : null);
  if (!schemaJson) {
    return c.json({ error: "App is missing a schema" }, 400);
  }

  const requestId = crypto.randomUUID();
  await enqueueOnDemandScrape(c.env, {
    id: requestId,
    url,
    goal: body.goal ?? app.prompt,
    schema: schemaJson,
    schemaSource: body.schema ? "provided" : "generated",
  });

  c.executionCtx.waitUntil(runScrapeJob(c.env, {
    id: requestId,
    url,
    goal: body.goal ?? app.prompt,
    schema: schemaJson,
    schemaSource: body.schema ? "provided" : "generated",
  }));

  return c.json({ request_id: requestId });
});

api.post("/apps/discovery/:siteId", async c => {
  const siteId = Number.parseInt(c.req.param("siteId"), 10);
  if (Number.isNaN(siteId)) {
    return c.json({ error: "Invalid site id" }, 400);
  }

  const site = await c.env.DB.prepare(
    `SELECT s.id, s.url, s.prompt_override as promptOverride, a.prompt as defaultPrompt
     FROM app_sites s
     INNER JOIN apps a ON a.id = s.app_id
     WHERE s.id = ?`
  )
    .bind(siteId)
    .first<{ id: number; url: string; promptOverride: string | null; defaultPrompt: string }>();

  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  try {
    const suggestions = await withBrowserPage(c.env, async page => {
      await page.goto(site.url, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(2000);
      const pageText: string = await page.evaluate(() => document.body?.innerText ?? "");
      const pageHtml: string = await page.content();
      const result = await discoverUsefulSelectors(c.env, {
        goal: site.promptOverride ?? site.defaultPrompt,
        pageUrl: page.url(),
        pageText,
        pageHtml,
      });
      return result;
    });

    await c.env.DB.prepare(
      `UPDATE app_sites SET discovery_suggestions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
      .bind(JSON.stringify(suggestions), siteId)
      .run();

    return c.json({ suggestions });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

export function buildOpenApiDocument() {
  const baseSchema = {
    openapi: "3.1.0",
    info: {
      title: "Stagehand Scraper API",
      version: "1.0.0",
      description: "Autopilot scraping worker API",
    },
    paths: {
      "/api/scrape/ondemand": {
        post: {
          summary: "Trigger an on-demand scrape",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string", format: "uri" },
                    goal: { type: "string" },
                    schema: { type: "object" },
                    schema_prompt: { type: "string" },
                  },
                  required: ["url", "goal"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Request accepted",
            },
          },
        },
      },
      "/api/requests": {
        get: {
          summary: "List recent requests",
          responses: {
            "200": {
              description: "Recent request summary",
            },
          },
        },
      },
      "/api/requests/{id}": {
        get: {
          summary: "Fetch request detail",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Detailed request" },
          },
        },
      },
      "/api/requests/{id}/data": {
        get: {
          summary: "Download extracted data",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Data payload" },
          },
        },
      },
      "/api/apps/category/{category}": {
        get: {
          summary: "List apps by category",
          parameters: [
            { name: "category", in: "path", required: true, schema: { type: "string" } },
          ],
        },
      },
      "/api/apps/{name}": {
        get: {
          summary: "Retrieve an app configuration",
          parameters: [
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
        },
        post: {
          summary: "Update an app configuration",
          parameters: [
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
        },
      },
      "/api/apps/run/{name}": {
        post: {
          summary: "Launch an app-configured scrape",
          parameters: [
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
        },
      },
    },
  };
  return baseSchema;
}
