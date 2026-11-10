import { and, asc, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { chunkRows, type Db } from "./client";
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

// Colonnes dans l'ordre de la table (exigé par insert().select()). Paramètres liés par ligne, et paramètres fixes par instruction (sessionId dans la ligne et dans la garde).
const PLAYER_ROW_PARAMS = 5;
const STAT_ROW_PARAMS = 8;
const GUARD_PARAMS = 2;

// La garde rend l'appel idempotent : une partie déjà terminée ne reçoit plus aucune ligne, dans la même transaction
// que l'écriture. Une partie inconnue n'est pas filtrée : la clé étrangère fait échouer tout le batch.
const notEnded = (sessionId: string) =>
  sql`WHERE NOT EXISTS (SELECT 1 FROM game_sessions WHERE id = ${sessionId} AND status = 'ended')`;

const valuesList = (rows: SQL[][]) => sql.join(rows.map((row) => sql`(${sql.join(row, sql`, `)})`), sql`, `);

// Un seul db.batch() : atomique, et toutes ses instructions restent sous 100 paramètres liés. Les insertions
// précèdent la mise à jour du statut, sinon la garde les ignorerait. Renvoie false si la partie était déjà terminée.
export async function saveSessionResults(
  db: Db,
  sessionId: string,
  players: PlayerResult[],
  stats: QuestionStatResult[],
  endedAt: Date = new Date(),
): Promise<boolean> {
  const playerRows = players.map((p) => [sql`${p.id ?? crypto.randomUUID()}`, sql`${p.pseudo}`, sql`${p.score}`, sql`${p.totalTimeMs}`, sql`${p.rank}`]);
  const statRows = stats.map((s) => [
    sql`${crypto.randomUUID()}`,
    sql`${s.position}`,
    sql`${s.prompt}`,
    sql`${JSON.stringify(s.correctLabels)}`,
    sql`${s.reference ?? null}`,
    sql`${s.answerCount}`,
    sql`${s.correctCount}`,
    sql`${JSON.stringify(s.distribution)}`,
  ]);
  const statements: BatchItem<"sqlite">[] = [
    ...chunkRows(playerRows, PLAYER_ROW_PARAMS, GUARD_PARAMS).map(
      (rows) =>
        db
          .insert(sessionPlayers)
          .select(sql`SELECT column1, ${sessionId}, column2, column3, column4, column5 FROM (VALUES ${valuesList(rows)}) ${notEnded(sessionId)}`),
    ),
    ...chunkRows(statRows, STAT_ROW_PARAMS, GUARD_PARAMS).map(
      (rows) =>
        db.insert(questionStats).select(sql`SELECT column1, ${sessionId}, column2, column3, column4, column5, column6, column7, column8
          FROM (VALUES ${valuesList(rows)}) ${notEnded(sessionId)}`),
    ),
    db
      .update(gameSessions)
      .set({ status: "ended", endedAt })
      .where(and(eq(gameSessions.id, sessionId), ne(gameSessions.status, "ended"))),
  ];
  const results = await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return (results.at(-1) as D1Result).meta.changes > 0;
}

const LIST_LIMIT = 100;

// Parties jouées par l'animateur, avec le nombre de joueurs : les 100 plus récentes.
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
    .orderBy(desc(gameSessions.createdAt))
    .limit(LIST_LIMIT);
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
