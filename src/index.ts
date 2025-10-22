import { Stagehand } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { z } from "zod";
import { createStructuredResponseTool } from "./tools"; // Import the factory
import { WorkersAIClient } from "./workersAIClient";
import { runEvaluatorOptimizer } from "./evaluatorOptimizer";
import { describeFields, zodFromDescription, zodFromDescriptionForStagehand } from "./utils/schemaGen";

// --- Input Validation ---
const requestBodySchema = z.object({
  url: z.string().url("Invalid URL provided"),
  prompt: z.string().min(1, "Prompt cannot be empty"),
  waitForSelector: z.string().optional(),
});

// --- Schema Generation Schemas ---

// Define the structure we expect the AI to return when describing a schema field
const fieldDescriptionSchema = z.object({
  name: z.string().describe("The name of the field (key) in the JSON object."),
  type: z.enum(["string", "number", "boolean", "array", "object", "unknown"])
    .describe("The data type of the field. Use 'unknown' if unsure."),
  description: z.string().optional().describe("A brief description of what the field represents."),
});

// Define the schema for the AI's overall schema description output
const schemaDescriptionSchema = z.array(fieldDescriptionSchema)
  .describe("An array of objects, where each object describes a field in the desired JSON structure.");

// --- Helper Function to Build Zod Schema ---

/**
 * Dynamically builds a Zod schema (specifically z.array(z.object({...})))
 * based on the description provided by the AI.
 */
function buildSchemaFromDescription(
  description: z.infer<typeof schemaDescriptionSchema>
): z.ZodArray<z.ZodObject<any>> { // Explicitly type the return
  if (!Array.isArray(description) || description.length === 0) {
    // Fallback to a generic schema if description is invalid or empty
    console.warn("Invalid or empty schema description received, falling back to generic array of objects schema.");
    // *** UPDATED FALLBACK HERE ***
    return z.array(z.object({})) // Return array of empty objects
      .describe("Generic fallback: An array of objects with undefined structure.");
  }

  const objectShape: Record<string, z.ZodTypeAny> = {};

  description.forEach(field => {
    let fieldSchema: z.ZodTypeAny;
    switch (field.type) {
      case "string":
        fieldSchema = z.string();
        break;
      case "number":
        fieldSchema = z.number();
        break;
      case "boolean":
        fieldSchema = z.boolean();
        break;
      case "array":
        // Basic array, assuming array of unknowns for simplicity.
        fieldSchema = z.array(z.unknown());
        break;
      case "object":
         // Basic object, assuming record of unknowns for simplicity.
        fieldSchema = z.record(z.string(), z.unknown());
        break;
      default: // 'unknown' or other unexpected types
        fieldSchema = z.unknown();
        break;
    }
    // Add description if provided
    if (field.description) {
      fieldSchema = fieldSchema.describe(field.description);
    }
    // Make fields optional for robustness, as AI might miss fields on some items
    objectShape[field.name] = fieldSchema.optional();
  });

  // Ensure we return the correct type
  const finalSchema = z.array(z.object(objectShape))
        .describe("Dynamically generated schema: An array of objects.");

  return finalSchema;
}


// --- Worker Fetch Handler ---

// --- D1 Logging Helper ---
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

interface LogDetails {
  message: string;
  request_id?: string;
  url?: string;
  prompt?: string;
  selector?: string;
  error_stack?: string;
  details?: string;
  modelUsed?: string;
}

// --- WebSocket Broadcasting ---
interface WebSocketConnection {
  server: WebSocket;
  requestId?: string;
}

// Global WebSocket connections storage
const activeConnections = new Map<string, WebSocketConnection[]>();

function broadcastToConnections(requestId: string, message: any) {
  const connections = activeConnections.get(requestId) || [];
  const allConnections = activeConnections.get('*') || []; // Global listeners
  
  [...connections, ...allConnections].forEach(conn => {
    try {
      conn.server.send(JSON.stringify(message));
    } catch (e) {
      // Connection might be closed, remove it
      console.warn('Failed to send WebSocket message:', e);
    }
  });
}

function addWebSocketConnection(server: WebSocket, requestId?: string) {
  const key = requestId || '*';
  if (!activeConnections.has(key)) {
    activeConnections.set(key, []);
  }
  activeConnections.get(key)!.push({ server, requestId });
  
  // Clean up on close
  server.addEventListener('close', () => {
    const connections = activeConnections.get(key);
    if (connections) {
      const index = connections.findIndex(conn => conn.server === server);
      if (index >= 0) {
        connections.splice(index, 1);
        if (connections.length === 0) {
          activeConnections.delete(key);
        }
      }
    }
  });
}

