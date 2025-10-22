import { Stagehand } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { z } from "zod";
import { createStructuredResponseTool } from "./tools";

type LogFn = (level: 'INFO'|'WARN'|'ERROR'|'DEBUG', data: { message: string; [k: string]: any }) => void;

export interface EvalOptimizeInput {
  url: string;
  goal: string; // description of what we want on screen
  waitForSelector?: string;
  maxSteps?: number;
  capture?: 'content' | 'screenshot' | 'both';
}

export interface EvalOptimizeResult {
  steps: Array<{ action: string; note?: string; ok: boolean }>;
  achieved: boolean;
  finalContent?: string;
  finalScreenshotBase64?: string;
}

// Llama 4 tool registry schemas
const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.any())
});

// Simplified schema for StructuredResponseTool compatibility
const evaluatorResponseSchema = z.object({
  achieved: z.boolean().describe("Whether the goal has been achieved"),
  confidence: z.number().min(0).max(1).optional().describe("Confidence level from 0 to 1"),
  reason: z.string().optional().describe("Explanation of the decision"),
  pageAnalysis: z.object({
    title: z.string().optional().describe("Page title"),
    style: z.string().optional().describe("Page style/type"),
    groups: z.array(z.object({ 
      heading: z.string().optional().describe("Group heading"), 
      items: z.array(z.string()).optional().describe("Items in this group") 
    })).optional().describe("Content groups found on the page"),
    extractedText: z.string().optional().describe("Key extracted text"),
  }).optional().describe("Analysis of the page content"),
  nextAction: z.object({
    type: z.enum(['waitForSelector','click','type','navigate','none']).default('none').describe("Type of next action"),
    selector: z.string().optional().describe("CSS selector for the action"),
    text: z.string().optional().describe("Text to type if action is 'type'"),
    url: z.string().optional().describe("URL to navigate to if action is 'navigate'"),
  }).optional().describe("Recommended next action")
});

// Tool definitions for Llama 4
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'browser_navigate_to_url',
      description: 'Navigate to a specific URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click_element',
      description: 'Click on an element using CSS selector',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the element to click' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type_text',
      description: 'Type text into an input field',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the input field' },
          text: { type: 'string', description: 'Text to type' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait_for_selector',
      description: 'Wait for an element to appear on the page',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 8000)' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_page_content',
      description: 'Get page content as HTML or text',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['html', 'text', 'both'], description: 'Content format to return' }
        },
        required: ['mode']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_take_screenshot',
      description: 'Take a screenshot of the current page',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analyze_screenshot',
      description: 'Analyze a screenshot using vision model',
      parameters: {
        type: 'object',
        properties: {
          image_base64: { type: 'string', description: 'Base64 encoded image data' },
          html_snippet: { type: 'string', description: 'Optional HTML snippet for context' }
        },
        required: ['image_base64']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_deeper_analysis',
      description: 'Request deeper analysis using GPT-OSS-120B for complex reasoning',
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: 'Analysis objective' },
          visual_description: { type: 'string', description: 'Description of what is visible' },
          extracted_content: { type: 'string', description: 'Any extracted text content' }
        },
        required: ['objective', 'visual_description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_observations_for_pattern',
      description: 'Get historical observations for a URL pattern',
      parameters: {
        type: 'object',
        properties: {
          url_pattern: { type: 'string', description: 'URL pattern to get observations for' },
          limit: { type: 'number', description: 'Maximum number of observations to return' }
        },
        required: ['url_pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_observation',
      description: 'Log an observation to the database',
      parameters: {
        type: 'object',
        properties: {
          observation: { type: 'object', description: 'Observation data to log' }
        },
        required: ['observation']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_line',
      description: 'Log a message to the database',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['INFO', 'WARN', 'ERROR', 'DEBUG'], description: 'Log level' },
          message: { type: 'string', description: 'Log message' },
          details: { type: 'string', description: 'Additional details' }
        },
        required: ['level', 'message']
      }
    }
  }
];

