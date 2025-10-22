/**
 * @file src/tools/index.ts
 * @description Integrated toolkit for Cloudflare AI, Browser Rendering, Auth, and Health Monitoring.
 *
 * @module This file serves as the central barrel export for the entire tools ecosystem.
 * It defines and exports two primary AI tool classes:
 * 1. `EmbeddingTool`: Handles text embedding generation and search result reranking.
 * 2. `StructuredResponseTool`: Provides robust, schema-enforced JSON output from LLMs,
 * with automatic model fallback and context-aware chunking.
 *
 * It also exports:
 * - Health monitoring tools (`createToolsHealthMonitor` and specific checkers).
 * - A browser rendering tool (`createBrowserRender`).
 * - An authentication tool (`createAuthTool`).
 * - A high-level `createToolkit` factory to instantiate all tools with a shared environment.
 * - Default configuration (`DEFAULT_TOOL_CONFIG`) for the toolkit.
 *
 * @see EmbeddingTool For embedding and reranking logic.
 * @see StructuredResponseTool For schema-enforced LLM responses.
 * @see createToolkit For the primary factory function to instantiate all tools.
 */

import type { ZodObject, ZodSchema, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Env, ExtendedEnv } from "../types/env";
// Note: Health, Browser, Auth, and Extractor imports are assumed to be in ./health, ./browser-tools etc.
// The provided file snippet implies their existence, so they are included here for completeness.
import {
    createToolsHealthMonitor,
    createAIToolsHealthChecker,
    createBrowserToolsHealthChecker,
    createAuthToolsHealthChecker,
    createExtractorToolsHealthChecker,
    ToolsHealthMonitor,
} from "./health";
import type {
    SystemHealthStatus,
    QuickHealthStatus,
    AIToolsHealthStatus,
    BrowserToolsHealthStatus,
    AuthToolsHealthStatus,
    ExtractorToolsHealthStatus,
} from "./health";
import { createBrowserRender } from "./browser-tools";
import { createAuthTool } from "./auth-tools";
import { createAIExtractorTool } from "./extractor-tools";

// --- Configuration & Model Definitions ---

/**
 * @constant Llama4Scout
 * @description Model ID for Llama 4 Scout.
 * @type {string}
 * @example const model = Llama4Scout;
 */
const Llama4Scout = "@cf/meta/llama-4-scout-17b-16e-instruct" as const;

/**
 * @constant MistralSmall3_1
 * @description Model ID for Mistral Small 3.1.
 * @type {string}
 */
const MistralSmall3_1 = "@cf/mistralai/mistral-small-3.1-24b-instruct" as const;

/**
 * @constant Hermes2Pro
 * @description Model ID for Hermes 2 Pro (Mistral 7B).
 * @type {string}
 */
const Hermes2Pro = "@hf/nousresearch/hermes-2-pro-mistral-7b" as const;

/**
 * @constant Llama3_3
 * @description Model ID for Llama 3.3 70B Instruct.
 * @type {string}
 */
const Llama3_3 = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

/**
 * @typedef {string} StructuredModel
 * @description A type union representing all AI model identifiers
 * supported by the `StructuredResponseTool`.
 */
type StructuredModel =
    | typeof Llama4Scout
    | typeof MistralSmall3_1
    | typeof Hermes2Pro
    | typeof Llama3_3;

/**
 * @constant EmbedModel
 * @description Model ID for the BAAI General Embedding (bge) model.
 * @type {string}
 */
const EmbedModel = "@cf/baai/bge-large-en-v1.5" as const;

/**
 * @constant RerankerModel
 * @description Model ID for the BAAI Reranker model.
 * @type {string}
 */
const RerankerModel = "@cf/baai/bge-reranker-base" as const;

// --- Interfaces & Types ---

/**
 * @interface AiBinding
 * @description Defines the expected interface for a Cloudflare AI binding (`env.AI`).
 * This provides type safety for mock environments or advanced binding usage.
 */
interface AiBinding {
    run: (model: string, options: any) => Promise<any>;
}

/**
 * @interface VectorizeBinding
 * @description Defines the expected interface for a Cloudflare Vectorize binding
 * (e.g., `env.VECTORIZE_INDEX`).
 */
interface VectorizeBinding {
    query: (vector: number[], options: { topK: number }) => Promise<any>;
}