// Helper function to convert UTC to PST
function toPSTString(date: Date): string {
  return date.toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)/, '$3-$1-$2 $4:$5:$6');
}

async function logToD1(db: D1Database | undefined, level: LogLevel, logData: LogDetails) {
  if (!db) {
    console.error(`[${level}] (DB unavailable) ${logData.message}`, logData.details || logData.error_stack || '');
    return;
  }
  switch (level) {
    case 'ERROR':
      console.error(`[${level}] ${logData.message}`, logData.details || logData.error_stack || '');
      break;
    case 'WARN':
      console.warn(`[${level}] ${logData.message}`, logData.details || '');
      break;
    default:
      console.log(`[${level}] ${logData.message}`, logData.details || '');
      break;
  }
  try {
    const stmt = db.prepare(
      `INSERT INTO scraper_logs (timestamp, request_id, level, message, url, prompt, selector, error_stack, details, model_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await stmt
      .bind(
        toPSTString(new Date()), // PST timestamp
        logData.request_id ?? null,
        level,
        logData.message,
        logData.url ?? null,
        logData.prompt ?? null,
        logData.selector ?? null,
        logData.error_stack ?? null,
        logData.details ?? null,
        logData.modelUsed ?? null,
      )
      .run();
  } catch (dbError: any) {
    console.error("Failed to log to D1", dbError);
    console.error(`[${level}] (D1 log failed) ${logData.message}`, logData);
  }
}

async function fetchRecentLogs(db: D1Database | undefined, limit = 100, requestId?: string) {
  if (!db) return [] as any[];
  try {
    const base = `SELECT id, timestamp, request_id, level, message, url, prompt, selector, error_stack, details, model_used FROM scraper_logs`;
    const where = requestId ? ` WHERE request_id = ?` : '';
    const sql = `${base}${where} ORDER BY id DESC LIMIT ?`;
    const stmt = db.prepare(sql);
    const { results } = requestId ? await stmt.bind(requestId, limit).all() : await stmt.bind(limit).all();
    return results ?? [];
  } catch (e) {
    console.error('Failed to fetch recent logs', e);
    return [];
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const urlObj = new URL(request.url);

    const db = env.DB;
    // Check for custom requestId in request body for POST requests
    let requestId = crypto.randomUUID();
    if (request.method === 'POST') {
      try {
        const body = await request.clone().json().catch(() => ({})) as any;
        if (body.requestId && typeof body.requestId === 'string') {
          requestId = body.requestId;
        }
      } catch {
        // Ignore JSON parsing errors, use generated UUID
      }
    }
    
    const log = (level: LogLevel, data: LogDetails) => {
      const logData = { request_id: requestId, ...data };
      ctx.waitUntil(logToD1(db, level, logData));
      
      // Broadcast to WebSocket connections for real-time updates
      broadcastToConnections(requestId, {
        type: 'log',
        data: {
          timestamp: toPSTString(new Date()),
          level,
          ...logData
        }
      });
    };

    // Track request status for the requests list
    const updateRequestStatus = (status: 'running' | 'completed' | 'failed', result?: any, error?: string) => {
      broadcastToConnections(requestId, {
        type: 'request_status',
        request_id: requestId,
        status,
        result,
        error,
        timestamp: toPSTString(new Date())
      });
    };

    // Observations API endpoints
    if (urlObj.pathname === '/observations/patterns') {
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
      try {
        const { results } = await db.prepare(`
          SELECT 
            url_pattern,
            COUNT(*) as total,
            SUM(CASE WHEN achieved = 1 THEN 1 ELSE 0 END) as success_count,
            ROUND(SUM(CASE WHEN achieved = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate,
            GROUP_CONCAT(DISTINCT action_type) as top_actions,
            GROUP_CONCAT(DISTINCT selector) as top_selectors
          FROM agentic_observations 
          WHERE url_pattern IS NOT NULL
          GROUP BY url_pattern 
          ORDER BY total DESC 
          LIMIT 50
        `).all();
        
        const patterns = (results || []).map((row: any) => ({
          pattern: row.url_pattern,
          total: row.total,
          success_count: row.success_count,
          success_rate: row.success_rate,
          top_actions: row.top_actions ? row.top_actions.split(',') : [],
          top_selectors: row.top_selectors ? row.top_selectors.split(',') : []
        }));
        
        return Response.json({ patterns });
      } catch (error) {
        log('ERROR', { message: 'Failed to fetch pattern observations', details: String(error) });
        return Response.json({ error: 'Failed to fetch patterns' }, { status: 500 });
      }
    }

    if (urlObj.pathname === '/observations') {
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
      const pattern = urlObj.searchParams.get('pattern');
      const limit = parseInt(urlObj.searchParams.get('limit') || '50');
      
      try {
        let observations = [];
        let aggregate = null;
        
        if (pattern) {
          // Get observations for specific pattern
          const { results } = await db.prepare(`
            SELECT * FROM agentic_observations 
            WHERE url_pattern = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
          `).bind(pattern, limit).all();
          
          observations = results || [];
          
          // Get aggregate for this pattern
          const { results: aggResults } = await db.prepare(`
            SELECT 
              COUNT(*) as total,
              SUM(CASE WHEN achieved = 1 THEN 1 ELSE 0 END) as success_count,
              ROUND(SUM(CASE WHEN achieved = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate,
              GROUP_CONCAT(DISTINCT action_type) as top_actions,
              GROUP_CONCAT(DISTINCT selector) as top_selectors
            FROM agentic_observations 
            WHERE url_pattern = ?
          `).bind(pattern).all();
          
          aggregate = aggResults?.[0] ? {
            pattern,
            total: aggResults[0].total,
            success_count: aggResults[0].success_count,
            success_rate: aggResults[0].success_rate,
          top_actions: aggResults[0].top_actions ? String(aggResults[0].top_actions).split(',') : [],
          top_selectors: aggResults[0].top_selectors ? String(aggResults[0].top_selectors).split(',') : []
          } : null;
        } else {
          // Get all recent observations
          const { results } = await db.prepare(`
            SELECT * FROM agentic_observations 
            ORDER BY timestamp DESC 
            LIMIT ?
          `).bind(limit).all();
          
          observations = results || [];
        }
        
        return Response.json({ observations, aggregate });
      } catch (error) {
        log('ERROR', { message: 'Failed to fetch observations', details: String(error) });
        return Response.json({ error: 'Failed to fetch observations' }, { status: 500 });
      }
    }

    // OpenAPI JSON
    if (urlObj.pathname === '/openapi.json') {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Stagehand Scraper API', version: '1.0.0', description: 'Scraper with evaluator optimizer and live D1 logs.' },
        servers: [{ url: '/' }],
        paths: {
          '/stagehand': {
            post: {
              summary: 'Regular Stagehand scrape',
              requestBody: {
                required: true,
                content: { 'application/json': { schema: {
                  type: 'object', properties: {
                    url: { type: 'string', format: 'uri' },
                    prompt: { type: 'string' },
                    waitForSelector: { type: 'string' },
                  }, required: ['url','prompt'] } } }
              },
              responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } }
            }
          },
          '/judge': {
            post: {
              summary: 'Llama 4 evaluator optimizer with tool registry',
              requestBody: { required: true, content: { 'application/json': { schema: {
                type: 'object', properties: {
                  url: { type: 'string', format: 'uri' },
                  goal: { type: 'string' },
                  waitForSelector: { type: 'string' },
                  capture: { type: 'string', enum: ['content','screenshot','both'] },
                  maxSteps: { type: 'integer', minimum: 1, maximum: 20 },
                  requestId: { type: 'string', description: 'Custom request ID for session tracking (optional)' }
                }, required: ['url','goal'] } } } },
              responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } }
            }
          },
          '/json-extract-api': {
            post: {
              summary: 'Proxy to Cloudflare Browser Rendering JSON extraction API',
              requestBody: { required: true, content: { 'application/json': { schema: {
                type: 'object', properties: {
                  url: { type: 'string', format: 'uri' },
                  prompt: { type: 'string' },
                  schema: { type: 'object' },
                  response_format: { type: 'object' },
                  requestId: { type: 'string', description: 'Custom request ID for session tracking (optional)' }
                }, required: ['url','prompt'] } } } },
              responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } }
            }
          },
          '/observations/patterns': {
            get: {
              summary: 'Get URL pattern aggregates with success rates',
              responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } }
            }
          },
          '/observations': {
            get: {
              summary: 'Get observations for a specific pattern or all recent observations',
              parameters: [
                { name: 'pattern', in: 'query', schema: { type: 'string' }, description: 'URL pattern to filter by' },
                { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Maximum number of observations to return' }
              ],
              responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } }
            }
          },
          '/logs': { get: { summary: 'WebSocket live logs', description: 'Connect with a WebSocket upgrade to receive log events.' } },
          '/test-schema': {
            post: {
              summary: 'Test schema generation from natural language',
              requestBody: { required: true, content: { 'application/json': { schema: {
                type: 'object', properties: {
                  prompt: { type: 'string', description: 'Natural language prompt describing the data to extract' },
                  expectedSchema: { type: 'object', description: 'Expected JSON schema for comparison (optional)' }
                }, required: ['prompt'] } } } },
              responses: { 
                '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
                '400': { description: 'Bad Request', content: { 'application/json': { schema: { type: 'object' } } } },
                '500': { description: 'Internal Server Error', content: { 'application/json': { schema: { type: 'object' } } } }
              }
            }
          }
        }
      };
      return Response.json(openapi);
    }

    // Static assets via ASSETS binding from public/
    if (urlObj.pathname === '/' || urlObj.pathname === '/docs' || urlObj.pathname.startsWith('/assets/') || urlObj.pathname.endsWith('.html') || urlObj.pathname.endsWith('.js') || urlObj.pathname.endsWith('.css')) {
      if (urlObj.pathname === '/docs') {
        const req = new Request(new URL('/docs.html', request.url), request);
        const resDocs = await (env as any).ASSETS?.fetch?.(req);
        if (resDocs && resDocs.status !== 404) return resDocs;
      }
      const res = await (env as any).ASSETS?.fetch?.(request);
      if (res && res.status !== 404) return res;
    }

    // Judge endpoint (formerly optimize)
    if (urlObj.pathname === '/judge') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const body = await request.json().catch(() => ({})) as any;
      const input = {
        url: body.url,
        goal: body.goal ?? body.prompt ?? 'Desired content is visible',
        waitForSelector: body.waitForSelector,
        capture: body.capture ?? 'both',
        maxSteps: body.maxSteps ?? 6,
      };
      
      try {
        updateRequestStatus('running');
        log('INFO', { message: 'Starting judge evaluation', url: input.url, prompt: input.goal });
        // pass requestId into env for observations logging convenience
        (env as any).requestId = requestId;
        const result = await runEvaluatorOptimizer(env, (lvl, data) => log(lvl, data), input);
        const logs = await fetchRecentLogs(db, 200, requestId);
        
        // Determine if extraction was successful
        const success = result.achieved && result.finalContent;
        updateRequestStatus(success ? 'completed' : 'failed', result, success ? undefined : 'Goal not achieved or no content extracted');
        
        return Response.json({ request_id: requestId, result, logs });
      } catch (error) {
        log('ERROR', { message: 'Judge evaluation failed', error_stack: (error as any)?.stack, details: (error as any)?.message || String(error) });
        updateRequestStatus('failed', null, (error as any)?.message || String(error));
        const logs = await fetchRecentLogs(db, 200, requestId);
        return Response.json({ request_id: requestId, error: 'Judge evaluation failed', details: (error as any)?.message || String(error), logs }, { status: 500 });
      }
    }

    // Cloudflare JSON extract API proxy
    if (urlObj.pathname === '/json-extract-api') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const body = await request.json().catch(() => ({})) as any;
      
      try {
        updateRequestStatus('running');
        log('INFO', { message: 'Starting JSON extraction', url: body.url, prompt: body.prompt });
        const { url, prompt } = body;
        let response_format = body.response_format;
        if (!response_format) {
          const desc = await describeFields(env, prompt);
          const jsonSchema = (await (async () => {
            try { const mod = await import('./utils/schemaGen'); return mod.jsonSchemaFromDescription(desc); } catch { return { type: 'object' }; }
          })());
          response_format = { type: 'json_schema', schema: jsonSchema };
        }
        // Dynamic import to avoid heavy client unless used
        const { default: Cloudflare } = await import('cloudflare') as any;
        const client = new Cloudflare({ apiToken: (env as any).CLOUDFLARE_API_TOKEN });
        const cloudflareResponse = await (client as any).browserRendering.json.create({
          account_id: (env as any).CLOUDFLARE_ACCOUNT_ID,
          url,
          prompt,
          response_format,
        });
        
        // Extract the actual data from the Cloudflare response
        const extractedData = cloudflareResponse?.result?.data || cloudflareResponse?.data || cloudflareResponse?.result || cloudflareResponse;
        
        const logs = await fetchRecentLogs(db, 200, requestId);
        const responseBody = { 
          request_id: requestId, 
          inferredSchema: !body.response_format ? response_format?.schema : undefined, 
          cloudflare: cloudflareResponse,
          extractedData: extractedData,
          logs 
        } as any;
        const logs2 = await fetchRecentLogs(db, 200, requestId);
        responseBody.logs = logs2;
        responseBody.request_id = requestId;
        
        // Broadcast completion with extracted data
        broadcastToConnections(requestId, {
          type: 'extraction_complete',
          request_id: requestId,
          success: true,
          dataCount: Array.isArray(extractedData) ? extractedData.length : 1,
          extractedData: extractedData,
          timestamp: new Date().toISOString()
        });
        
        // Update request status
        const success = extractedData && (Array.isArray(extractedData) ? extractedData.length > 0 : Object.keys(extractedData).length > 0);
        updateRequestStatus(success ? 'completed' : 'failed', extractedData, success ? undefined : 'No data extracted');
        
        return Response.json(responseBody);
      } catch (error) {
        log('ERROR', { message: 'Error during scraping', error_stack: (error as any)?.stack, details: (error as any)?.message || String(error), url: body.url, prompt: body.prompt });
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Update request status
        updateRequestStatus('failed', null, errorMessage);
        
        // Broadcast error
        broadcastToConnections(requestId, {
          type: 'extraction_error',
          request_id: requestId,
          error: errorMessage,
          url: body.url,
          timestamp: new Date().toISOString()
        });
        
        if (errorMessage.includes("Navigation timeout")) {
           const logs = await fetchRecentLogs(db, 200, requestId);
           return Response.json({ request_id: requestId, error: "Failed to navigate to the specified URL. It might be invalid or timed out.", url: body.url, logs }, { status: 504 });
        }
        const logs = await fetchRecentLogs(db, 200, requestId);
        return Response.json({ request_id: requestId, error: "Scraping failed", details: errorMessage, url: body.url, logs }, { status: 500 });
      }
    }

    // Schema testing endpoint
    if (urlObj.pathname === '/test-schema') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const body = await request.json().catch(() => ({})) as any;
      const { prompt, expectedSchema } = body;
      
      if (!prompt) {
        return Response.json({ error: 'prompt is required' }, { status: 400 });
      }
      
      try {
        log('INFO', { message: 'Testing schema generation', prompt });
        
        // Generate schema description
        const desc = await describeFields(env, prompt);
        
        if (desc.length === 0) {
          return Response.json({
            success: false,
            error: 'Failed to generate schema description',
            prompt,
            generatedSchema: null,
            expectedSchema: expectedSchema || null,
            match: false
          });
        }
        
        // Generate JSON schema
        const jsonSchema = (await (async () => {
          try { 
            const mod = await import('./utils/schemaGen'); 
            return mod.jsonSchemaFromDescription(desc); 
          } catch { 
            return { type: 'object' }; 
          }
        })());
        
        // Check if schema matches expectations (if provided)
        let match = null;
        if (expectedSchema) {
          try {
            match = JSON.stringify(jsonSchema) === JSON.stringify(expectedSchema);
          } catch {
            match = false;
          }
        }
        
        return Response.json({
          success: true,
          prompt,
          description: desc,
          generatedSchema: jsonSchema,
          expectedSchema: expectedSchema || null,
          match: match,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        log('ERROR', { message: 'Schema test failed', details: String(error) });
        return Response.json({
          success: false,
          error: String(error),
          prompt,
          generatedSchema: null,
          expectedSchema: expectedSchema || null,
          match: false
        }, { status: 500 });
      }
    }

    // WebSocket endpoint for live logs (real-time streaming). Supports ?request_id=...
    if (new URL(request.url).pathname === '/logs') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      const reqId = new URL(request.url).searchParams.get('request_id') || null;
      server.accept();
      
      // Add to global connection manager for real-time updates
      addWebSocketConnection(server, reqId ?? undefined);
      
      // Send initial batch of recent logs
      const sendInitialLogs = async () => {
        try {
          const base = `SELECT id, timestamp, request_id, level, message, url, prompt, selector, error_stack, details FROM scraper_logs`;
          const where = reqId ? ` WHERE request_id = ?` : '';
          const sql = `${base}${where} ORDER BY id DESC LIMIT 50`;
          const stmt = db!.prepare(sql);
          const { results } = reqId ? await stmt.bind(reqId).all() : await stmt.all();
          
          // Send logs in reverse order (oldest first)
          for (const row of (results || []).reverse()) {
            server.send(JSON.stringify({ type: 'log', data: row }));
          }
        } catch (e: any) {
          server.send(JSON.stringify({ type: 'error', error: e?.message || String(e) }));
        }
      };
      
      // Send initial logs
      void sendInitialLogs();
      
      // Clean up on close
      server.addEventListener('close', () => {
        const key = reqId || '*';
        const connections = activeConnections.get(key);
        if (connections) {
          const index = connections.findIndex(conn => conn.server === server);
          if (index >= 0) {
            connections.splice(index, 1);
            if (connections.length === 0) {
              activeConnections.delete(key);
            }
          }
        }
      });
      
      return new Response(null, { status: 101, webSocket: client as unknown as WebSocket });
    }

    if (urlObj.pathname !== '/stagehand') {
      // Allow only /stagehand to continue below
      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed. Please use POST.", { status: 405 });
    }

    // --- 1. Parse and Validate Input ---
    let urlToScrape: string;
    let extractionPrompt: string;
    let selectorToWaitFor: string | undefined;

    try {
      const body = await request.json();
      const parsed = requestBodySchema.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          { error: "Invalid request body", details: parsed.error?.errors },
          { status: 400 },
        );
      }
      urlToScrape = parsed.data?.url;
      extractionPrompt = parsed.data?.prompt;
      selectorToWaitFor = parsed.data?.waitForSelector;
    } catch (e) {
      return new Response("Invalid JSON body", { status: 400 });
    }

    // --- 2. Initialize Tools ---
    const structuredTool = createStructuredResponseTool(env); // Instantiate the tool
    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl: endpointURLString(env.BROWSER) },
      llmClient: new WorkersAIClient(env.AI),
      verbose: 1,
    });

    let dynamicSchema: z.ZodTypeAny | null = null;
    let schemaGenError: string | null = null;

    try {
      // --- 3. Generate Schema Dynamically ---
      log('INFO', { message: 'Generating schema dynamically...', prompt: extractionPrompt });
      
      // Broadcast schema generation start
      broadcastToConnections(requestId, {
        type: 'schema_generation_start',
        request_id: requestId,
        prompt: extractionPrompt,
        timestamp: new Date().toISOString()
      });
      
      const schemaGenPrompt = `Based on the following data extraction instruction, describe the ideal Zod schema structure for the *items* to be extracted. Respond ONLY with a JSON array of objects, where each object represents a field and has 'name', 'type' (choose from 'string', 'number', 'boolean', 'array', 'object', 'unknown'), and optionally 'description'.

Instruction: "${extractionPrompt}"`;

      const desc = await describeFields(env, extractionPrompt);

      if (desc.length) {
        log('DEBUG', { message: 'Schema description generated', details: JSON.stringify(desc) });
        dynamicSchema = zodFromDescriptionForStagehand(desc);
        
        // Broadcast schema description
        broadcastToConnections(requestId, {
          type: 'schema_description',
          request_id: requestId,
          description: desc,
          timestamp: new Date().toISOString()
        });
        
        // Generate JSON schema for frontend display
        const jsonSchema = (await (async () => {
          try { 
            const mod = await import('./utils/schemaGen'); 
            return mod.jsonSchemaFromDescription(desc); 
          } catch { 
            return { type: 'object' }; 
          }
        })());
        
        // Broadcast JSON schema
        broadcastToConnections(requestId, {
          type: 'schema_json',
          request_id: requestId,
          jsonSchema: jsonSchema,
          timestamp: new Date().toISOString()
        });
        
      } else {
        schemaGenError = 'Failed to generate schema description';
        log('ERROR', { message: 'Schema generation failed, falling back.' });
        // Use a more robust fallback schema that Stagehand can handle
        dynamicSchema = z.object({
          items: z.array(z.object({
            title: z.string().optional(),
            description: z.string().optional(),
            url: z.string().optional(),
            data: z.record(z.string(), z.unknown()).optional()
          }))
        }).describe('Generic fallback: Object with items array');
        
        // Broadcast schema generation failure
        broadcastToConnections(requestId, {
          type: 'schema_generation_error',
          request_id: requestId,
          error: schemaGenError,
          fallbackSchema: { type: 'array', items: { type: 'object' } },
          timestamp: new Date().toISOString()
        });
      }

      // --- 4. Initialize Stagehand & Navigate ---
      await stagehand.init();
      log('DEBUG', { message: 'Stagehand initialized' });
      const page = stagehand.page;
      log('INFO', { message: 'Navigating', url: urlToScrape });
      await page.goto(urlToScrape);
      log('INFO', { message: 'Navigation successful', url: urlToScrape });

      // --- 5. Wait (Optional) ---
      if (selectorToWaitFor) {
        log('DEBUG', { message: 'Waiting for selector', selector: selectorToWaitFor });
        try {
          await page.waitForSelector(selectorToWaitFor!, { timeout: 15000 });
        } catch (waitError) {
          log('WARN', { message: 'Timeout/error waiting for selector', selector: selectorToWaitFor, details: String(waitError) });
        }
      } else {
        await page.waitForTimeout(2000);
      }

      // --- 6. Extract Data using Dynamically Generated Schema ---
      log('INFO', { message: 'Attempting extraction', prompt: extractionPrompt, url: urlToScrape });
      const extractedData = await page.extract({
        instruction: extractionPrompt,
        schema: dynamicSchema as any, // Use the generated or fallback schema
      });

      // --- 7. Return Result ---
      const jsonSchema = dynamicSchema ? (await (async () => {
        try { 
          const mod = await import('./utils/schemaGen'); 
          const desc = await describeFields(env, extractionPrompt);
          return mod.jsonSchemaFromDescription(desc); 
        } catch { 
          return { type: 'object' }; 
        }
      })()) : { type: 'object' };
      
      const responseBody = {
         sourceUrl: urlToScrape,
         prompt: extractionPrompt,
         schemaUsed: dynamicSchema?.description || "Unknown (check logs)", // Include schema description
         schemaGenError: schemaGenError, // Include error if generation failed
         generatedSchema: jsonSchema, // Include the generated JSON schema
         data: extractedData,
      } as any;
      const logs = await fetchRecentLogs(db, 200, requestId);
      responseBody.logs = logs;
      responseBody.request_id = requestId;
      
      // Broadcast completion with extracted data
      broadcastToConnections(requestId, {
        type: 'extraction_complete',
        request_id: requestId,
        success: true,
        dataCount: Array.isArray(extractedData) ? extractedData.length : 1,
        extractedData: extractedData,
        timestamp: new Date().toISOString()
      });
      
      // Update request status
      const success = extractedData && (Array.isArray(extractedData) ? extractedData.length > 0 : Object.keys(extractedData).length > 0);
      updateRequestStatus(success ? 'completed' : 'failed', extractedData, success ? undefined : 'No data extracted');
      
      return Response.json(responseBody);

    } catch (error: any) {
      log('ERROR', { message: 'Error during scraping', error_stack: error?.stack, details: error?.message || String(error), url: urlToScrape, prompt: extractionPrompt });
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Update request status
      updateRequestStatus('failed', null, errorMessage);
      
      // Broadcast error
      broadcastToConnections(requestId, {
        type: 'extraction_error',
        request_id: requestId,
        error: errorMessage,
        url: urlToScrape,
        timestamp: new Date().toISOString()
      });
      
      if (errorMessage.includes("Navigation timeout")) {
         const logs = await fetchRecentLogs(db, 200, requestId);
         return Response.json({ request_id: requestId, error: "Failed to navigate to the specified URL. It might be invalid or timed out.", url: urlToScrape, logs }, { status: 504 });
      }
      const logs = await fetchRecentLogs(db, 200, requestId);
      return Response.json({ request_id: requestId, error: "Scraping failed", details: errorMessage, url: urlToScrape, logs }, { status: 500 });
    } finally {
      // --- 8. Cleanup ---
      ctx.waitUntil(
        (async () => {
          try {
            await stagehand.close();
            await logToD1(db, 'DEBUG', { message: 'Stagehand closed successfully' });
          } catch (e: any) {
            await logToD1(db, 'ERROR', { message: 'Error closing Stagehand', error_stack: e?.stack, details: e?.message || String(e) });
          }
        })()
      );
    }
  },
};
