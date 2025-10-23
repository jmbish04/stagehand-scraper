import type { Bindings } from "../bindings";

export interface ScrapeRequestRecord {
  id: string;
  url: string;
  goal: string;
  schemaJson: string;
  schemaSource: "provided" | "generated";
  status: "queued" | "running" | "completed" | "failed";
  outcome: "pass" | "fail" | "unknown";
  modelUsed?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScrapeRequestSummary {
  id: string;
  url: string;
  goal: string;
  status: ScrapeRequestRecord["status"];
  outcome: ScrapeRequestRecord["outcome"];
  modelUsed?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestStepRecord {
  id: string;
  requestId: string;
  stepIndex: number;
  status: "pending" | "running" | "completed" | "failed";
  goal?: string;
  currentUrl?: string;
  thoughts?: string;
  plannedAction?: string;
  expectedOutcome?: string;
  actualOutcome?: string;
  actionPayload?: unknown;
  resultPayload?: unknown;
  createdAt: string;
  updatedAt: string;
}

export type AssetType = "screenshot" | "html" | "text" | "css" | "console" | "analysis";

export async function createScrapeRequest(env: Bindings, data: {
  id: string;
  url: string;
  goal: string;
  schemaJson: string;
  schemaSource: "provided" | "generated";
}): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO scrape_requests (id, url, goal, schema_json, schema_source, status, outcome, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 'unknown', ?, ?)`
  )
    .bind(data.id, data.url, data.goal, data.schemaJson, data.schemaSource, now, now)
    .run();
}

export async function updateScrapeRequestStatus(env: Bindings, id: string, updates: Partial<{
  status: ScrapeRequestRecord["status"];
  outcome: ScrapeRequestRecord["outcome"];
  modelUsed: string | null;
  error: string | null;
}>): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.status) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.outcome) {
    sets.push("outcome = ?");
    values.push(updates.outcome);
  }
  if (updates.modelUsed !== undefined) {
    sets.push("model_used = ?");
    values.push(updates.modelUsed);
  }
  if (updates.error !== undefined) {
    sets.push("error = ?");
    values.push(updates.error);
  }
  sets.push("updated_at = ?");
  const now = new Date().toISOString();
  values.push(now);
  values.push(id);

  await env.DB.prepare(
    `UPDATE scrape_requests SET ${sets.join(", ")} WHERE id = ?`
  ).bind(...values).run();
}

export async function insertRequestStep(env: Bindings, data: {
  id: string;
  requestId: string;
  stepIndex: number;
  status: RequestStepRecord["status"];
  goal?: string;
  currentUrl?: string;
  thoughts?: string;
  plannedAction?: string;
  expectedOutcome?: string;
  actualOutcome?: string;
  actionPayload?: unknown;
  resultPayload?: unknown;
}): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO request_steps (
      id, request_id, step_index, status, goal, current_url, thoughts, planned_action, expected_outcome, actual_outcome,
      action_payload, result_payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      data.id,
      data.requestId,
      data.stepIndex,
      data.status,
      data.goal ?? null,
      data.currentUrl ?? null,
      data.thoughts ?? null,
      data.plannedAction ?? null,
      data.expectedOutcome ?? null,
      data.actualOutcome ?? null,
      data.actionPayload ? JSON.stringify(data.actionPayload) : null,
      data.resultPayload ? JSON.stringify(data.resultPayload) : null,
      now,
      now,
    )
    .run();
}

export async function finalizeRequestStep(env: Bindings, id: string, updates: Partial<{
  status: RequestStepRecord["status"];
  currentUrl: string;
  thoughts: string;
  plannedAction: string;
  expectedOutcome: string;
  actualOutcome: string;
  resultPayload: unknown;
}>): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.status) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.currentUrl) {
    sets.push("current_url = ?");
    values.push(updates.currentUrl);
  }
  if (updates.thoughts) {
    sets.push("thoughts = ?");
    values.push(updates.thoughts);
  }
  if (updates.plannedAction) {
    sets.push("planned_action = ?");
    values.push(updates.plannedAction);
  }
  if (updates.expectedOutcome) {
    sets.push("expected_outcome = ?");
    values.push(updates.expectedOutcome);
  }
  if (updates.actualOutcome) {
    sets.push("actual_outcome = ?");
    values.push(updates.actualOutcome);
  }
  if (updates.resultPayload) {
    sets.push("result_payload = ?");
    values.push(JSON.stringify(updates.resultPayload));
  }
  sets.push("updated_at = ?");
  const now = new Date().toISOString();
  values.push(now);
  values.push(id);

  await env.DB.prepare(`UPDATE request_steps SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
}

export async function attachAsset(env: Bindings, data: {
  requestId: string;
  stepId: string;
  assetType: AssetType;
  mimeType: string;
  content?: ArrayBuffer;
  textContent?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO request_step_assets (request_id, step_id, asset_type, mime_type, content, text_content)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      data.requestId,
      data.stepId,
      data.assetType,
      data.mimeType,
      data.content ? new Uint8Array(data.content) : null,
      data.textContent ?? null,
    )
    .run();
}

export async function storeScrapeResult(env: Bindings, data: { requestId: string; resultJson: string; analysis?: string | null; }): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO scrape_results (request_id, result_json, analysis, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(request_id) DO UPDATE SET result_json = excluded.result_json, analysis = excluded.analysis`
  )
    .bind(data.requestId, data.resultJson, data.analysis ?? null, now)
    .run();
}

export async function listRecentRequests(env: Bindings, limit = 50): Promise<ScrapeRequestSummary[]> {
  const result = await env.DB.prepare(
    `SELECT id, url, goal, status, outcome, model_used as modelUsed, error, created_at as createdAt, updated_at as updatedAt
     FROM scrape_requests
     ORDER BY datetime(updated_at) DESC
     LIMIT ?`
  )
    .bind(limit)
    .all<ScrapeRequestSummary>();
  return result.results ?? [];
}

export async function loadRequest(env: Bindings, id: string): Promise<ScrapeRequestRecord | null> {
  const request = await env.DB.prepare(
    `SELECT id, url, goal, schema_json as schemaJson, schema_source as schemaSource, status, outcome, model_used as modelUsed,
            error, created_at as createdAt, updated_at as updatedAt
     FROM scrape_requests
     WHERE id = ?`
  )
    .bind(id)
    .first<ScrapeRequestRecord>();
  return request ?? null;
}

export async function listRequestSteps(env: Bindings, requestId: string) {
  const result = await env.DB.prepare(
    `SELECT id, request_id as requestId, step_index as stepIndex, status, goal, current_url as currentUrl, thoughts,
            planned_action as plannedAction, expected_outcome as expectedOutcome, actual_outcome as actualOutcome,
            action_payload as actionPayload, result_payload as resultPayload, created_at as createdAt, updated_at as updatedAt
     FROM request_steps
     WHERE request_id = ?
     ORDER BY step_index`
  )
    .bind(requestId)
    .all<RequestStepRecord & { actionPayload: string | null; resultPayload: string | null }>();

  return (result.results ?? []).map(row => ({
    ...row,
    actionPayload: row.actionPayload ? JSON.parse(row.actionPayload) : null,
    resultPayload: row.resultPayload ? JSON.parse(row.resultPayload) : null,
  }));
}

export async function listAssetsForStep(env: Bindings, stepId: string) {
  const result = await env.DB.prepare(
    `SELECT id, request_id as requestId, step_id as stepId, asset_type as assetType, mime_type as mimeType,
            content, text_content as textContent, created_at as createdAt
     FROM request_step_assets WHERE step_id = ?`
  )
    .bind(stepId)
    .all<{
      id: number;
      requestId: string;
      stepId: string;
      assetType: AssetType;
      mimeType: string;
      content: ArrayBuffer | null;
      textContent: string | null;
      createdAt: string;
    }>();
  return result.results ?? [];
}

export async function loadScrapeResult(env: Bindings, requestId: string) {
  return env.DB.prepare(
    `SELECT request_id as requestId, result_json as resultJson, analysis, created_at as createdAt
     FROM scrape_results WHERE request_id = ?`
  )
    .bind(requestId)
    .first<{ requestId: string; resultJson: string; analysis: string | null; createdAt: string }>();
}