/**
 * @interface EmbeddingResponse
 * @description Represents the raw, successful response structure from the
 * Cloudflare embedding model (`@cf/baai/bge-large-en-v1.5`).
 */
interface EmbeddingResponse {
    shape: number[];
    data: number[][];
}

/**
 * @interface StructuredResponse
 * @description A standardized wrapper for all responses from `StructuredResponseTool`.
 * This ensures predictable error handling and metadata for consumers.
 * @template T The type of the structured result, inferred from the provided Zod schema.
 */
interface StructuredResponse<T> {
    /**
     * @property {boolean} success - True if the AI call was successful *and*
     * the response was successfully parsed and validated against the schema.
     */
    success: boolean;
    /**
     * @property {StructuredModel} modelUsed - The string identifier of the AI model
     * that processed this request (e.g., '@cf/meta/llama-4-scout...').
     */
    modelUsed: StructuredModel;
    /**
     * @property {T | null} structuredResult - The Zod-validated JSON object if
     * `success` is true, otherwise null.
     */
    structuredResult: T | null;
    /**
     * @property {string | undefined} error - A detailed error message if
     * `success` is false.
     */
    error?: string;
    /**
     * @property {boolean | undefined} isChunked - True if the response was generated
     * by splitting a large text payload into multiple AI calls.
     */
    isChunked?: boolean;
}

// --- Embedding Tool Class ---

/**
 * @class EmbeddingTool
 * @description Provides a high-level API for interacting with Cloudflare's
 * embedding and reranking AI models.
 *
 * @example
 * // In a Worker:
 * const embedTool = new EmbeddingTool(env);
 * const vector = await embedTool.generateEmbedding("Hello world");
 * const searchResults = [...] // from Vectorize
 * const reranked = await embedTool.rerankMatches("Hello world", searchResults);
 */
export class EmbeddingTool {
    private env: Env;

    /**
     * @constructor
     * @param {Env} env - The Cloudflare Worker environment object, which must
     * contain the `AI` binding.
     */
    constructor(env: Env) {
        this.env = env;
    }

