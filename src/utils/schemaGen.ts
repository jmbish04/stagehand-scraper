import { z } from 'zod';
import { createStructuredResponseTool } from '../tools';

// Define Env type locally since we're using the standalone tools.ts
export type Env = {
  AI: any;
  BROWSER: any;
  DB: any;
  [key: string]: any;
};

// --- Schema Definitions ---

/**
 * Zod schema for the description of a single field, including its required status.
 * Expected output from the LLM for each identified field.
 */
export const fieldDescriptionSchema = z.object({
  name: z.string().describe("The name of the field."),
  type: z.enum(["string","number","boolean","array","object","unknown"])
      .describe("The data type of the field."),
  description: z.string().optional()
      .describe("Optional description of what the field represents."),
  isRequired: z.boolean().optional()
      .describe("Whether the field is considered mandatory for the extraction."),
});

/**
 * Zod schema for the overall structure expected from the LLM: an array of field descriptions.
 */
export const schemaDescriptionSchema = z.array(fieldDescriptionSchema);

/**
 * TypeScript type inferred from the fieldDescriptionSchema.
 */
export type FieldDescription = z.infer<typeof fieldDescriptionSchema>;

// --- Core Functions ---

/**
 * Asks an LLM to describe the fields needed to extract information based on a prompt.
 * @param env - The environment object containing AI bindings/configuration.
 * @param prompt - The natural language instruction for data extraction.
 * @returns A promise that resolves to an array of FieldDescription objects or an empty array on failure.
 */
export async function describeFields(env: Env, prompt: string): Promise<FieldDescription[]> {
  const analysisPrompt = `Describe the JSON fields needed to accurately capture the information requested in the following instruction.
For each field, specify:
- 'name': The field's key in the JSON object.
- 'type': The data type (choose one: string, number, boolean, array, object, unknown).
- 'description' (optional): A brief explanation of the field's purpose.
- 'isRequired' (optional, boolean): Indicate if this field is essential to fulfilling the request (default is false if omitted).

Instruction: "${prompt}"

Respond with a JSON object containing a "fields" property that is an array of field descriptions: {"fields": [{name, type, description?, isRequired?}]}. Do not include any other text, explanations, or markdown formatting.`;

  try {
    // Use the StructuredResponseTool for robust schema generation
    const tool = createStructuredResponseTool(env);
    
    // Create a wrapper object schema since analyzeText expects ZodObject
    const wrapperSchema = z.object({
      fields: schemaDescriptionSchema
    });
    
    const result = await tool.analyzeText(wrapperSchema, analysisPrompt);
    
    if (result.success && result.structuredResult) {
      console.log("Schema generation successful:", result.structuredResult);
      return result.structuredResult.fields as FieldDescription[];
    } else {
      console.error("Schema generation failed:", result.error);
      return [];
    }

  } catch (error) {
    console.error("Error calling LLM in describeFields:", error);
    return []; // Return empty array on exception
  }
}

/**
 * Generates a Zod schema representing an array of objects based on field descriptions.
 * @param desc - An array of FieldDescription objects.
 * @returns A Zod schema (z.array(z.object(...))).
 */
export function zodFromDescription(desc: FieldDescription[]): z.ZodArray<z.ZodObject<any>> {
  // Fallback schema if description is empty or invalid
  if (!Array.isArray(desc) || desc.length === 0) {
      return z.array(z.object({}))
          .describe('Generic fallback: Array of objects with any properties');
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of desc) {
    // Skip fields with empty names which can cause issues
    if (!f.name) continue;

    let s: z.ZodTypeAny;
    switch (f.type) {
      case 'string':  s = z.string(); break;
      case 'number':  s = z.number(); break;
      case 'boolean': s = z.boolean(); break;
      // TODO: Implement recursive schema generation for complex types if needed
      case 'array':   s = z.array(z.unknown()).describe("Array of unknown items"); break;
      case 'object':  s = z.record(z.string(), z.unknown()).describe("Object with unknown properties"); break;
      default:        s = z.unknown().describe("Type could not be determined");
    }

    if (f.description) {
        s = s.describe(f.description);
    }

    // Apply .optional() modifier unless isRequired is explicitly true
    shape[f.name] = f.isRequired === true ? s : s.optional();
  }

  // Ensure we have at least one field to avoid empty object issues
  if (Object.keys(shape).length === 0) {
    shape['data'] = z.string().optional().describe('Generic data field');
  }

  return z.array(z.object(shape))
      .describe('Dynamically generated schema for an array of objects');
}

/**
 * Generates a Zod schema compatible with Stagehand's expectations.
 * Stagehand expects a ZodObject, not a ZodArray, so this creates a wrapper object.
 * @param desc - An array of FieldDescription objects.
 * @returns A Zod schema (z.object({ items: z.array(z.object(...)) })).
 */
