import playwright from "@cloudflare/playwright";
import type { Bindings } from "../bindings";
import { attachAsset } from "./requestStore";

export interface BrowserStepCaptureOptions {
  requestId: string;
  stepId: string;
}

export async function withBrowserPage<TReturn>(env: Bindings, handler: (page: any) => Promise<TReturn>): Promise<TReturn> {
  const browser = await playwright.launchChromium(env.BROWSER, { headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  try {
    return await handler(page);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

export async function captureAssetsForStep(page: any, env: Bindings, options: BrowserStepCaptureOptions) {
  const screenshot = await page.screenshot({ type: "png", fullPage: true });
  await attachAsset(env, {
    requestId: options.requestId,
    stepId: options.stepId,
    assetType: "screenshot",
    mimeType: "image/png",
    content: screenshot.buffer,
  });

  const html = await page.content();
  await attachAsset(env, {
    requestId: options.requestId,
    stepId: options.stepId,
    assetType: "html",
    mimeType: "text/html",
    textContent: html,
  });

  const text = await page.evaluate(() => document.body?.innerText ?? "");
  await attachAsset(env, {
    requestId: options.requestId,
    stepId: options.stepId,
    assetType: "text",
    mimeType: "text/plain",
    textContent: text,
  });

  const css = await page.evaluate(() => {
    const chunks: string[] = [];
    const sheets = Array.from(document.styleSheets ?? []);
    for (const sheet of sheets) {
      try {
        const rules = sheet.cssRules ?? [];
        for (const rule of Array.from(rules)) {
          chunks.push(rule.cssText);
        }
      } catch (error) {
        chunks.push(`/* Failed to read stylesheet: ${(error as Error).message} */`);
      }
    }
    return chunks.join("\n");
  });
  await attachAsset(env, {
    requestId: options.requestId,
    stepId: options.stepId,
    assetType: "css",
    mimeType: "text/css",
    textContent: css.slice(0, 200000),
  });
}

export function bindConsoleLogging(page: any, onMessage: (log: { type: string; text: string }) => void) {
  page.on("console", (event: any) => {
    onMessage({ type: event.type(), text: event.text() });
  });
}
