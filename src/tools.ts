/**
 * @file src/tools.ts
 * @description Core AI tools for Cloudflare AI integration.
 *
 * @module This file provides AI tool classes:
 * 1. `EmbeddingTool`: Handles text embedding generation and search result reranking.
 * 2. `StructuredResponseTool`: Provides robust, schema-enforced JSON output from LLMs,
 * with automatic model fallback and context-aware chunking.
 *
 * @see EmbeddingTool For embedding and reranking logic.
 * @see StructuredResponseTool For schema-enforced LLM responses.
 */

import type { ZodObject, ZodSchema, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
// Assuming Env is defined in a way accessible here, e.g., via worker-configuration.d.ts
// If not, you might need a relative import like import type { Env } from "../worker-configuration";

// --- Configuration & Model Definitions ---

/** @constant Llama4Scout */
const Llama4Scout = "@cf/meta/llama-4-scout-17b-16e-instruct" as const;
/** @constant MistralSmall3_1 */
const MistralSmall3_1 = "@cf/mistralai/mistral-small-3.1-24b-instruct" as const;
/** @constant Hermes2Pro */
const Hermes2Pro = "@hf/nousresearch/hermes-2-pro-mistral-7b" as const;
/** @constant Llama3_3 */
const Llama3_3 = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

/** @typedef {string} StructuredModel */
type StructuredModel =
    | typeof Llama4Scout
    | typeof MistralSmall3_1
    | typeof Hermes2Pro
    | typeof Llama3_3;

/** @constant EmbedModel */
const EmbedModel = "@cf/baai/bge-large-en-v1.5" as const;
/** @constant RerankerModel */
const RerankerModel = "@cf/baai/bge-reranker-base" as const;

// --- Interfaces & Types ---

/** @interface AiBinding */
interface AiBinding {
    run: (model: string, options: any) => Promise<any>;
}

/** @interface EmbeddingResponse */
interface EmbeddingResponse {
    shape: number[];
    data: number[][];
}

/** @interface StructuredResponse */
interface StructuredResponse<T> {
    success: boolean;
    modelUsed: StructuredModel;
    structuredResult: T | null;
    error?: string;
    isChunked?: boolean;
}

// --- Embedding Tool Class ---

/** @class EmbeddingTool */
export class EmbeddingTool {
    private env: Env;

    constructor(env: Env) {
        this.env = env;
    }

    public async generateEmbedding(query: string): Promise<number[]> {
        try {
            const queryVector: EmbeddingResponse = await this.env.AI.run(EmbedModel, {
                text: [query],
            });
            if (!queryVector?.data?.[0]) {
                throw new Error(`Failed to generate embedding for query: ${query.substring(0, 100)}...`);
            }
            return queryVector.data[0];
        } catch (error) {
            throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async generateBatchEmbeddings(queries: string[]): Promise<number[][]> {
        try {
            const batchResponse: EmbeddingResponse = await this.env.AI.run(EmbedModel, { text: queries });
            if (!batchResponse?.data || batchResponse.data.length !== queries.length) {
                throw new Error(`Batch embedding generation failed. Expected ${queries.length} embeddings, got ${batchResponse?.data?.length || 0}`);
            }
            return batchResponse.data;
        } catch (error) {
            throw new Error(`Batch embedding generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

     public async rerankMatches(
        query: string,
        matches: any[],
        contextField: string = "text",
    ): Promise<any[]> {
        try {
            const rerankedMatches = await Promise.all(
                matches.map(async (match, index) => {
                    try {
                        const context = match.metadata?.[contextField] || match[contextField] || "";
                        const response = await this.env.AI.run(RerankerModel, { context, query });
                        return { ...match, score: response.score || 0, originalIndex: index };
                    } catch (error) {
                         console.error(`Reranking failed for match index ${index}:`, error); // Log specific error
                        return { ...match, score: match.score || 0, originalIndex: index, rerankError: error instanceof Error ? error.message : String(error) };
                    }
                }),
            );
            return rerankedMatches.sort((a, b) => b.score - a.score);
        } catch (error) {
            console.warn("Reranking failed globally, returning original matches:", error);
            return matches;
        }
    }
}

// --- Structured Response Tool Class ---

/** @class StructuredResponseTool */
export class StructuredResponseTool {
    private env: Env;
    private maxSmallContextChars: number = 80000; // ~32k tokens

    constructor(env: Env) {
        this.env = env;
    }

    private fillMissingFields<T extends ZodObject<any>>(schema: T, aiResponse: any): z.infer<T> {
        const fullResponse: any = { ...aiResponse };
        const properties = schema.shape as Record<string, ZodSchema<any>>;

        for (const key in properties) {
            if (!(key in fullResponse) || fullResponse[key] === undefined) {
                const zodType = properties[key];
                if (zodType._def?.typeName === "ZodArray") fullResponse[key] = [];
                else if (zodType._def?.typeName === "ZodObject") fullResponse[key] = {};
                else if (zodType._def?.typeName === "ZodString") fullResponse[key] = "";
                else if (zodType._def?.typeName === "ZodNumber") fullResponse[key] = 0;
                else if (zodType._def?.typeName === "ZodBoolean") fullResponse[key] = false;
                else fullResponse[key] = null;
            }
        }
        return schema.parse(fullResponse); // Final validation
    }

    private async executeModel<T extends ZodObject<any>>(
        modelName: StructuredModel, text: string, schema: T, isChunk: boolean = false
    ): Promise<StructuredResponse<z.infer<T>>> {
        try {
            const jsonSchema = zodToJsonSchema(schema, { $refStrategy: "none" });
             if (jsonSchema && typeof jsonSchema === "object" && "$schema" in jsonSchema) {
                delete (jsonSchema as any).$schema; // Remove unnecessary key
            }

            const prompt = `Analyze the provided TEXT and conform your output strictly to the JSON structure required by the schema. Only output the JSON object, no additional text or formatting.\n\nTEXT: "${text}"\n\nPlease respond with valid JSON that matches the expected schema structure.`;

            const response = await this.env.AI.run(modelName, {
                messages: [
                    { role: "system", content: "You are a helpful assistant that analyzes text and returns structured JSON responses according to the provided schema." },
                    { role: "user", content: prompt },
                ],
                response_format: { type: "json_schema", json_schema: jsonSchema },
            });

            const resultObject = response?.response || response;
            if (typeof resultObject !== 'object' || resultObject === null) {
                 throw new Error(`Model ${modelName} returned non-object response: ${JSON.stringify(resultObject)}`);
            }
            const validatedResponse = this.fillMissingFields(schema, resultObject);

            return { success: true, modelUsed: modelName, structuredResult: validatedResponse, isChunked: isChunk };
        } catch (e: any) {
             console.error(`Error executing model ${modelName}:`, e); // Log specific error
            return { success: false, modelUsed: modelName, structuredResult: null, error: `Model ${modelName} failed: ${e.message || String(e)}`, isChunked: isChunk };
        }
    }

    private async chunkAndMerge<T extends ZodObject<any>>(
        modelName: typeof Llama4Scout | typeof MistralSmall3_1, fullText: string, schema: T
    ): Promise<StructuredResponse<z.infer<T>>> {
        const chunkSize = this.maxSmallContextChars;
        const textChunks: string[] = [];
        for (let i = 0; i < fullText.length; i += chunkSize) {
            textChunks.push(fullText.substring(i, i + chunkSize));
        }

        const mergedResults: Record<string, any> = {};
        let firstModelUsed: StructuredModel | null = null; // Track the model used

        for (let i = 0; i < textChunks.length; i++) {
            const result = await this.executeModel(modelName, textChunks[i], schema, true);
            if (!firstModelUsed) firstModelUsed = result.modelUsed; // Store the first model used

            if (!result.success || !result.structuredResult) {
                return { success: false, modelUsed: result.modelUsed, structuredResult: null, error: `Chunking failure on chunk ${i + 1}/${textChunks.length}: ${result.error}`, isChunked: true };
            }

            const currentResult = result.structuredResult;
            for (const key in currentResult) {
                const value = currentResult[key as keyof typeof currentResult];
                if (Array.isArray(value)) {
                    mergedResults[key] = mergedResults[key] ? [...mergedResults[key], ...value] : value;
                } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                    mergedResults[key] = { ...mergedResults[key], ...value };
                } else if (value !== null && value !== undefined) {
                    mergedResults[key] = value;
                }
            }
        }
        try {
            const validatedFinal = this.fillMissingFields(schema, mergedResults);
             return { success: true, modelUsed: firstModelUsed || modelName, structuredResult: validatedFinal, isChunked: true };
        } catch(validationError: any) {
             console.error("Error validating merged chunks:", validationError);
             return { success: false, modelUsed: firstModelUsed || modelName, structuredResult: null, error: `Validation failed after merging chunks: ${validationError.message || String(validationError)}`, isChunked: true };
        }
    }

    public async analyzeText<T extends ZodObject<any>>(schema: T, textPayload: string): Promise<StructuredResponse<z.infer<T>>> {
        const textCharLength = textPayload.length;
        let finalResult: StructuredResponse<z.infer<T>> | null = null;

        if (textCharLength > this.maxSmallContextChars) {
            // Large Text Strategy
            let result = await this.executeModel(Llama4Scout, textPayload, schema);
            if (result.success) return result;
            finalResult = result; // Store last error

            result = await this.executeModel(MistralSmall3_1, textPayload, schema);
            if (result.success) return result;
            finalResult = result; // Store last error


            console.warn(`Large text models failed (${Llama4Scout}, ${MistralSmall3_1}), attempting chunking with ${Llama4Scout}...`);
            result = await this.chunkAndMerge(Llama4Scout, textPayload, schema);
             if (result.success) return result;
             finalResult = result; // Store chunking error


        } else {
            // Small Text Strategy (Prioritizes speed)
            let result = await this.executeModel(Hermes2Pro, textPayload, schema);
            if (result.success) return result;
            finalResult = result;

            result = await this.executeModel(MistralSmall3_1, textPayload, schema);
            if (result.success) return result;
             finalResult = result;

            result = await this.executeModel(Llama4Scout, textPayload, schema);
            if (result.success) return result;
             finalResult = result;

            result = await this.executeModel(Llama3_3, textPayload, schema);
            if (result.success) return result;
            finalResult = result; // Store the last error
        }

        // All attempts failed
        console.error("All models/strategies failed.", finalResult?.error);
        return finalResult ?? { // Return last known error or a generic one
             success: false,
             modelUsed: Llama3_3, // Report the last model tried in the sequence
             structuredResult: null,
             error: "All models failed to generate a valid structured response.",
         };
    }

    public async analyzeTextWithModel<T extends ZodObject<any>>(schema: T, textPayload: string, modelName: StructuredModel): Promise<StructuredResponse<z.infer<T>>> {
        return this.executeModel(modelName, textPayload, schema);
    }

    public getAvailableModels(): StructuredModel[] {
        return [Llama4Scout, MistralSmall3_1, Hermes2Pro, Llama3_3];
    }
}

// --- Convenience Factory Functions ---

export function createEmbeddingTool(env: Env): EmbeddingTool {
    return new EmbeddingTool(env);
}

export function createStructuredResponseTool(env: Env): StructuredResponseTool {
    return new StructuredResponseTool(env);
}

// --- Export Model Constants ---
export { EmbedModel, Hermes2Pro, Llama3_3, Llama4Scout, MistralSmall3_1, RerankerModel };
export type { StructuredModel, StructuredResponse };

// --- Removed Health, Browser, Auth, Extractor, Toolkit ---
// --- Removed DEFAULT_TOOL_CONFIG and createToolkitWithHealth ---
