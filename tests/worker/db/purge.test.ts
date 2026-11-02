/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import { purgeOldSessions } from "../../../src/server/db/purge";
import { saveSessionResults } from "../../../src/server/db/results";
import { gameSessions } from "../../../src/server/db/schema";
import { runScheduled } from "../../../src/server/cron";
import { freshDb, insertUser } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-01T03:00:00Z");
let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
});

async function endedSession(id: string, code: string, ageDays: number) {
  const date = new Date(NOW.getTime() - ageDays * DAY);
  await db.insert(gameSessions).values({
    id,
    code,
    ownerId: "alice",
    quizTitle: "Quiz",
    mode: "together",
    showCorrectAnswer: true,
    shuffle: false,
    status: "running",
    createdAt: date,
  });
  await saveSessionResults(
    db,
    id,
    [{ pseudo: "A", score: 1, totalTimeMs: 1, rank: 1 }],
    [{ position: 0, prompt: "Q", correctLabels: ["x"], answerCount: 1, correctCount: 1, distribution: { x: 1 } }],
    date,
  );
}

const counts = () =>
  env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM game_sessions) AS sessions, (SELECT COUNT(*) FROM session_players) AS players, (SELECT COUNT(*) FROM question_stats) AS stats",
  ).first();

describe("purge à 90 jours", () => {
  it("garde 89 jours et supprime 91 jours avec joueurs et statistiques", async () => {
    await endedSession("recent", "AAAAA2", 89);
    await endedSession("ancien", "BBBBB2", 91);
    await purgeOldSessions(db, NOW);
    expect(await counts()).toEqual({ sessions: 1, players: 1, stats: 1 });
    const left = await env.DB.prepare("SELECT id FROM game_sessions").first();
    expect(left).toEqual({ id: "recent" });
  });

  it("supprime aussi une partie jamais terminée de plus de 90 jours", async () => {
    await db.insert(gameSessions).values({
      id: "abandon",
      code: "CCCCC2",
      ownerId: "alice",
      quizTitle: "Quiz",
      mode: "together",
      showCorrectAnswer: true,
      shuffle: false,
      status: "lobby",
      createdAt: new Date(NOW.getTime() - 91 * DAY),
    });
    await purgeOldSessions(db, NOW);
    expect((await counts())?.sessions).toBe(0);
  });

  it("n'émet qu'un seul batch D1 et le cron l'appelle", async () => {
    await endedSession("ancien", "BBBBB2", 100);
    let batches = 0;
    let calls = 0;
    const originalBatch = env.DB.batch.bind(env.DB);
    const originalPrepare = env.DB.prepare.bind(env.DB);
    env.DB.batch = ((...args: Parameters<D1Database["batch"]>) => {
      batches++;
      return originalBatch(...args);
    }) as D1Database["batch"];
    env.DB.prepare = ((...args: Parameters<D1Database["prepare"]>) => {
      calls++;
      return originalPrepare(...args);
    }) as D1Database["prepare"];
    try {
      await runScheduled(env);
    } finally {
      env.DB.batch = originalBatch;
      env.DB.prepare = originalPrepare;
    }
    expect(batches).toBe(1);
    // Trois suppressions du batch + la clôture des parties abandonnées depuis plus de 48 h et la purge des compteurs de
    // quota périmés (QZ-002-07) : un seul batch, cinq instructions en tout.
    expect(calls).toBeLessThanOrEqual(5);
    expect((await counts())?.sessions).toBe(0);
  });
});