function toUrlPattern(u: string): string {
  try {
    const url = new URL(u);
    // Basic pattern: host + pathname with digits collapsed and last segment wildcarded
    const path = url.pathname.replace(/\d+/g, ':id');
    const segs = path.split('/');
    if (segs.length > 2) segs[segs.length - 1] = '*';
    const norm = segs.join('/').replace(/\/+/g, '/');
    return `${url.hostname}${norm}`;
  } catch {
    return u;
  }
}

async function recordObservation(db: D1Database | undefined, obs: any) {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO agentic_observations
      (request_id, url, url_pattern, action_type, selector, text, navigate_url, goal, achieved, confidence, outcome, reason, page_title, page_style, page_groups, extracted_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      obs.request_id ?? null,
      obs.url ?? null,
      obs.url_pattern ?? null,
      obs.action_type ?? null,
      obs.selector ?? null,
      obs.text ?? null,
      obs.navigate_url ?? null,
      obs.goal ?? null,
      obs.achieved ? 1 : 0,
      obs.confidence ?? null,
      obs.outcome ?? null,
      obs.reason ?? null,
      obs.page_title ?? null,
      obs.page_style ?? null,
      obs.page_groups ?? null,
      obs.extracted_text ?? null
    ).run();
  } catch (e) {
    // swallow; logging is handled elsewhere
  }
}

async function fetchHeuristics(db: D1Database | undefined, urlPattern: string) {
  if (!db) return [] as any[];
  try {
    const { results } = await db.prepare(
      `SELECT action_type, selector, text, navigate_url, achieved, outcome, confidence
       FROM agentic_observations WHERE url_pattern = ? ORDER BY timestamp DESC LIMIT 20`
    ).bind(urlPattern).all();
    return results || [];
  } catch {
    return [];
  }
}

