import { bindConsoleLogging, captureAssetsForStep, withBrowserPage } from "./browser";
import { extractDataWithSchema } from "./ai";
import { logEvent } from "./logger";
import {
  attachAsset,
  createScrapeRequest,
  finalizeRequestStep,
  insertRequestStep,
  listRequestSteps,
  listAssetsForStep,
  loadRequest,
  loadScrapeResult,
  listRecentRequests,
  storeScrapeResult,
  updateScrapeRequestStatus,
} from "./requestStore";
import type { Bindings } from "../bindings";
import { deriveUrlPattern } from "../utils/url";

export interface OnDemandScrapePayload {
  id: string;
  url: string;
  goal: string;
  schema: Record<string, unknown>;
  schemaSource: "provided" | "generated";
}

export async function enqueueOnDemandScrape(env: Bindings, payload: OnDemandScrapePayload) {
  await createScrapeRequest(env, {
    id: payload.id,
    url: payload.url,
    goal: payload.goal,
    schemaJson: JSON.stringify(payload.schema),
    schemaSource: payload.schemaSource,
  });
}

export async function runScrapeJob(env: Bindings, payload: OnDemandScrapePayload) {
  const requestId = payload.id;
  await updateScrapeRequestStatus(env, requestId, { status: "running" });
  await logEvent(env, "INFO", "Starting scrape job", { requestId, url: payload.url, prompt: payload.goal });

  try {
    await withBrowserPage(env, async page => {
      const stepId = crypto.randomUUID();
      const consoleLogs: { type: string; text: string }[] = [];
      bindConsoleLogging(page, log => consoleLogs.push(log));

      await insertRequestStep(env, {
        id: stepId,
        requestId,
        stepIndex: 0,
        status: "running",
        goal: payload.goal,
        plannedAction: `Navigate to ${payload.url}`,
        expectedOutcome: "Page loads successfully",
        actionPayload: { type: "navigate", url: payload.url },
      });

      await page.goto(payload.url, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      await captureAssetsForStep(page, env, { requestId, stepId });
      if (consoleLogs.length > 0) {
        await attachAsset(env, {
          requestId,
          stepId,
          assetType: "console",
          mimeType: "application/json",
          textContent: JSON.stringify(consoleLogs, null, 2),
        });
      }

      const pageText: string = await page.evaluate(() => document.body?.innerText ?? "");
      const pageHtml: string = await page.content();

      const extraction = await extractDataWithSchema(env, {
        goal: payload.goal,
        schema: payload.schema,
        pageText,
        pageHtml,
        pageUrl: currentUrl,
      });

      await attachAsset(env, {
        requestId,
        stepId,
        assetType: "analysis",
        mimeType: "application/json",
        textContent: JSON.stringify({
          reasoning: extraction.reasoning,
          model: extraction.model,
        }),
      });

      await storeScrapeResult(env, {
        requestId,
        resultJson: JSON.stringify(extraction.data),
        analysis: extraction.reasoning ?? null,
      });

      await updateScrapeRequestStatus(env, requestId, { modelUsed: extraction.model });

      await finalizeRequestStep(env, stepId, {
        status: "completed",
        currentUrl,
        actualOutcome: "Page processed",
        resultPayload: extraction.data,
      });

      await env.DB.prepare(
        `INSERT INTO agentic_observations (
          timestamp, request_id, url, url_pattern, action_type, selector, text, navigate_url, goal, achieved, confidence,
          outcome, reason, page_title, extracted_text, agent_thoughts, planned_action, actual_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          new Date().toISOString(),
          requestId,
          currentUrl,
          deriveUrlPattern(currentUrl),
          "navigate",
          null,
          null,
          payload.url,
          payload.goal,
          1,
          0.9,
          "success",
          extraction.reasoning ?? "",
          await page.title(),
          pageText.slice(0, 2000),
          extraction.reasoning ?? "",
          `Navigate to ${payload.url}`,
          "Processed page data",
        )
        .run();
    });

    await updateScrapeRequestStatus(env, requestId, { status: "completed", outcome: "pass" });
    await logEvent(env, "INFO", "Scrape completed", { requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateScrapeRequestStatus(env, requestId, { status: "failed", outcome: "fail", error: message });
    await logEvent(env, "ERROR", "Scrape failed", {
      requestId,
      errorStack: error instanceof Error ? error.stack : undefined,
      details: { message },
    });
  }
}

export async function getRequestSummary(env: Bindings) {
  return listRecentRequests(env, 100);
}

export async function getRequestDetails(env: Bindings, requestId: string) {
  const request = await loadRequest(env, requestId);
  if (!request) return null;
  const steps = await listRequestSteps(env, requestId);
  const result = await loadScrapeResult(env, requestId);
  return { request, steps, result };
}

export async function getStepAssets(env: Bindings, stepId: string) {
  return listAssetsForStep(env, stepId);
}
