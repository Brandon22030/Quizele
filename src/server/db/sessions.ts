import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import { NotFoundError } from "./quizzes";
import { gameSessions, type GameMode } from "./schema";

// Sans 0/O/1/I : le code est lu à voix haute et recopié à la main.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 8;

export interface NewGameSession {
  id: string;
  ownerId: string;
  quizId: string;
  quizTitle: string;
  mode: GameMode;
  showCorrectAnswer: boolean;
  shuffle: boolean;
}

export function generateGameCode(random: (max: number) => number = (max) => crypto.getRandomValues(new Uint32Array(1))[0]! % max): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}

// Drizzle enveloppe l'erreur D1 : le message d'origine est dans `cause`.
const isUniqueViolation = (error: unknown): boolean =>
  /UNIQUE constraint failed/i.test(`${error} ${(error as { cause?: unknown })?.cause}`);

// SERVEUR UNIQUEMENT : appelé par l'action de lancement de partie (partie.lancer, QZ-002-07) après loadQuizSnapshot.
// L'insertion ne part que si le quiz appartient à ownerId, dans la même requête : aucune fenêtre entre contrôle et écriture.
// L'unicité du code est garantie par l'index partiel : on réessaie avec un autre code en cas de collision.
export async function createGameSession(db: Db, input: NewGameSession): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateGameCode();
    try {
      const result = await db.run(sql`INSERT INTO game_sessions
        (id, code, owner_id, quiz_id, quiz_title, mode, show_correct_answer, shuffle, status, created_at)
        SELECT ${input.id}, ${code}, owner_id, id, ${input.quizTitle}, ${input.mode}, ${input.showCorrectAnswer ? 1 : 0},
          ${input.shuffle ? 1 : 0}, 'lobby', ${Date.now()}
        FROM quizzes WHERE id = ${input.quizId} AND owner_id = ${input.ownerId}`);
      if (result.meta.changes === 0) throw new NotFoundError("Quiz introuvable");
      return { id: input.id, code };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Aucun code de partie disponible");
}

// Un code terminé n'est plus résolu : il peut avoir été réattribué à une nouvelle partie.
export async function findActiveSessionByCode(db: Db, code: string) {
  return (
    (await db
      .select({ id: gameSessions.id, status: gameSessions.status, ownerId: gameSessions.ownerId })
      .from(gameSessions)
      .where(and(eq(gameSessions.code, code), ne(gameSessions.status, "ended")))
      .get()) ?? null
  );
}

export async function markSessionRunning(db: Db, sessionId: string): Promise<void> {
  await db
    .update(gameSessions)
    .set({ status: "running" })
    .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.status, "lobby")));
}
