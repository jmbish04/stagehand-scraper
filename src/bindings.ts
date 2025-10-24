export type Bindings = {
  DB: D1Database;
  AI: Ai;
  BROWSER: Fetcher;
  ASSETS: { fetch: typeof fetch };
  ASSET_BUCKET?: R2Bucket;
};

export type DurableExecutionContext = ExecutionContext & {
  waitUntil(promise: Promise<unknown>): void;
};
