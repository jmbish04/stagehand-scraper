import { Stagehand } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { z } from "zod";
import { createStructuredResponseTool } from "./tools"; // Import the factory
import { WorkersAIClient } from "./workersAIClient";

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
): z.ZodTypeAny {
  if (!Array.isArray(description) || description.length === 0) {
    // Fallback to a generic schema if description is invalid or empty
    console.warn("Invalid or empty schema description received, falling back to generic schema.");
    return z.array(z.record(z.string(), z.unknown()))
      .describe("Generic fallback: An array of objects with unknown string keys/values.");
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
        // Could be enhanced to ask AI for array item type.
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

  // Assume the desired output is an array of these objects
  return z.array(z.object(objectShape)).describe("Dynamically generated schema: An array of objects.");
}


// --- Worker Fetch Handler ---

export default {
  async fetch(request: Request, env: Env) {
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
      console.log(`Generating schema based on prompt: "${extractionPrompt}"`);
      const schemaGenPrompt = `Based on the following data extraction instruction, describe the ideal Zod schema structure for the *items* to be extracted. Respond ONLY with a JSON array of objects, where each object represents a field and has 'name', 'type' (choose from 'string', 'number', 'boolean', 'array', 'object', 'unknown'), and optionally 'description'.

Instruction: "${extractionPrompt}"`;

      const schemaDescResponse = await structuredTool.analyzeText(
        schemaDescriptionSchema, // Use the schema *for* schema descriptions
        schemaGenPrompt
      );

      if (schemaDescResponse.success && schemaDescResponse.structuredResult) {
        console.log("Successfully generated schema description:", JSON.stringify(schemaDescResponse.structuredResult));
        dynamicSchema = buildSchemaFromDescription(schemaDescResponse.structuredResult);
      } else {
        schemaGenError = `Failed to generate schema description: ${schemaDescResponse.error || 'Unknown error'}. Model used: ${schemaDescResponse.modelUsed}`;
        console.error(schemaGenError);
        // Decide how to handle schema generation failure.
        // Option 1: Abort - return an error response
        // return Response.json({ error: "Schema generation failed", details: schemaGenError }, { status: 500 });
        // Option 2: Fallback to generic schema (implemented below)
        console.warn("Falling back to generic extraction schema.");
        dynamicSchema = z.array(z.record(z.string(), z.unknown()))
          .describe("Generic fallback: An array of objects with unknown string keys/values.");
      }

      // --- 4. Initialize Stagehand & Navigate ---
      await stagehand.init();
      const page = stagehand.page;
      await page.goto(urlToScrape);

      // --- 5. Wait (Optional) ---
      if (selectorToWaitFor) {
        console.log(`Waiting for selector: ${selectorToWaitFor}`);
        try {
          await page.waitForSelector(selectorToWaitFor, { timeout: 15000 });
        } catch (waitError) {
          console.warn(`Timeout or error waiting for selector "${selectorToWaitFor}": ${waitError}`);
        }
      } else {
        await page.waitForTimeout(2000);
      }

      // --- 6. Extract Data using Dynamically Generated Schema ---
      console.log(`Attempting extraction with prompt: "${extractionPrompt}"`);
      const extractedData = await page.extract({
        instruction: extractionPrompt,
        schema: dynamicSchema, // Use the generated or fallback schema
      });

      // --- 7. Return Result ---
      return Response.json({
         sourceUrl: urlToScrape,
         prompt: extractionPrompt,
         schemaUsed: dynamicSchema.description || "Unknown (check logs)", // Include schema description
         schemaGenError: schemaGenError, // Include error if generation failed
         data: extractedData
      });

    } catch (error) {
      console.error("Error during scraping:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Navigation timeout")) {
         return Response.json({ error: "Failed to navigate to the specified URL. It might be invalid or timed out.", url: urlToScrape }, { status: 504 });
      }
      return Response.json({ error: "Scraping failed", details: errorMessage, url: urlToScrape }, { status: 500 });
    } finally {
      // --- 8. Cleanup ---
      await stagehand.close();
    }
  },
};
