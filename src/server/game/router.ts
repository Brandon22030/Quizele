import { verifyToken } from "./tokens";

export const GAME_CODE_PATTERN = /^[A-Z0-9]{6}$/;

// Vérifie le jeton avant de réveiller le Durable Object : un jeton falsifié ne coûte aucune requête DO.
// Le DO revérifie ensuite lui-même, il ne fait pas confiance au routeur.
export async function routeWebSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Upgrade WebSocket requis", { status: 426 });
  const url = new URL(request.url);
  const code = /^\/ws\/([^/]+)\/?$/.exec(url.pathname)?.[1]?.toUpperCase();
  if (!code || !GAME_CODE_PATTERN.test(code)) return new Response("Partie introuvable", { status: 404 });
  const secret = env.PLAYER_TOKEN_SECRET;
  if (!secret) return new Response("Configuration manquante", { status: 500 });
  const claims = await verifyToken(secret, url.searchParams.get("token") ?? "", code);
  if (!claims) return new Response("Jeton invalide", { status: 401 });
  return env.GAME_SESSION.get(env.GAME_SESSION.idFromName(code)).fetch(request);
}
