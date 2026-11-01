import { and, lt, ne } from "drizzle-orm";
import { getDb, type Db } from "./db/client";
import { gameSessions } from "./db/schema";
import { purgeOldSessions } from "./db/purge";

// Une partie dure quelques heures au plus : passé ce délai le Durable Object l'a normalement clôturée lui-même.
export const STALE_SESSION_MS = 48 * 60 * 60 * 1000;

// Dernier recours quand le Durable Object n'a pas pu écrire son bilan : sans cette clôture, la partie resterait
// « active » dans D1 et son code serait bloqué pour toujours (index unique partiel sur les parties non terminées).
export async function closeStaleSessions(db: Db, now: Date = new Date()): Promise<void> {
  await db
    .update(gameSessions)
    .set({ status: "ended", endedAt: now })
    .where(and(ne(gameSessions.status, "ended"), lt(gameSessions.createdAt, new Date(now.getTime() - STALE_SESSION_MS))));
}

// Deux appels D1 (clôture, puis un batch de trois suppressions) : très en dessous des 50 requêtes et des 10 ms CPU
// de l'offre gratuite.
export async function runScheduled(env: Env): Promise<void> {
  const db = getDb(env.DB);
  await closeStaleSessions(db);
  await purgeOldSessions(db);
}
