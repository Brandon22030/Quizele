import { inArray, sql } from "drizzle-orm";
import { runBatch, type Db } from "./client";
import { gameSessions, questionStats, sessionPlayers } from "./schema";

export const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Les trois suppressions partent dans un seul batch (une requête D1). Les enfants sont supprimés d'abord par
// sous-requête, sans dépendre de la cascade, puis les parties ; le critère est la fin de partie, ou le lancement
// pour une partie jamais terminée (abandonnée).
export async function purgeOldSessions(db: Db, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const expired = sql`COALESCE(${gameSessions.endedAt}, ${gameSessions.createdAt}) < ${cutoff.getTime()}`;
  const expiredIds = db.select({ id: gameSessions.id }).from(gameSessions).where(expired);
  await runBatch(db, [
    db.delete(questionStats).where(inArray(questionStats.sessionId, expiredIds)),
    db.delete(sessionPlayers).where(inArray(sessionPlayers.sessionId, expiredIds)),
    db.delete(gameSessions).where(expired),
  ]);
}
