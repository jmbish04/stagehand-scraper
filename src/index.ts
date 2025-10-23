import { app } from "./app";
import type { Bindings } from "./bindings";

declare global {
  interface Env extends Bindings {}
}

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
