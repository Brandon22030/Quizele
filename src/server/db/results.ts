import { asc, desc, eq, and, sql } from "drizzle-orm";
import { chunkRows, runBatch, type Db } from "./client";
import { gameSessions, questionStats, sessionPlayers } from "./schema";

export interface PlayerResult {
  id?: string;
  pseudo: string;
  score: number;
  totalTimeMs: number;
  rank: number;
}

export interface QuestionStatResult {
  position: number;
  prompt: string;
  correctLabels: string[];
  reference?: string | null;
  answerCount: number;
  correctCount: number;
  distribution: Record<string, number>;
}

const PLAYER_COLUMNS = 6;
const STAT_COLUMNS = 9;

// Un seul db.batch() : atomique, et compté comme une requête sur l'offre gratuite de D1.
export async function saveSessionResults(
  db: Db,
  sessionId: string,
  players: PlayerResult[],
  stats: QuestionStatResult[],
  endedAt: Date = new Date(),
): Promise<void> {
  const playerRows = players.map((p) => ({
    id: p.id ?? crypto.randomUUID(),
    sessionId,
    pseudo: p.pseudo,
    score: p.score,
    totalTimeMs: p.totalTimeMs,
    rank: p.rank,
  }));
  const statRows = stats.map((s) => ({
    id: crypto.randomUUID(),
    sessionId,
    position: s.position,
    prompt: s.prompt,
    correctLabels: s.correctLabels,
    reference: s.reference ?? null,
    answerCount: s.answerCount,
    correctCount: s.correctCount,
    distribution: s.distribution,
  }));
  await runBatch(db, [
    db
      .update(gameSessions)
      .set({ status: "ended", endedAt })
      .where(eq(gameSessions.id, sessionId)),
    ...chunkRows(playerRows, PLAYER_COLUMNS).map((rows) => db.insert(sessionPlayers).values(rows)),
    ...chunkRows(statRows, STAT_COLUMNS).map((rows) => db.insert(questionStats).values(rows)),
  ]);
}

// Parties jouées par l'animateur, avec le nombre de joueurs.
export async function listPlayedSessions(db: Db, ownerId: string) {
  return db
    .select({
      id: gameSessions.id,
      quizId: gameSessions.quizId,
      quizTitle: gameSessions.quizTitle,
      createdAt: gameSessions.createdAt,
      endedAt: gameSessions.endedAt,
      playerCount: sql<number>`(SELECT COUNT(*) FROM session_players WHERE session_players.session_id = game_sessions.id)`,
    })
    .from(gameSessions)
    .where(and(eq(gameSessions.ownerId, ownerId), eq(gameSessions.status, "ended")))
    .orderBy(desc(gameSessions.createdAt));
}

export async function getSessionReport(db: Db, ownerId: string, sessionId: string) {
  const session = await db
    .select()
    .from(gameSessions)
    .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.ownerId, ownerId)))
    .get();
  if (!session) return null;
  const [players, stats] = await db.batch([
    db.select().from(sessionPlayers).where(eq(sessionPlayers.sessionId, sessionId)).orderBy(asc(sessionPlayers.rank)),
    db.select().from(questionStats).where(eq(questionStats.sessionId, sessionId)).orderBy(asc(questionStats.position)),
  ]);
  return { session, players, stats };
}
