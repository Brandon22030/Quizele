import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { gameSessions } from "../db/schema";

const columns = { id: gameSessions.id, code: gameSessions.code, status: gameSessions.status, ownerId: gameSessions.ownerId };

export async function findSessionById(db: Db, sessionId: string) {
  return (await db.select(columns).from(gameSessions).where(eq(gameSessions.id, sessionId)).get()) ?? null;
}

// Filtré par propriétaire : null pour la partie d'un autre compte, sans distinguer « absente » de « à un autre ».
export async function findOwnedSession(db: Db, ownerId: string, sessionId: string) {
  return (
    (await db
      .select(columns)
      .from(gameSessions)
      .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.ownerId, ownerId)))
      .get()) ?? null
  );
}
