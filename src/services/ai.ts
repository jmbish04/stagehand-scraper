import { z } from "zod";
import type { Bindings } from "../bindings";

const PRIMARY_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const DEEP_ANALYSIS_MODEL = "@cf/openai/gpt-oss-120b";

const StructuredResponseSchema = z.object({
  success: z.boolean().default(false),
  reasoning: z.string().optional(),
  data: z.unknown().optional(),
  needsDeeperAnalysis: z.boolean().optional(),
});

const DiscoverySchema = z.object({
  elements: z
    .array(
      z.object({
        label: z.string(),
        selector: z.string(),
        description: z.string().optional(),
      }),
    )
    .default([]),
  notes: z.string().optional(),
});

export async function generateSchemaFromPrompt(env: Bindings, prompt: string) {
  const systemPrompt = `You are a data architect that designs JSON schemas for scraped data. Given an English description, produce a strict JSON Schema object that captures the structure. Always include type information, required array if all fields required, and helpful descriptions.`;

  const { response } = (await env.AI.run(PRIMARY_MODEL as keyof AiModels, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_schema", json_schema: { name: "Schema", schema: { type: "object" } } },
  })) as AiTextGenerationOutput;

  return response as Record<string, unknown>;
}

export async function extractDataWithSchema(env: Bindings, input: {
  goal: string;
  schema: Record<string, unknown>;
  pageText: string;
  pageHtml: string;
  pageUrl: string;
}) {
  const systemPrompt = `You are an expert data extraction agent working from rendered HTML. Follow the provided schema exactly and return only valid JSON that conforms to it.`;

  const structuredSchema = {
    type: "object",
    properties: {
      success: { type: "boolean", description: "Whether extraction succeeded", default: true },
      reasoning: { type: "string" },
      needsDeeperAnalysis: { type: "boolean" },
      data: input.schema,
    },
    required: ["data"],
  } as const;

  const { response } = (await env.AI.run(PRIMARY_MODEL as keyof AiModels, {
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: `Goal: ${input.goal}` },
          { type: "text", text: `URL: ${input.pageUrl}` },
          { type: "text", text: "Visible text:" },
          { type: "text", text: input.pageText.slice(0, 15000) },
          { type: "text", text: "HTML snippet:" },
          { type: "text", text: input.pageHtml.slice(0, 15000) },
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: { name: "Extraction", schema: structuredSchema } },
  })) as AiTextGenerationOutput;

  const primary = StructuredResponseSchema.safeParse(response);
  if (primary.success && !primary.data.needsDeeperAnalysis) {
    return { data: primary.data.data ?? response, reasoning: primary.data.reasoning, model: PRIMARY_MODEL };
  }

  if (!primary.success || primary.data.needsDeeperAnalysis) {
    const { response: deepResponse } = (await env.AI.run(DEEP_ANALYSIS_MODEL as keyof AiModels, {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Goal: ${input.goal}` },
            { type: "text", text: `URL: ${input.pageUrl}` },
            { type: "text", text: "Visible text:" },
            { type: "text", text: input.pageText.slice(0, 15000) },
            { type: "text", text: "HTML snippet:" },
            { type: "text", text: input.pageHtml.slice(0, 15000) },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "Extraction", schema: input.schema } },
    })) as AiTextGenerationOutput;

    const secondary = StructuredResponseSchema.safeParse(deepResponse);
    if (secondary.success) {
      return { data: secondary.data.data ?? deepResponse, reasoning: secondary.data.reasoning, model: DEEP_ANALYSIS_MODEL };
    }
    return { data: deepResponse, reasoning: "Deep model returned raw response", model: DEEP_ANALYSIS_MODEL };
  }

  return { data: response, reasoning: "Primary model returned fallback payload", model: PRIMARY_MODEL };
}

export async function discoverUsefulSelectors(env: Bindings, input: {
  goal: string;
  pageUrl: string;
  pageText: string;
  pageHtml: string;
}) {
  const discoveryPrompt = `You are a discovery agent helping configure an autonomous web scraper. Identify the most important interactive elements or data containers that could help accomplish the goal. Return 3-7 selectors with human-friendly labels.`;

  const { response } = (await env.AI.run(PRIMARY_MODEL as keyof AiModels, {
    messages: [
      { role: "system", content: discoveryPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: `Goal: ${input.goal}` },
          { type: "text", text: `URL: ${input.pageUrl}` },
          { type: "text", text: "Visible text:" },
          { type: "text", text: input.pageText.slice(0, 8000) },
          { type: "text", text: "HTML snippet:" },
          { type: "text", text: input.pageHtml.slice(0, 8000) },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "Discovery",
        schema: {
          type: "object",
          properties: {
            elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  selector: { type: "string" },
                  description: { type: "string" },
                },
                required: ["label", "selector"],
              },
            },
            notes: { type: "string" },
          },
        },
      },
    },
  })) as AiTextGenerationOutput;

  const parsed = DiscoverySchema.safeParse(response);
  if (parsed.success) {
    return parsed.data;
  }
  return { elements: [], notes: "Model returned unstructured response" };
}
