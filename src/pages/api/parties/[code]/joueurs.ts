import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { joinRequestSchema, type JoinResponse } from "../../../../shared/protocol";
import { GAME_CODE_PATTERN } from "../../../../server/game/router";
import { signToken } from "../../../../server/game/tokens";

const ERROR_STATUS = {
  invalid_pseudo: 400,
  pseudo_taken: 409,
  game_full: 409,
  game_not_found: 404,
  game_finished: 410,
} as const;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const POST: APIRoute = async ({ params, request }) => {
  const code = params.code?.toUpperCase() ?? "";
  if (!GAME_CODE_PATTERN.test(code)) return json({ error: "game_not_found" }, 404);
  const body = joinRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_pseudo" }, 400);
  const secret = env.PLAYER_TOKEN_SECRET;
  if (!secret) return json({ error: "server_misconfigured" }, 500);

  const result = await env.GAME_SESSION.get(env.GAME_SESSION.idFromName(code)).join(body.data.pseudo);
  if (!result.ok) return json({ error: result.error }, ERROR_STATUS[result.error]);

  const token = await signToken(secret, { code, role: "player", playerId: result.playerId });
  return json({ playerId: result.playerId, token } satisfies JoinResponse, 201);
};
