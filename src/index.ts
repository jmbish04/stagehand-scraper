import { Stagehand } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { z } from "zod";
import { WorkersAIClient } from "./workersAIClient";

// Define the expected shape of the JSON request body
const requestBodySchema = z.object({
  url: z.string().url("Invalid URL provided"),
  prompt: z.string().min(1, "Prompt cannot be empty"),
  // Optional: Add a selector to wait for before extraction
  waitForSelector: z.string().optional(),
});

// Define a generic schema for extraction: an array of objects with unknown string keys/values
// This allows the AI to determine the structure based on the prompt.
const genericExtractionSchema = z.array(
  z.record(z.string(), z.unknown())
).describe("An array of objects, where each object represents an extracted item.");

export default {
  async fetch(request: Request, env: Env) {
    // Only allow POST requests
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
          { error: "Invalid request body", details: parsed.error.errors },
          { status: 400 },
        );
      }
      urlToScrape = parsed.data.url;
      extractionPrompt = parsed.data.prompt;
      selectorToWaitFor = parsed.data.waitForSelector;
    } catch (e) {
      return new Response("Invalid JSON body", { status: 400 });
    }

    // --- 2. Initialize Stagehand ---
    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl: endpointURLString(env.BROWSER) },
      llmClient: new WorkersAIClient(env.AI),
      verbose: 1, // Optional logging
    });

    try {
      await stagehand.init();
      const page = stagehand.page;

      // --- 3. Navigate and Wait (Optional) ---
      await page.goto(urlToScrape);

      if (selectorToWaitFor) {
        console.log(`Waiting for selector: ${selectorToWaitFor}`);
        try {
          // Wait for a selector if provided by the user
          await page.waitForSelector(selectorToWaitFor, { timeout: 15000 }); // 15 second timeout
        } catch (waitError) {
          console.warn(`Timeout or error waiting for selector "${selectorToWaitFor}": ${waitError}`);
          // Proceed anyway, maybe the content is already there or the selector was wrong
        }
      } else {
        // Add a small default wait if no selector is provided, to allow dynamic content to load
        await page.waitForTimeout(2000); // Wait 2 seconds
      }


      // --- 4. Extract Data using AI ---
      console.log(`Attempting extraction with prompt: "${extractionPrompt}"`);
      const extractedData = await page.extract({
        instruction: extractionPrompt, // Use the prompt from the request
        schema: genericExtractionSchema, // Use the generic schema
      });

      // --- 5. Return Result ---
      return Response.json({
         sourceUrl: urlToScrape,
         prompt: extractionPrompt,
         data: extractedData
      });

    } catch (error) {
      console.error("Error during scraping:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Try to provide a more specific error if it's a navigation timeout
      if (errorMessage.includes("Navigation timeout")) {
         return Response.json({ error: "Failed to navigate to the specified URL. It might be invalid or timed out.", url: urlToScrape }, { status: 504 }); // Gateway Timeout
      }
      return Response.json({ error: "Scraping failed", details: errorMessage, url: urlToScrape }, { status: 500 });
    } finally {
      // --- 6. Cleanup ---
      await stagehand.close();
    }
  },
};