// Tool execution handlers
async function executeToolCall(toolCall: any, page: any, env: Env, log: LogFn, urlPattern: string, input: EvalOptimizeInput): Promise<any> {
  const { name, arguments: args } = toolCall;
  
  try {
    switch (name) {
      case 'browser_navigate_to_url':
        await page.goto(args.url);
        log('INFO', { message: 'Navigated to URL', url: args.url });
        return { success: true, result: `Navigated to ${args.url}` };
        
      case 'browser_click_element':
        await page.click(args.selector);
        log('INFO', { message: 'Clicked element', selector: args.selector });
        return { success: true, result: `Clicked ${args.selector}` };
        
      case 'browser_type_text':
        await page.fill(args.selector, args.text);
        log('INFO', { message: 'Typed text', selector: args.selector, text: args.text });
        return { success: true, result: `Typed "${args.text}" into ${args.selector}` };
        
      case 'browser_wait_for_selector':
        const timeout = args.timeout || 8000;
        await page.waitForSelector(args.selector, { timeout });
        log('INFO', { message: 'Waited for selector', selector: args.selector, timeout });
        return { success: true, result: `Waited for ${args.selector}` };
        
      case 'browser_get_page_content':
        const content = await page.content();
        const textContent = await page.textContent('body');
        log('DEBUG', { message: 'Retrieved page content', mode: args.mode });
        return { 
          success: true, 
          result: args.mode === 'html' ? content : 
                 args.mode === 'text' ? textContent : 
                 { html: content, text: textContent }
        };
        
      case 'browser_take_screenshot':
        const screenshot = await page.screenshot({ type: 'png' });
        const screenshotB64 = btoa(String.fromCharCode(...new Uint8Array(screenshot as ArrayBuffer)));
        log('DEBUG', { message: 'Took screenshot' });
        return { success: true, result: screenshotB64 };
        
      case 'analyze_screenshot':
        const visionMessages = [
          { role: 'system', content: 'Analyze this screenshot and return JSON with keys: style, groups[{heading,items[]}], extractedText.' },
          { role: 'user', content: [
              { type: 'text', text: 'Analyze this screenshot:' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${args.image_base64}` } },
              { type: 'text', text: `HTML context: ${args.html_snippet || 'No HTML provided'}` }
          ]}
        ];
        const vision = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', { messages: visionMessages });
        const visionResult = typeof vision === 'string' ? vision : (vision.response || JSON.stringify(vision));
        log('DEBUG', { message: 'Analyzed screenshot with vision' });
        return { success: true, result: visionResult };
        
      case 'request_deeper_analysis':
        const analysisPrompt = `Objective: ${args.objective}
Visual Description: ${args.visual_description}
Extracted Content: ${args.extracted_content || 'None'}

Provide detailed analysis and recommendations.`;
        const analysis = await env.AI.run('@cf/openai/gpt-oss-120b', { 
          input: `System: You are an expert web automation analyst. Provide detailed analysis and actionable recommendations.

User: ${analysisPrompt}`
        } as any);
        const analysisResult = typeof analysis === 'string' ? analysis : ((analysis as any).response || JSON.stringify(analysis));
        log('DEBUG', { message: 'Requested deeper analysis' });
        return { success: true, result: analysisResult };
        
      case 'get_observations_for_pattern':
        const observations = await fetchHeuristics((env as any).DB, args.url_pattern);
        log('DEBUG', { message: 'Retrieved observations', pattern: args.url_pattern, count: observations.length });
        return { success: true, result: observations.slice(0, args.limit || 20) };
        
      case 'log_observation':
        await recordObservation((env as any).DB, {
          request_id: (env as any).requestId,
          url: input.url,
          url_pattern: urlPattern,
          ...args.observation
        });
        log('DEBUG', { message: 'Logged observation' });
        return { success: true, result: 'Observation logged' };
        
      case 'log_line':
        log(args.level as any, { message: args.message, details: args.details });
        return { success: true, result: 'Log entry created' };
        
      default:
        log('WARN', { message: 'Unknown tool call', tool: name });
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    log('ERROR', { message: 'Tool execution failed', tool: name, error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function runEvaluatorOptimizer(env: Env, log: LogFn, input: EvalOptimizeInput) : Promise<EvalOptimizeResult> {
  const steps: EvalOptimizeResult['steps'] = [];
  const maxSteps = input.maxSteps ?? 6;
  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: { cdpUrl: endpointURLString(env.BROWSER) },
    llmClient: { run: async () => ({}) } as any, // not used here
    verbose: 1,
  });
  await stagehand.init();
  const page = stagehand.page;

  let achieved = false;
  try {
    log('INFO', { message: 'Llama 4 evaluator starting navigation', url: input.url });
    await page.goto(input.url);
    if (input.waitForSelector) {
      try { await page.waitForSelector(input.waitForSelector, { timeout: 10000 }); } catch {}
    } else { await page.waitForTimeout(1500); }

    const urlPattern = toUrlPattern(input.url);
    const heuristics = await fetchHeuristics((env as any).DB, urlPattern);
    const historicalHints = heuristics.length > 0 ? 
      `Historical observations for ${urlPattern}: ${JSON.stringify(heuristics.slice(0, 5))}` : 
      'No historical observations available';

    for (let i = 0; i < maxSteps; i++) {
      log('INFO', { message: `Step ${i + 1}/${maxSteps}`, url: input.url });
      
      // Get current page state
      const html = await page.content();
      const currentUrl = page.url();
      
      // Prepare context for Llama 4
      const contextPrompt = `You are a web automation agent analyzing a webpage to determine if a goal has been achieved.

GOAL: ${input.goal}
CURRENT URL: ${currentUrl}
STEP: ${steps.length + 1}/${input.maxSteps}
${historicalHints}

HTML CONTENT (first 20KB):
${html.slice(0, 20_000)}

Analyze the webpage and determine:
1. Has the goal been achieved? (achieved: boolean)
2. What is your confidence level? (confidence: number 0-1)
3. What is your reasoning? (reason: string)
4. Analyze the page structure (pageAnalysis: object with title, style, groups, extractedText)
5. What should be the next action? (nextAction: object with type, selector, text, url)

Available action types: waitForSelector, click, type, navigate, none

Return a structured response with your analysis and recommendations.`;

      // Use StructuredResponseTool for robust Llama 4 function calling
      const tool = createStructuredResponseTool(env);
      const result = await tool.analyzeText(evaluatorResponseSchema, contextPrompt);
      
      let parsed;
      if (result.success && result.structuredResult) {
        parsed = result.structuredResult;
        log('DEBUG', { message: 'Llama 4 response parsed successfully', modelUsed: result.modelUsed });
      } else {
        log('WARN', { message: 'Failed to parse Llama 4 response', error: result.error || 'Unknown error' });
        // Fallback heuristic
        parsed = { 
          achieved: false, 
          nextAction: { type: 'none' },
          reason: 'Failed to parse response, stopping execution'
        };
      }

      // Log the decision
      steps.push({ 
        action: 'judge', 
        ok: true, 
        note: `Goal achieved: ${parsed.achieved}, Reason: ${parsed.reason || 'No reason provided'}` 
      });

      if (parsed.achieved) {
        achieved = true;
        await recordObservation((env as any).DB, {
          request_id: (env as any).requestId,
          url: input.url,
          url_pattern: urlPattern,
          action_type: 'none',
          goal: input.goal,
          achieved: true,
          confidence: parsed.confidence,
          outcome: 'success',
          reason: parsed.reason,
          page_title: parsed.pageAnalysis?.title,
          page_style: parsed.pageAnalysis?.style,
          page_groups: parsed.pageAnalysis?.groups ? JSON.stringify(parsed.pageAnalysis.groups) : null,
          extracted_text: parsed.pageAnalysis?.extractedText,
        });
        break;
      }

      // Tool calls are not used with StructuredResponseTool approach
      // The AI response contains the analysis and next action recommendation
      
      // Execute next action if provided
      if (parsed.nextAction) {
        // Fallback to simple action execution
        const action = parsed.nextAction;
        if (action) {
          switch (action.type) {
            case 'waitForSelector':
              if ('selector' in action && action.selector) { 
                await page.waitForSelector(action.selector, { timeout: 8000 }); 
                steps.push({ action: `waitForSelector(${action.selector})`, ok: true });
              }
              break;
            case 'click':
              if ('selector' in action && action.selector) { 
                await page.click(action.selector); 
                steps.push({ action: `click(${action.selector})`, ok: true });
              }
              break;
            case 'type':
              if ('selector' in action && action.selector) { 
                await page.fill(action.selector, ('text' in action ? action.text : '') ?? ''); 
                steps.push({ action: `type(${action.selector})`, ok: true });
              }
              break;
            case 'navigate':
              if ('url' in action && action.url) { 
                await page.goto(action.url); 
                steps.push({ action: `navigate(${action.url})`, ok: true });
              }
              break;
            default:
              steps.push({ action: 'none', ok: true });
          }
          
          // Record observation for the action
          await recordObservation((env as any).DB, {
            request_id: (env as any).requestId,
            url: input.url,
            url_pattern: urlPattern,
            action_type: action.type,
            selector: ('selector' in action ? action.selector : undefined),
            text: ('text' in action ? action.text : undefined),
            navigate_url: ('url' in action ? action.url : undefined),
            goal: input.goal,
            achieved: false,
            outcome: 'partial',
            confidence: parsed.confidence,
            reason: parsed.reason,
          });
        }
      }

      await page.waitForTimeout(1200);
    }

    const result: EvalOptimizeResult = {
      steps,
      achieved,
    };
    if (input.capture === 'content' || input.capture === 'both') {
      result.finalContent = await page.content();
    }
    if (input.capture === 'screenshot' || input.capture === 'both') {
      const buf = await page.screenshot({ type: 'png' });
      result.finalScreenshotBase64 = btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
    }
    return result;
  } finally {
    await stagehand.close();
  }
}
