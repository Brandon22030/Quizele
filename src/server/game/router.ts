import { CLOSE_CODES } from "../../shared/protocol";
import { getDb } from "../db/client";
import { findActiveSessionByCode } from "../db/sessions";
import { findSessionById } from "./lookup";
import { closedSocket } from "./reject";
import { tokenFromRequest, verifyToken } from "./tokens";

export const GAME_CODE_PATTERN = /^[A-Z0-9]{6}$/;

// Le code court n'est qu'une porte d'entrée : D1 le traduit en identifiant de partie (sid), et le Durable Object est
// nommé d'après le sid. Un code réutilisé ne peut donc jamais atteindre l'état d'une ancienne partie, et un code
// arbitraire ne crée aucun stockage : D1 est interrogé avant tout appel à un Durable Object.
export const gameStub = (env: Env, sid: string) => env.GAME_SESSION.get(env.GAME_SESSION.idFromName(sid));

// Vérifie le jeton avant de toucher à D1 ou au Durable Object : un jeton falsifié ne coûte rien.
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

  // Refus en fermeture applicative, pas en HTTP : le navigateur ne verrait qu'un 1006 et se reconnecterait en boucle.
  // Une partie terminée ne résout plus son code, donc ne reçoit plus de nouvelle connexion.
  const db = getDb(env.DB);
  const active = await findActiveSessionByCode(db, code);
  if (!active) return closedSocket(CLOSE_CODES.gameGone, "Partie introuvable");
  if (active.id !== claims.sid) {
    if (claims.role !== "host") return closedSocket(CLOSE_CODES.gameGone, "Partie terminée");
    // L'hôte d'une partie qui a existé puis perdu son code : partie terminée. Sinon son jeton ne correspond à rien.
    return (await findSessionById(db, claims.sid))
      ? closedSocket(CLOSE_CODES.gameGone, "Partie terminée")
      : closedSocket(CLOSE_CODES.tokenRejected, "Jeton d'une autre partie");
  }
  return gameStub(env, claims.sid).fetch(request);
}
