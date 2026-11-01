/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import { getSessionReport, listPlayedSessions, saveSessionResults, type PlayerResult, type QuestionStatResult } from "../../../src/server/db/results";
import { gameSessions } from "../../../src/server/db/schema";
import { freshDb, insertUser } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
  await insertUser(db, "bob");
  await db.insert(gameSessions).values({
    id: "s1",
    code: "ABC234",
    ownerId: "alice",
    quizTitle: "Quiz",
    mode: "together",
    showCorrectAnswer: true,
    shuffle: false,
    status: "running",
  });
});

const players = (n: number): PlayerResult[] =>
  Array.from({ length: n }, (_, i) => ({ pseudo: `Joueur ${i}`, score: n - i, totalTimeMs: 1000 + i, rank: i + 1 }));
const stats = (n: number): QuestionStatResult[] =>
  Array.from({ length: n }, (_, i) => ({
    position: i,
    prompt: `Question ${i}`,
    correctLabels: ["Six"],
    reference: i % 2 ? "Genèse 1" : null,
    answerCount: 200,
    correctCount: 120,
    distribution: { a: 10, b: 120, c: 40, d: 30 },
  }));

describe("saveSessionResults", () => {
  it("écrit 200 joueurs x 25 questions en un seul batch sans dépasser la limite de paramètres liés", async () => {
    let batches = 0;
    const original = env.DB.batch.bind(env.DB);
    env.DB.batch = ((...args: Parameters<D1Database["batch"]>) => {
      batches++;
      return original(...args);
    }) as D1Database["batch"];
    try {
      await saveSessionResults(db, "s1", players(200), stats(25));
    } finally {
      env.DB.batch = original;
    }
    expect(batches).toBe(1);

    const report = await getSessionReport(db, "alice", "s1");
    expect(report?.session.status).toBe("ended");
    expect(report?.session.endedAt).toBeInstanceOf(Date);
    expect(report?.players).toHaveLength(200);
    expect(report?.players[0]).toMatchObject({ pseudo: "Joueur 0", rank: 1, score: 200 });
    expect(report?.players[199]?.rank).toBe(200);
    expect(report?.stats).toHaveLength(25);
    expect(report?.stats[1]).toMatchObject({ reference: "Genèse 1", correctLabels: ["Six"], distribution: { a: 10, b: 120, c: 40, d: 30 } });
  });

  it("est atomique : une ligne invalide annule toute l'écriture", async () => {
    const broken = [...players(3), { pseudo: "Cassé", score: 1, totalTimeMs: 1, rank: null as unknown as number }];
    await expect(saveSessionResults(db, "s1", broken, stats(2))).rejects.toThrow();
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM session_players) AS p, (SELECT status FROM game_sessions WHERE id = 's1') AS s",
    ).first();
    expect(counts).toEqual({ p: 0, s: "running" });
  });
});

describe("lecture des bilans", () => {
  it("ne renvoie le bilan et la liste qu'au propriétaire", async () => {
    await saveSessionResults(db, "s1", players(3), stats(2));
    expect(await getSessionReport(db, "bob", "s1")).toBeNull();
    expect(await listPlayedSessions(db, "bob")).toEqual([]);
    expect(await listPlayedSessions(db, "alice")).toMatchObject([{ id: "s1", quizTitle: "Quiz", playerCount: 3 }]);
  });
});
