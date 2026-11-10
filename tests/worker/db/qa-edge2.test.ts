/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import { purgeOldSessions } from "../../../src/server/db/purge";
import { addQuestion, createQuiz, getQuizForEditor, QuizLimitError } from "../../../src/server/db/quizzes";
import { saveSessionResults } from "../../../src/server/db/results";
import { gameSessions } from "../../../src/server/db/schema";
import { createGameSession } from "../../../src/server/db/sessions";
import seedSql from "../../../scripts/seed-local.sql?raw";
import { fourOptions, freshDb, insertUser, sampleQuestion } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-01T03:00:00Z");
let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
  await insertUser(db, "bob");
});
const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
const questionsOf = (n: number) => Array.from({ length: n }, (_, i) => sampleQuestion({ prompt: `Q${i}`, options: fourOptions() }));

describe("plafond de 50 questions sous concurrence", () => {
  it("5 addQuestion simultanés à 49 questions : une seule réussit, jamais plus de 50", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Seuil", questions: questionsOf(49) });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => addQuestion(db, "alice", quizId, sampleQuestion())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count("questions")).toBe(50);
    const positions = (await getQuizForEditor(db, "alice", quizId))!.questions.map((q) => q.position);
    expect(new Set(positions).size).toBe(50);
    expect(await count("options")).toBe(49 * 4 + 2);
    for (const r of results.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(QuizLimitError);
  });

  it("addQuestion simultanés sous le plafond : toutes réussissent avec des positions distinctes", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Libre" });
    await Promise.all(Array.from({ length: 6 }, () => addQuestion(db, "alice", quizId, sampleQuestion())));
    const positions = (await getQuizForEditor(db, "alice", quizId))!.questions.map((q) => q.position);
    expect([...positions].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("longueurs : bornes en points de code", () => {
  beforeEach(async () => {
    await db.insert(gameSessions).values({ id: "s1", code: "ABC234", ownerId: "alice", quizTitle: "Q", mode: "together", showCorrectAnswer: true, shuffle: false, status: "running" });
  });
  const pseudo = (p: string, rank: number) =>
    env.DB.prepare("INSERT INTO session_players (id, session_id, pseudo, rank) VALUES (?, 's1', ?, ?)").bind(crypto.randomUUID(), p, rank).run();

  it("pseudo : 1 et 200 points de code acceptés (emoji hors BMP compris), 201 refusé", async () => {
    await expect(pseudo("a", 1)).resolves.toBeDefined();
    await expect(pseudo("😀".repeat(200), 2)).resolves.toBeDefined();
    await expect(pseudo("😀".repeat(201), 3)).rejects.toThrow(/CHECK constraint failed/);
  });

  it("énoncé 300 / libellé 200 : bornes exactes, en émojis aussi", async () => {
    const quizId = await createQuiz(db, "alice", { title: "L" });
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ prompt: "😀".repeat(300), options: [{ label: "😀".repeat(200), isCorrect: true }] }))).resolves.toBeTypeOf("string");
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ prompt: "😀".repeat(301) }))).rejects.toThrow();
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ options: [{ label: "😀".repeat(201), isCorrect: true }] }))).rejects.toThrow();
  });
});

describe("IDOR createGameSession", () => {
  it("quiz d'un autre compte : refusé même si l'id de partie est neuf", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Privé" });
    await expect(
      createGameSession(db, { id: "vol", ownerId: "bob", quizId, quizTitle: "Privé", mode: "together", showCorrectAnswer: true, shuffle: false }),
    ).rejects.toThrow();
    expect(await count("game_sessions")).toBe(0);
  });
});

describe("purge après réécriture", () => {
  const mk = async (id: string, code: string, created: number, ended: number | null) => {
    await db.insert(gameSessions).values({ id, code, ownerId: "alice", quizTitle: "Q", mode: "together", showCorrectAnswer: true, shuffle: false, status: ended === null ? "lobby" : "running", createdAt: new Date(NOW.getTime() - created * DAY) });
    if (ended !== null) await saveSessionResults(db, id, [{ pseudo: "A", score: 1, totalTimeMs: 1, rank: 1 }], [{ position: 0, prompt: "Q", correctLabels: ["x"], answerCount: 1, correctCount: 1, distribution: { x: 1 } }], new Date(NOW.getTime() - ended * DAY));
  };
  it("bornes inchangées : 89 j et 90 j pile gardés, 90 j + 1 ms et 91 j supprimés, abandon et long jeu", async () => {
    await mk("j89", "AAAAA2", 89, 89);
    await mk("j90", "AAAAA3", 90, 90);
    await mk("j90m", "AAAAA4", 90, 90 + 1 / DAY);
    await mk("j91", "AAAAA5", 91, 91);
    await mk("lobby89", "AAAAA6", 89, null);
    await mk("lobby91", "AAAAA7", 91, null);
    await mk("long", "AAAAA8", 300, 5);
    await purgeOldSessions(db, NOW);
    const ids = (await env.DB.prepare("SELECT id FROM game_sessions ORDER BY id").all<{ id: string }>()).results.map((r) => r.id);
    expect(ids).toEqual(["j89", "j90", "lobby89", "long"]);
    expect(await count("session_players")).toBe(3);
    expect(await count("question_stats")).toBe(3);
  });
  it("un index couvre ended_at", async () => {
    const { results } = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'game_sessions'").all<{ sql: string | null }>();
    expect(results.some((r) => /ended_at/.test(r.sql ?? ""))).toBe(true);
  });
});

describe("seed et migration locale", () => {
  const statements = seedSql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const run = () => env.DB.batch(statements.map((s) => env.DB.prepare(s)));

  it("base vide migrée puis seed deux fois : pas de doublon, parties conservées, quiz_id jamais remis à null", async () => {
    await run();
    await db.insert(gameSessions).values({ id: "sd", code: "SEED22", ownerId: "seed-user", quizId: "seed-quiz", quizTitle: "Quiz de démonstration", mode: "together", showCorrectAnswer: true, shuffle: false, status: "running" });
    await saveSessionResults(db, "sd", [{ pseudo: "A", score: 1, totalTimeMs: 1, rank: 1 }], []);
    await run();
    await run();
    expect(await count("quizzes WHERE id = 'seed-quiz'")).toBe(1);
    expect(await count("questions")).toBe(3);
    expect(await count("options")).toBe(10);
    expect(await count("session_players")).toBe(1);
    expect(await env.DB.prepare("SELECT quiz_id, status FROM game_sessions WHERE id = 'sd'").first()).toEqual({ quiz_id: "seed-quiz", status: "ended" });
  });
});
