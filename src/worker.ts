import { handle } from "@astrojs/cloudflare/handler";
import { runScheduled } from "./server/cron";
import { GameSession } from "./server/game/GameSession";
import { routeWebSocket } from "./server/game/router";

export { GameSession };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);
    // Le routage WebSocket passe avant Astro : les endpoints Astro ne gèrent pas l'upgrade.
    if (pathname.startsWith("/ws/")) {
      return routeWebSocket(request, env);
    }
    return handle(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
