import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { api, buildOpenApiDocument } from "./routes/api";

export const app = new Hono<{ Bindings: Bindings }>();

app.route("/api", api);

app.get("/openapi.json", c => c.json(buildOpenApiDocument()));

app.get("/*", async c => {
  const url = new URL(c.req.url);
  const assetPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const assetUrl = new URL(assetPath, "https://assets");
  const assetRequest = new Request(assetUrl, c.req.raw);
  return c.env.ASSETS.fetch(assetRequest);
});
