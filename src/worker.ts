import { handle } from "@astrojs/cloudflare/handler";
import { DurableObject } from "cloudflare:workers";
import { runScheduled } from "./server/cron";
import { routeWebSocket } from "./server/game/router";

// Classe vide : l'état, l'horloge et la correction de la partie arrivent en QZ-002-02.
export class GameSession extends DurableObject<Env> {}

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