    /**
     * @method generateEmbedding
     * @description Generates a vector embedding for a single text string.
     * @param {string} query - The text to embed.
     * @returns {Promise<number[]>} A promise that resolves to the vector embedding.
     * @throws {Error} Throws an error if the AI model fails or returns an
     * unexpected data shape.
     */
    public async generateEmbedding(query: string): Promise<number[]> {
        try {
            // `this.env.AI.run` is the native Cloudflare Workers AI binding.
            const queryVector: EmbeddingResponse = await this.env.AI.run(EmbedModel, {
                text: [query], // The embedding model expects an array of strings.
            });

            // Defensive check for a valid response structure.
            if (!queryVector?.data?.[0]) {
                throw new Error(
                    `Failed to generate embedding for query: ${query.substring(0, 100)}...`,
                );
            }

            return queryVector.data[0]; // Return the first (and only) embedding.
        } catch (error) {
            // Wrap the error for better upstream logging.
            throw new Error(
                `Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * @method generateBatchEmbeddings
     * @description Generates vector embeddings for an array of text strings in a
     * single batch request.
     * @param {string[]} queries - An array of text strings to embed.
     * @returns {Promise<number[][]>} A promise that resolves to an array of
     * vector embeddings, in the same order as the input.
     * @throws {Error} Throws if the AI model fails or returns a mismatched
     * number of embeddings.
     */
    public async generateBatchEmbeddings(queries: string[]): Promise<number[][]> {
        try {
            const batchResponse: EmbeddingResponse = await this.env.AI.run(
                EmbedModel,
                {
                    text: queries,
                },
            );

            // Validate that the response contains the expected number of embeddings.
            if (
                !batchResponse?.data ||
                batchResponse.data.length !== queries.length
            ) {
                throw new Error(
                    `Batch embedding generation failed. Expected ${queries.length} embeddings, got ${batchResponse?.data?.length || 0}`,
                );
            }

            return batchResponse.data;
        } catch (error) {
            throw new Error(
                `Batch embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * @method rerankMatches
     * @description Reranks a list of search results against a query.
     * This is used to improve the relevance of initial search results
     * (e.g., from Vectorize) before returning them to the user.
     *
     * @param {string} query - The original search query.
     * @param {any[]} matches - An array of match objects (e.g., from Vectorize).
     * @param {string} [contextField='text'] - The property name on the `match`
     * object (or `match.metadata`) that contains the text to be reranked.
     * @returns {Promise<any[]>} A new array of match objects, sorted by the
     * new reranked `score` (descending). Includes `originalIndex`.
     */
    public async rerankMatches(
        query: string,
        matches: any[],
        contextField: string = "text",
    ): Promise<any[]> {
        try {
            const rerankedMatches = await Promise.all(
                matches.map(async (match, index) => {
                    try {
                        // Extract the text content to be reranked.
                        // flexible-access-pattern
                        const context =
                            match.metadata?.[contextField] || match[contextField] || "";
                        
                        // Call the reranker model with the query and the context.
                        const response = await this.env.AI.run(RerankerModel, {
                            context,
                            query,
                        });

                        // Return the original match object, augmented with the new score.
                        return {
                            ...match,
                            score: response.score || 0, // `response.score` is the new relevance.
                            originalIndex: index,
                        };
                    } catch (error) {
                        // Failsafe: If a single rerank fails, return the original
                        // match with its original score (or 0) and log the error.
                        return {
                            ...match,
                            score: match.score || 0,
                            originalIndex: index,
                            rerankError:
                                error instanceof Error ? error.message : String(error),
                        };
                    }
                }),
            );

            // Sort the augmented matches by the new score in descending order.
            return rerankedMatches.sort((a, b) => b.score - a.score);
        } catch (error) {
            // Global failsafe: If the `Promise.all` fails, log the error
            // and return the original, unsorted matches.
            console.warn("Reranking failed, returning original matches:", error);
            return matches;
        }
    }
}

// --- Structured Response Tool Class ---

/**
 * @class StructuredResponseTool
 * @description Provides a high-level API to force LLM output into a
 * Zod-defined schema.
 *
 * This class is the core of reliable, agentic JSON-based workflows. It manages:
 * - Converting Zod schemas to JSON Schemas for the model.
 * - Calling models using native Cloudflare AI JSON Mode.
 * - Automatic model selection based on text size (e.g., large-context vs. small).
 * - Automatic model fallback (tries multiple models on failure).
 * - Automatic text chunking and result merging for payloads exceeding context limits.
 * - Default value filling to ensure schema compliance even if the AI omits fields.
 *
 * @example
 * // In a Worker:
 * const { z } = import "zod";
 * const structuredTool = new StructuredResponseTool(env);
 *
 * const userSchema = z.object({
 * name: z.string().describe("The user's full name"),
 * age: z.number().optional().describe("The user's age"),
 * email: z.string().email().describe("The user's email address")
 * });
 *
 * const text = "My name is Jane Doe, my email is jane@example.com and I'm 30.";
 *
 * const response = await structuredTool.analyzeText(userSchema, text);
 *
 * if (response.success) {
 * console.log(response.structuredResult.name); // "Jane Doe"
 * console.log(response.structuredResult.email); // "jane@example.com"
 * } else {
 * console.error(response.error);
 * }
 */
export class StructuredResponseTool {
    private env: Env;

    /**
     * @property {number} maxSmallContextChars
     * @description Character limit to determine if a text payload is "large".
     * If `textPayload.length > maxSmallContextChars`, the tool will
     * prioritize large-context models (Llama4, Mistral) or chunking.
     * @default 80000
     */
    private maxSmallContextChars: number = 80000;

    /**
     * @constructor
     * @param {Env} env - The Cloudflare Worker environment object, which must
     * contain the `AI` binding.
     */
    constructor(env: Env) {
        this.env = env;
    }

    /**
     * @private
     * @method fillMissingFields
     * @description Pre-parses an AI's JSON response and fills in missing
     * fields with schema-appropriate default values (e.g., `[]` for arrays,
     * `""` for strings).
     *
     * This is a crucial robustness feature. LLMs often omit fields that are
     * `null` or empty (like an empty `tags: []` array). This method
     * prevents Zod validation from failing by ensuring every field
     * defined in the schema is present before the final parse.
     *
     * @template T - A ZodObject schema.
     * @param {T} schema - The Zod schema to enforce.
     * @param {any} aiResponse - The raw, partial JSON object from the AI.
     * @returns {z.infer<T>} A new object with all fields present.
     * @throws {Error} Throws a Zod validation error if the final,
     * filled object *still* doesn't match the schema (e.g., wrong data type).
     */
    private fillMissingFields<T extends ZodObject<any>>(
        schema: T,
        aiResponse: any,
    ): z.infer<T> {
        const fullResponse: any = { ...aiResponse };
        const properties = schema.shape as Record<string, ZodSchema<any>>;

        // Iterate over all keys defined in the Zod schema
        for (const key in properties) {
            // If the AI's response doesn't have the key, add it.
            if (!(key in fullResponse) || fullResponse[key] === undefined) {
                const zodType = properties[key];

                // Assign a default value based on the Zod type.
                if (zodType._def?.typeName === "ZodArray") {
                    fullResponse[key] = [];
                } else if (zodType._def?.typeName === "ZodObject") {
                    fullResponse[key] = {};
                } else if (zodType._def?.typeName === "ZodString") {
                    fullResponse[key] = "";
                } else if (zodType._def?.typeName === "ZodNumber") {
                    fullResponse[key] = 0;
                } else if (zodType._def?.typeName === "ZodBoolean") {
                    fullResponse[key] = false;
                } else {
                    // For optional, nullable, or complex types, default to null.
                    fullResponse[key] = null;
                }
            }
        }

        // Perform the final validation parse. This will throw if the AI
        // provided a *wrong* type (e.g., string for number).
        return schema.parse(fullResponse);
    }

    /**
     * @private
     * @method executeModel
     * @description The core internal function that executes a single request
     * against a specific model using Cloudflare's native JSON Mode.
     *
     * @template T - A ZodObject schema.
     * @param {StructuredModel} modelName - The identifier of the model to run.
     * @param {string} text - The text payload to analyze.
     * @param {T} schema - The Zod schema for the expected output.
     * @param {boolean} [isChunk=false] - A flag to pass through to the
     * final `StructuredResponse` object.
     * @returns {Promise<StructuredResponse<z.infer<T>>>} The structured response.
     */
    private async executeModel<T extends ZodObject<any>>(
        modelName: StructuredModel,
        text: string,
        schema: T,
        isChunk: boolean = false,
    ): Promise<StructuredResponse<z.infer<T>>> {
        try {
            // 1. Convert the Zod schema to a JSON Schema specification.
            //    `$refStrategy: "none"` ensures the entire schema is inlined,
            //    which is required by the AI model.
            const jsonSchema = zodToJsonSchema(schema, { $refStrategy: "none" });

            // 2. Clean up the JSON Schema.
            //    `zodToJsonSchema` adds a `$schema` key that Workers AI doesn't need.
            if (jsonSchema && typeof jsonSchema === "object" && "$schema" in jsonSchema) {
                delete (jsonSchema as any).$schema;
            }

            // 3. Define the prompt for the model.
            const prompt = `Analyze the provided TEXT and conform your output strictly to the JSON structure required by the schema. Only output the JSON object, no additional text or formatting.

TEXT: "${text}"

Please respond with valid JSON that matches the expected schema structure.`;

            // 4. Call the Workers AI binding with JSON Mode enabled.
            const response = await this.env.AI.run(modelName, {
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant that analyzes text and returns structured JSON responses according to the provided schema.",
                    },
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
                // This is the key to native JSON Mode.
                response_format: {
                    type: "json_schema",
                    json_schema: jsonSchema,
                },
            });

            // 5. Extract the response.
            //    The AI binding returns the JSON object in the `response` property.
            const resultObject = response?.response || response;

            // 6. Fill missing fields and validate.
            const validatedResponse = this.fillMissingFields(schema, resultObject);

            // 7. Return the standard success response.
            return {
                success: true,
                modelUsed: modelName,
                structuredResult: validatedResponse,
                isChunked: isChunk,
            };
        } catch (e: any) {
            // 8. Return the standard error response.
            return {
                success: false,
                modelUsed: modelName,
                structuredResult: null,
                error: `Model ${modelName} failed: ${e.message || String(e)}`,
                isChunked: isChunk,
            };
        }
    }

    /**
     * @private
     * @method chunkAndMerge
     * @description A fallback strategy for handling text payloads that are
     * too large for even large-context models, or if those models fail.
     *
     * It works by:
     * 1. Splitting the `fullText` into chunks based on `maxSmallContextChars`.
     * 2. Running `executeModel` on each chunk individually.
     * 3. Merging the resulting JSON objects from each chunk.
     *
     * **Merge Logic:**
     * - **Arrays:** Concatenated.
     * - **Objects:** Shallow-merged (properties from later chunks overwrite earlier ones).
     * - **Primitives:** Overwritten (last chunk wins).
     *
     * @template T - A ZodObject schema.
     * @param {typeof Llama4Scout | typeof MistralSmall3_1} modelName - The model to use.
     * @param {string} fullText - The complete, large text payload.
     * @param {T} schema - The Zod schema.
     * @returns {Promise<StructuredResponse<z.infer<T>>>} The merged structured response.
     */
    private async chunkAndMerge<T extends ZodObject<any>>(
        modelName: typeof Llama4Scout | typeof MistralSmall3_1,
        fullText: string,
        schema: T,
    ): Promise<StructuredResponse<z.infer<T>>> {
        const chunkSize = this.maxSmallContextChars;
        const textChunks: string[] = [];

        // 1. Split text into chunks.
        for (let i = 0; i < fullText.length; i += chunkSize) {
            textChunks.push(fullText.substring(i, i + chunkSize));
        }

        const mergedResults: Record<string, any> = {};

        // 2. Process each chunk.
        for (let i = 0; i < textChunks.length; i++) {
            const result = await this.executeModel(
                modelName,
                textChunks[i],
                schema,
                true, // Mark as chunked
            );

            // If any chunk fails, the whole operation fails.
            if (!result.success || !result.structuredResult) {
                return {
                    success: false,
                    modelUsed: modelName,
                    structuredResult: null,
                    error: `Chunking failure on chunk ${i + 1}/${textChunks.length}: ${result.error}`,
                    isChunked: true,
                };
            }

            const currentResult = result.structuredResult;

            // 3. Perform the merge.
            for (const key in currentResult) {
                const value = currentResult[key as keyof typeof currentResult];

                if (Array.isArray(value)) {
                    // Concatenate arrays
                    mergedResults[key] = mergedResults[key]
                        ? [...mergedResults[key], ...value]
                        : value;
                } else if (
                    value !== null &&
                    typeof value === "object" &&
                    !Array.isArray(value)
                ) {
                    // Merge objects
                    mergedResults[key] = { ...mergedResults[key], ...value };
                } else if (value !== null && value !== undefined) {
                    // Overwrite primitives
                    mergedResults[key] = value;
                }
            }
        }

        // 4. Validate the final merged object.
        const validatedFinal = this.fillMissingFields(schema, mergedResults);

        return {
            success: true,
            modelUsed: modelName,
            structuredResult: validatedFinal,
            isChunked: true,
        };
    }

    /**
     * @public
     * @method analyzeText
     * @description The primary public method for this class. Analyzes a text
     * payload and returns a schema-enforced JSON object.
     *
     * This method contains the main routing and fallback logic:
     * 1. **Large Text:** If text > `maxSmallContextChars`:
     * - Try `Llama4Scout`.
     * - On failure, try `MistralSmall3_1`.
     * - On failure, fall back to `chunkAndMerge` with `Llama4Scout`.
     * 2. **Small Text:**
     * - Try `Hermes2Pro` (fastest).
     * - On failure, try `MistralSmall3_1`.
     * - On failure, try `Llama4Scout`.
     * - On failure, try `Llama3_3`.
     * 3. If all attempts fail, return a final error response.
     *
     * @template T - A ZodObject schema.
     * @param {T} schema - The Zod schema for the expected output.
     * @param {string} textPayload - The input text to analyze.
     * @returns {Promise<StructuredResponse<z.infer<T>>>} The structured response.
     */
    public async analyzeText<T extends ZodObject<any>>(
        schema: T,
        textPayload: string,
    ): Promise<StructuredResponse<z.infer<T>>> {
        const textCharLength = textPayload.length;

        if (textCharLength > this.maxSmallContextChars) {
            // --- Large Text Strategy ---
            let result = await this.executeModel(Llama4Scout, textPayload, schema);
            if (result.success) return result;

            result = await this.executeModel(MistralSmall3_1, textPayload, schema);
            if (result.success) return result;

            // Fallback to chunking
            return this.chunkAndMerge(Llama4Scout, textPayload, schema);
        } else {
            // --- Small Text Strategy (Prioritizes speed) ---
            let result = await this.executeModel(Hermes2Pro, textPayload, schema);
            if (result.success) return result;

            result = await this.executeModel(MistralSmall3_1, textPayload, schema);
            if (result.success) return result;

            result = await this.executeModel(Llama4Scout, textPayload, schema);
            if (result.success) return result;

            result = await this.executeModel(Llama3_3, textPayload, schema);
            if (result.success) return result;

            // --- All models failed ---
            return {
                success: false,
                modelUsed: Llama3_3, // Reports the last model tried
                structuredResult: null,
                error: "All models failed to generate a valid structured response.",
            };
        }
    }

    /**
     * @public
     * @method analyzeTextWithModel
     * @description Bypasses the automatic selection and fallback logic to run
     * analysis with one specific model.
     *
     * This is primarily useful for:
     * - Testing a specific model's performance or compliance.
     * - Debugging a failing model.
     * - Workflows that require a specific model for consistency.
     *
     * @template T - A ZodObject schema.
     * @param {T} schema - The Zod schema.
     * @param {string} textPayload - The input text.
     * @param {StructuredModel} modelName - The specific model to use.
     * @returns {Promise<StructuredResponse<z.infer<T>>>} The structured response.
     */
    public async analyzeTextWithModel<T extends ZodObject<any>>(
        schema: T,
        textPayload: string,
        modelName: StructuredModel,
    ): Promise<StructuredResponse<z.infer<T>>> {
        return this.executeModel(modelName, textPayload, schema);
    }

    /**
     * @public
     * @method getAvailableModels
     * @description Returns a list of all model identifiers supported by this tool.
     * @returns {StructuredModel[]} An array of model ID strings.
     */
    public getAvailableModels(): StructuredModel[] {
        return [Llama4Scout, MistralSmall3_1, Hermes2Pro, Llama3_3];
    }
}

// --- Convenience Factory Functions ---

/**
 * @function createEmbeddingTool
 * @description Factory function to create a new instance of `EmbeddingTool`.
 * @param {Env} env - The Cloudflare Worker environment bindings.
 * @returns {EmbeddingTool} A new EmbeddingTool instance.
 */
export function createEmbeddingTool(env: Env): EmbeddingTool {
    return new EmbeddingTool(env);
}

/**
 * @function createStructuredResponseTool
 * @description Factory function to create a new instance of `StructuredResponseTool`.
 * @param {Env} env - The Cloudflare Worker environment bindings.
 * @returns {StructuredResponseTool} A new StructuredResponseTool instance.
 */
export function createStructuredResponseTool(env: Env): StructuredResponseTool {
    return new StructuredResponseTool(env);
}

// --- Export Model Constants ---
/**
 * Re-exporting model constants for easy import by other modules.
 * @example import { Llama4Scout } from './tools';
 */
export {
    EmbedModel, Hermes2Pro,
    Llama3_3, Llama4Scout,
    MistralSmall3_1, RerankerModel
};

/**
 * Re-exporting core types for external use.
 * @example import type { StructuredResponse } from './tools';
 */
export type { StructuredModel, StructuredResponse };

// --- Health Monitoring Exports ---

/**
 * Re-exporting health monitoring tools and types.
 */
export {
    createToolsHealthMonitor,
    createAIToolsHealthChecker,
    createBrowserToolsHealthChecker,
    createAuthToolsHealthChecker,
    createExtractorToolsHealthChecker,
    ToolsHealthMonitor,
};
// Note: These re-exports from sub-files (e.g., './ai-tools.health')
// were in the original `index.ts` and are preserved here.
export { createAIToolsHealthChecker as createAIToolsHealthChecker_sub } from './ai-tools.health';
export { createBrowserToolsHealthChecker as createBrowserToolsHealthChecker_sub } from './browser-tools.health';
export { createAuthToolsHealthChecker as createAuthToolsHealthChecker_sub } from './auth-tools.health';
export { createExtractorToolsHealthChecker as createExtractorToolsHealthChecker_sub } from './extractor-tools.health';

/**
 * Re-exporting health status types.
 */
export type {
    SystemHealthStatus,
    QuickHealthStatus,
    AIToolsHealthStatus,
    BrowserToolsHealthStatus,
    AuthToolsHealthStatus,
    ExtractorToolsHealthStatus
};

// --- High-Level Toolkit Factory ---

/**
 * @function createToolkit
 * @description The primary factory for the entire toolset.
 * Instantiates all tools (`ai`, `browser`, `auth`, `health`)
 * and passes the shared environment to them.
 *
 * @param {ExtendedEnv} env - The full Cloudflare Worker environment,
 * including bindings for AI, Browser Rendering, etc.
 * @returns An object containing instances of all tools.
 *
 * @example
 * // In worker.ts
 * import { createToolkit } from './tools';
 *
 * export default {
 * async fetch(request, env, ctx) {
 * const tools = createToolkit(env);
 * const embedding = await tools.ai.embedding.generateEmbedding("test");
 * const isHealthy = await tools.health.isReady();
 * // ...
 * }
 * }
 */
export function createToolkit(env: ExtendedEnv) {
    return {
        ai: {
            embedding: createEmbeddingTool(env),
            structured: createStructuredResponseTool(env),
            extractor: createAIExtractorTool(env),
        },
        browser: createBrowserRender(env),
        auth: createAuthTool(env),
        health: createToolsHealthMonitor(env)
    };
}

/**
 * @interface ToolConfig
 * @description Defines the configuration structure for the toolkit.
 * This allows for centralized, typed configuration management.
 */
export interface ToolConfig {
    ai: {
        maxRetries: number;
        timeout: number;
        fallbackModels: boolean;
    };
    browser: {
        timeout: number;
        viewport: {
            width: number;
            height: number;
        };
        userAgent?: string;
    };
    auth: {
        tokenExpiry: number; // in seconds
        allowedOrigins: string[];
    };
    health: {
        checkInterval: number; // in milliseconds
        enableMetrics: boolean;
    };
}

/**
 * @constant DEFAULT_TOOL_CONFIG
 * @description Provides sensible default values for the entire toolkit.
 * This can be merged with partial user-provided configurations.
 */
export const DEFAULT_TOOL_CONFIG: ToolConfig = {
    ai: {
        maxRetries: 3,
        timeout: 30000,
        fallbackModels: true
    },
    browser: {
        timeout: 30000,
        viewport: {
            width: 1920,
            height: 1080
        },
        userAgent: 'Travel-Agent-Worker/1.0' // Example User Agent
    },
    auth: {
        tokenExpiry: 3600, // 1 hour
        allowedOrigins: ['*'] // Default to all origins
    },
    health: {
        checkInterval: 60000, // 1 minute
        enableMetrics: true
    }
};

/**
 * @function createToolkitWithHealth
 * @description An enhanced factory that instantiates the toolkit and merges
 * a partial configuration with the defaults.
 *
 * It also flattens the health check methods to the top level of the
 * returned object for easy access in health endpoints (e.g., `/healthz`).
 *
 * @param {ExtendedEnv} env - The full Cloudflare Worker environment.
 * @param {Partial<ToolConfig>} [config={}] - A partial configuration object
 * to override defaults.
 * @returns A toolkit object with a merged `config` and top-level health methods.
 *
 * @example
 * // In worker.ts
 * const toolkit = createToolkitWithHealth(env, {
 * auth: { tokenExpiry: 86400 } // Override one value
 * });
 *
 * // Easy health checks
 * const isReady = await toolkit.isReady();
 */
export function createToolkitWithHealth(env: ExtendedEnv, config: Partial<ToolConfig> = {}) {
    // Deep merge would be better, but for this structure, shallow merge is fine.
    const finalConfig = {
        ...DEFAULT_TOOL_CONFIG,
        ...config,
        ai: { ...DEFAULT_TOOL_CONFIG.ai, ...config.ai },
        browser: { ...DEFAULT_TOOL_CONFIG.browser, ...config.browser },
        auth: { ...DEFAULT_TOOL_CONFIG.auth, ...config.auth },
        health: { ...DEFAULT_TOOL_CONFIG.health, ...config.health },
    };

    const toolkit = createToolkit(env);
    
    return {
        ...toolkit,
        config: finalConfig,
        // --- Convenience Health Methods ---
        /** @function healthCheck - Alias for quickHealthCheck */
        healthCheck: () => toolkit.health.quickHealthCheck(),
        /** @function systemHealth - Runs a full, deep health check */
        systemHealth: () => toolkit.health.checkSystemHealth(),
        /** @function isReady - Checks if all critical components are operational */
        isReady: () => toolkit.health.isReady(),
        /** @function isAlive - A simple liveness check */
        isAlive: () => toolkit.health.isAlive(),
        /** @function getMetrics - Retrieves Prometheus-formatted metrics */
        getMetrics: () => toolkit.health.getMetrics()
    };
}
