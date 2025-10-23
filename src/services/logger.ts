import { broadcastLogEntry } from "./realtime";
import type { Bindings } from "../bindings";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export interface LogMetadata {
  requestId?: string;
  url?: string;
  prompt?: string;
  selector?: string;
  errorStack?: string;
  details?: unknown;
  modelUsed?: string;
}

export async function logEvent(env: Bindings, level: LogLevel, message: string, metadata: LogMetadata = {}) {
  const now = new Date().toISOString();
  const entry = {
    timestamp: now,
    level,
    message,
    ...metadata,
  };

  broadcastLogEntry(entry, metadata.requestId);

  await env.DB.prepare(
    `INSERT INTO scraper_logs (timestamp, level, message, request_id, url, prompt, selector, error_stack, details, model_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      now,
      level,
      message,
      metadata.requestId ?? null,
      metadata.url ?? null,
      metadata.prompt ?? null,
      metadata.selector ?? null,
      metadata.errorStack ?? null,
      metadata.details ? JSON.stringify(metadata.details) : null,
      metadata.modelUsed ?? null,
    )
    .run();
}
