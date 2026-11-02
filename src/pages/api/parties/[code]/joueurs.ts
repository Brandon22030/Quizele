import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { joinRequestSchema, type JoinResponse } from "../../../../shared/protocol";
import { getDb } from "../../../../server/db/client";
import { findActiveSessionByCode, findJoinPreviewByCode } from "../../../../server/db/sessions";
import { GAME_CODE_PATTERN, gameStub } from "../../../../server/game/router";
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

  // D1 d'abord : un code inconnu ou terminé n'atteint aucun Durable Object et ne crée aucun stockage.
  const db = getDb(env.DB);
  const session = await findActiveSessionByCode(db, code);
  if (!session) {
    // Même réponse que la page /j/<code>, qui annonce « terminée » : on distingue le code périmé du code inconnu.
    const last = await findJoinPreviewByCode(db, code);
    return last?.status === "ended" ? json({ error: "game_finished" }, 410) : json({ error: "game_not_found" }, 404);
  }
  const sid = session.id;
  const result = await gameStub(env, sid).join(body.data.pseudo);
  if (!result.ok) return json({ error: result.error }, ERROR_STATUS[result.error]);

  const token = await signToken(secret, { code, sid, role: "player", playerId: result.playerId });
  return json({ playerId: result.playerId, token } satisfies JoinResponse, 201);
};