export function zodFromDescriptionForStagehand(desc: FieldDescription[]): z.ZodObject<any> {
  // Fallback schema if description is empty or invalid
  if (!Array.isArray(desc) || desc.length === 0) {
      return z.object({
        items: z.array(z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          url: z.string().optional(),
          data: z.record(z.string(), z.unknown()).optional()
        }))
      }).describe('Generic fallback: Object with items array');
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of desc) {
    // Skip fields with empty names which can cause issues
    if (!f.name) continue;

    let s: z.ZodTypeAny;
    switch (f.type) {
      case 'string':  s = z.string(); break;
      case 'number':  s = z.number(); break;
      case 'boolean': s = z.boolean(); break;
      // TODO: Implement recursive schema generation for complex types if needed
      case 'array':   s = z.array(z.unknown()).describe("Array of unknown items"); break;
      case 'object':  s = z.record(z.string(), z.unknown()).describe("Object with unknown properties"); break;
      default:        s = z.unknown().describe("Type could not be determined");
    }

    if (f.description) {
        s = s.describe(f.description);
    }

    // Apply .optional() modifier unless isRequired is explicitly true
    shape[f.name] = f.isRequired === true ? s : s.optional();
  }

  // Ensure we have at least one field to avoid empty object issues
  if (Object.keys(shape).length === 0) {
    shape['data'] = z.string().optional().describe('Generic data field');
  }

  // Return a ZodObject with an 'items' property containing the array
  return z.object({
    items: z.array(z.object(shape))
  }).describe('Stagehand-compatible schema: Object with items array');
}

/**
 * Generates a standard JSON Schema representing an array of objects based on field descriptions.
 * Suitable for use with LLM function calling or other schema validation systems.
 * @param desc - An array of FieldDescription objects.
 * @returns A JSON Schema object.
 */
export function jsonSchemaFromDescription(desc: FieldDescription[]): object {
   // Fallback schema if description is empty or invalid
   if (!Array.isArray(desc) || desc.length === 0) {
    return {
      type: 'array',
      description: 'Generic fallback: Array of objects with any properties',
      items: {
        type: 'object',
        additionalProperties: true,
      }
    };
  }

  const props: Record<string, any> = {};
  const requiredFields: string[] = [];

  // Map internal types to JSON Schema types
  const typeMap: Record<FieldDescription['type'], string | undefined> = {
      string: 'string',
      number: 'number',
      boolean: 'boolean',
      array: 'array',
      object: 'object',
      unknown: undefined, // Allows any type if not specified
  };

  for (const f of desc) {
     // Skip fields with empty names
    if (!f.name) continue;

    const jsonType = typeMap[f.type];
    let fieldSchema: any = {};

    if (jsonType) {
        fieldSchema.type = jsonType;
    }
    // Add basic defaults for complex types - could be enhanced with recursion
    if (jsonType === 'array') {
        fieldSchema.items = {}; // Array of anything
    } else if (jsonType === 'object') {
        fieldSchema.additionalProperties = true; // Allows any properties
    }

    if (f.description) {
        fieldSchema.description = f.description;
    }

    props[f.name] = fieldSchema;

    // Collect required fields
    if (f.isRequired === true) {
        requiredFields.push(f.name);
    }
  }

  // Define the schema for the objects within the array
  const itemSchema: any = {
      type: 'object',
      properties: props,
  };

  if (requiredFields.length > 0) {
      itemSchema.required = requiredFields;
  }

  // Return the final schema for an array containing these objects
  return {
      type: 'array',
      description: 'Dynamically generated schema for an array of objects',
      items: itemSchema,
  };
}

// --- Example Usage (Conceptual - requires actual tool implementation) ---
/*
async function example(env: Env) {
  const userPrompt = "List the names and email addresses of all active users in the system.";
  const fieldDescriptions = await describeFields(env, userPrompt);

  if (fieldDescriptions.length > 0) {
    const dynamicZodSchema = zodFromDescription(fieldDescriptions);
    const dynamicJsonSchema = jsonSchemaFromDescription(fieldDescriptions);

    console.log("Generated Zod Schema:", dynamicZodSchema.description);
    // You could now use dynamicZodSchema.parse(...) to validate data

    console.log("Generated JSON Schema:", JSON.stringify(dynamicJsonSchema, null, 2));
    // You could now use dynamicJsonSchema in an LLM function call's parameters or response_format
  } else {
    console.log("Could not generate schema descriptions.");
  }
}
*/

// NOTE: The StructuredResponseTool and related types are imported from '../tools'