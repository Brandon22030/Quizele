import { getDb } from "../db/client";
import { quizStatus } from "../../shared/quiz-schema";
import { loadQuizSnapshot } from "../db/quizzes";
import { saveSessionResults } from "../db/results";
import { createGameSession } from "../db/sessions";
import { findOwnedSession } from "./lookup";
import { quizDefinitionSchema, toQuizDefinition } from "./quiz";
import { consumeLaunchQuota } from "./quota";
import { gameStub } from "./router";
import { signToken } from "./tokens";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
}

export type LaunchErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "BAD_REQUEST" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR";

// Erreur métier indépendante d'Astro : l'action la convertit en ActionError, les tests l'inspectent directement.
export class LaunchError extends Error {
  constructor(
    readonly code: LaunchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw new LaunchError("UNAUTHORIZED", "Connecte-toi pour lancer une partie.");
  return user;
}

function requireSecret(env: Env): string {
  if (!env.PLAYER_TOKEN_SECRET) throw new LaunchError("INTERNAL_SERVER_ERROR", "Configuration serveur incomplète.");
  return env.PLAYER_TOKEN_SECRET;
}

export interface LaunchResult {
  sessionId: string;
  code: string;
  hostToken: string;
}

// Budget D1 : lecture du quiz (3 requêtes dans un batch) + quota (1 batch) + création de la partie (1) = 5 requêtes, loin des 50 de
// l'offre gratuite. Le Durable Object est initialisé par RPC avec l'instantané complet, correction comprise : il est
// le seul à la détenir pendant la partie.
// `unlimited` : outillage local uniquement (script de charge), jamais passé par l'action.
export async function launchGame(env: Env, user: SessionUser | null, quizId: string, options: { unlimited?: boolean } = {}): Promise<LaunchResult> {
  const owner = requireUser(user);
  const secret = requireSecret(env);
  const db = getDb(env.DB);
  const snapshot = await loadQuizSnapshot(db, owner.id, quizId);
  if (!snapshot) throw new LaunchError("NOT_FOUND", "Quiz introuvable.");

  const status = quizStatus(snapshot.questions);
  if (snapshot.questions.length === 0) throw new LaunchError("BAD_REQUEST", "Le quiz n'est pas prêt : ajoute au moins une question.");
  if (!status.ready) {
    const list = status.incomplete.map(({ position }) => position + 1).join(", ");
    const plural = status.incompleteCount > 1;
    throw new LaunchError("BAD_REQUEST", `Le quiz n'est pas prêt : ${plural ? "les questions" : "la question"} ${list} ${plural ? "sont" : "est"} à compléter.`);
  }
  // Filet de sécurité : le Durable Object revalide l'instantané à l'initialisation avec ses propres limites.
  const definition = toQuizDefinition(snapshot);
  if (!quizDefinitionSchema.safeParse(definition).success) throw new LaunchError("BAD_REQUEST", "Le quiz n'est pas prêt : une question est invalide.");

  if (!options.unlimited && !(await consumeLaunchQuota(env.DB, owner.id))) {
    throw new LaunchError("TOO_MANY_REQUESTS", "Trop de parties lancées en peu de temps. Réessaie dans une heure.");
  }
  const { id: sessionId, code } = await createGameSession(db, {
    id: crypto.randomUUID(),
    ownerId: owner.id,
    quizId: snapshot.quizId,
    quizTitle: snapshot.title,
    mode: snapshot.mode,
    showCorrectAnswer: snapshot.showCorrectAnswer,
    shuffle: snapshot.shuffle,
  });
  try {
    await gameStub(env, sessionId).init(code, sessionId, definition);
  } catch {
    // Sans Durable Object initialisé la partie est inutilisable : on libère son code plutôt que de le garder bloqué.
    await saveSessionResults(db, sessionId, [], []).catch(() => undefined);
    throw new LaunchError("INTERNAL_SERVER_ERROR", "La partie n'a pas pu démarrer. Réessaie dans un instant.");
  }
  return { sessionId, code, hostToken: await signToken(secret, { code, sid: sessionId, role: "host" }) };
}

// Jeton pour reprendre la main sur une partie en cours (rechargement de la page de pilotage) ou projeter l'écran.
export async function issueSessionToken(
  env: Env,
  user: SessionUser | null,
  sessionId: string,
  role: "host" | "screen",
): Promise<{ code: string; token: string }> {
  const owner = requireUser(user);
  const secret = requireSecret(env);
  const session = await findOwnedSession(getDb(env.DB), owner.id, sessionId);
  if (!session || session.status === "ended") throw new LaunchError("NOT_FOUND", "Partie introuvable ou déjà terminée.");
  return { code: session.code, token: await signToken(secret, { code: session.code, sid: session.id, role }) };
}
