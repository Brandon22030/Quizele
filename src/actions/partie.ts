import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { env } from "cloudflare:workers";
import { LaunchError, issueSessionToken, launchGame } from "../server/game/launch";

// Les erreurs métier gardent leur message en français ; tout le reste passe tel quel et devient une erreur serveur.
async function guarded<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof LaunchError) throw new ActionError({ code: error.code, message: error.message });
    throw error;
  }
}

const sessionInput = z.object({ sessionId: z.string().min(1) });

export const partie = {
  // Renvoie { sessionId, code, hostToken } : le jeton hôte ouvre le WebSocket de pilotage.
  lancer: defineAction({
    input: z.object({ quizId: z.string().min(1) }),
    handler: ({ quizId }, context) => guarded(() => launchGame(env, context.locals.user, quizId)),
  }),
  // Renvoie { code, token } pour la projection (rôle écran, lecture seule).
  jetonEcran: defineAction({
    input: sessionInput,
    handler: ({ sessionId }, context) => guarded(() => issueSessionToken(env, context.locals.user, sessionId, "screen")),
  }),
  // Renvoie { code, token } : reprise du pilotage après un rechargement de page.
  jetonHote: defineAction({
    input: sessionInput,
    handler: ({ sessionId }, context) => guarded(() => issueSessionToken(env, context.locals.user, sessionId, "host")),
  }),
};
