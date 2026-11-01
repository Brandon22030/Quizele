import { and, eq, ne } from "drizzle-orm";
import type { Db } from "./client";
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

// L'unicité est garantie par l'index partiel : on réessaie avec un autre code en cas de collision avec une partie active.
export async function createGameSession(db: Db, input: NewGameSession): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateGameCode();
    try {
      await db.insert(gameSessions).values({ ...input, code, status: "lobby" });
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
