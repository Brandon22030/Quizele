import { CLOSE_CODES } from "../../shared/protocol";
import { closedSocket } from "./reject";
import { tokenFromRequest, verifyToken } from "./tokens";

export const GAME_CODE_PATTERN = /^[A-Z0-9]{6}$/;

// Le code court n'est qu'une porte d'entrée : l'objet d'alias le traduit en sid, et le Durable Object de la
// partie est nommé d'après le sid. Un code réutilisé ne peut donc jamais atteindre l'état d'une ancienne partie.
// Prototype sans D1 : QZ-002-07 remplacera cet alias par game_sessions (code -> sid) et vérifiera la partie
// dans D1 avant d'appeler un Durable Object.
export const aliasStub = (env: Env, code: string) => env.GAME_SESSION.get(env.GAME_SESSION.idFromName(`alias:${code}`));
export const gameStub = (env: Env, sid: string) => env.GAME_SESSION.get(env.GAME_SESSION.idFromName(sid));

// Une partie terminée libère son code. Une réservation toute récente sans partie compte comme tenue : l'hôte qui
// l'a posée est en train de créer sa partie.
async function holdsCode(env: Env, alias: ReturnType<typeof aliasStub>, sid: string): Promise<boolean> {
  const phase = await gameStub(env, sid).currentPhase();
  if (phase === null) return alias.recentlyClaimed(sid);
  return phase !== "finished";
}

async function refuseHost(env: Env, sid: string): Promise<Response> {
  if ((await gameStub(env, sid).currentPhase()) !== null) return closedSocket(CLOSE_CODES.gameGone, "Partie terminée");
  return closedSocket(CLOSE_CODES.tokenRejected, "Code déjà utilisé par une autre partie");
}

// Vérifie le jeton avant de réveiller la partie : un jeton falsifié ne coûte aucune requête sur le DO de jeu.
// Le DO revérifie ensuite lui-même, il ne fait pas confiance au routeur.
export async function routeWebSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Upgrade WebSocket requis", { status: 426 });
  const code = /^\/ws\/([^/]+)\/?$/.exec(new URL(request.url).pathname)?.[1]?.toUpperCase();
  if (!code || !GAME_CODE_PATTERN.test(code)) return new Response("Partie introuvable", { status: 404 });
  const secret = env.PLAYER_TOKEN_SECRET;
  if (!secret) return new Response("Configuration manquante", { status: 500 });
  const token = tokenFromRequest(request);
  const claims = await verifyToken(secret, token, { code });
  if (!claims) {
    // Jeton bien signé mais expiré : le client doit cesser de se reconnecter. Un jeton falsifié reste un 401.
    if (await verifyToken(secret, token, { code }, 0)) return closedSocket(CLOSE_CODES.tokenRejected, "Jeton expiré");
    return new Response("Jeton invalide", { status: 401 });
  }

  const alias = aliasStub(env, code);
  const currentSid = await alias.currentSid();
  if (claims.role !== "host") {
    if (currentSid === null) return closedSocket(CLOSE_CODES.gameGone, "Partie introuvable");
    if (currentSid !== claims.sid) return closedSocket(CLOSE_CODES.gameGone, "Partie terminée");
  } else if (currentSid !== claims.sid) {
    // Le code n'est repris que si la partie qui le détient n'est plus en cours. La réservation précède la
    // création de la partie : deux hôtes simultanés ne peuvent pas réussir tous les deux.
    // Refus en fermeture applicative, pas en HTTP : le navigateur ne verrait qu'un 1006 et l'hôte se reconnecterait
    // en boucle. Si sa propre partie a existé, elle a perdu le code ; sinon c'est un conflit entre deux hôtes.
    if (currentSid !== null && (await holdsCode(env, alias, currentSid))) return refuseHost(env, claims.sid);
    if (!(await alias.registerSid(claims.sid, currentSid))) return refuseHost(env, claims.sid);
  }

  return gameStub(env, claims.sid).fetch(request);
}
