import { tokenFromRequest, verifyToken } from "./tokens";

export const GAME_CODE_PATTERN = /^[A-Z0-9]{6}$/;

// Le code court n'est qu'une porte d'entrée : l'objet d'alias le traduit en sid, et le Durable Object de la
// partie est nommé d'après le sid. Un code réutilisé ne peut donc jamais atteindre l'état d'une ancienne partie.
// Prototype sans D1 : QZ-002-07 remplacera cet alias par game_sessions (code -> sid) et vérifiera la partie
// dans D1 avant d'appeler un Durable Object.
export const aliasStub = (env: Env, code: string) => env.GAME_SESSION.get(env.GAME_SESSION.idFromName(`alias:${code}`));
export const gameStub = (env: Env, sid: string) => env.GAME_SESSION.get(env.GAME_SESSION.idFromName(sid));

// Vérifie le jeton avant de réveiller la partie : un jeton falsifié ne coûte aucune requête sur le DO de jeu.
// Le DO revérifie ensuite lui-même, il ne fait pas confiance au routeur.
export async function routeWebSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Upgrade WebSocket requis", { status: 426 });
  const code = /^\/ws\/([^/]+)\/?$/.exec(new URL(request.url).pathname)?.[1]?.toUpperCase();
  if (!code || !GAME_CODE_PATTERN.test(code)) return new Response("Partie introuvable", { status: 404 });
  const secret = env.PLAYER_TOKEN_SECRET;
  if (!secret) return new Response("Configuration manquante", { status: 500 });
  const claims = await verifyToken(secret, tokenFromRequest(request), { code });
  if (!claims) return new Response("Jeton invalide", { status: 401 });

  const alias = aliasStub(env, code);
  const currentSid = await alias.currentSid();
  if (claims.role !== "host") {
    if (currentSid === null) return new Response("Partie introuvable", { status: 404 });
    if (currentSid !== claims.sid) return new Response("Jeton d'une ancienne partie", { status: 401 });
  }

  const response = await gameStub(env, claims.sid).fetch(request);
  // L'alias n'est publié qu'une fois la partie réellement créée par l'hôte.
  if (claims.role === "host" && response.status === 101 && currentSid !== claims.sid) await alias.registerSid(claims.sid);
  return response;
}
