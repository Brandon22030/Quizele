/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import {
  addQuestion,
  createQuiz,
  NotFoundError,
  duplicateQuiz,
  getQuizForEditor,
  listQuizzes,
  loadQuizSnapshot,
  QuizLimitError,
  reorderQuestions,
  updateQuestion,
  updateQuizSettings,
} from "../../../src/server/db/quizzes";
import { listPlayedSessions, saveSessionResults, type PlayerResult, type QuestionStatResult } from "../../../src/server/db/results";
import { gameSessions, MAX_QUESTIONS_PER_QUIZ } from "../../../src/server/db/schema";
import { fourOptions, freshDb, insertUser, sampleQuestion, spiedDb } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
  await insertUser(db, "bob");
});

const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
const fullQuiz = (n = MAX_QUESTIONS_PER_QUIZ) =>
  Array.from({ length: n }, (_, i) => sampleQuestion({ prompt: `Q${i}`, options: fourOptions() }));
const players = (n: number): PlayerResult[] =>
  Array.from({ length: n }, (_, i) => ({ pseudo: `Joueur ${i}`, score: n - i, totalTimeMs: 1000 + i, rank: i + 1 }));
const stats = (n: number): QuestionStatResult[] =>
  Array.from({ length: n }, (_, i) => ({
    position: i,
    prompt: `Question ${i}`,
    correctLabels: ["a"],
    reference: null,
    answerCount: 200,
    correctCount: 100,
    distribution: { a: 100, b: 50, c: 30, d: 20 },
  }));
const runningSession = (id: string, code: string) =>
  db.insert(gameSessions).values({ id, code, ownerId: "alice", quizTitle: "Q", mode: "together", showCorrectAnswer: true, shuffle: false, status: "running" });

describe("offre gratuite D1 : 50 questions x 4 options, 200 joueurs", () => {
  it("createQuiz : un batch de 16 instructions, au plus 100 paramètres liés chacune", async () => {
    const spied = spiedDb();
    await createQuiz(spied.db, "alice", { title: "Plein", questions: fullQuiz() });
    console.log("createQuiz 50x4 :", spied.trace.batches, "max paramètres =", Math.max(...spied.trace.bound));
    expect(spied.trace.batches).toEqual([16]);
    expect(spied.trace.prepared).toBe(16);
    expect(Math.max(...spied.trace.bound)).toBeLessThanOrEqual(100);
    expect(await count("questions")).toBe(50);
    expect(await count("options")).toBe(200);
  });

  it("duplicateQuiz : une lecture plus un batch, copie fidèle", async () => {
    const source = await createQuiz(db, "alice", { title: "Source", questions: fullQuiz() });
    const spied = spiedDb();
    const copy = await duplicateQuiz(spied.db, "alice", source, "Copie");
    console.log("duplicateQuiz 50x4 : requêtes =", spied.trace.prepared, "max paramètres =", Math.max(...spied.trace.bound));
    expect(spied.trace.prepared).toBeLessThanOrEqual(17);
    expect(Math.max(...spied.trace.bound)).toBeLessThanOrEqual(100);
    const copied = await getQuizForEditor(db, "alice", copy);
    expect(copied?.questions.map((q) => q.prompt)).toEqual(fullQuiz().map((q) => q.prompt));
    expect(copied?.questions.every((q) => q.options.length === 4 && q.options[0]!.isCorrect)).toBe(true);
  });

  it("reorderQuestions : 50 questions en 2 UPDATE ... CASE, ordre appliqué", async () => {
    const quizId = await createQuiz(db, "alice", { title: "R", questions: fullQuiz() });
    const ids = (await getQuizForEditor(db, "alice", quizId))!.questions.map((q) => q.id);
    const spied = spiedDb();
    await reorderQuestions(spied.db, "alice", quizId, [...ids].reverse());
    console.log("reorderQuestions 50 :", spied.trace.batches, "max paramètres =", Math.max(...spied.trace.bound));
    expect(spied.trace.batches).toEqual([2]);
    expect(spied.trace.prepared).toBe(4);
    expect(Math.max(...spied.trace.bound)).toBeLessThanOrEqual(100);
    const reordered = (await getQuizForEditor(db, "alice", quizId))!.questions;
    expect(reordered.map((q) => q.prompt)).toEqual(fullQuiz().map((q) => q.prompt).reverse());
    expect(reordered.map((q) => q.position)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("loadQuizSnapshot : 3 lectures en un batch, paramètres constants", async () => {
    const quizId = await createQuiz(db, "alice", { title: "S", questions: fullQuiz() });
    const spied = spiedDb();
    const snap = await loadQuizSnapshot(spied.db, "alice", quizId);
    console.log("loadQuizSnapshot 50x4 :", spied.trace.batches, "paramètres =", spied.trace.bound);
    expect(spied.trace.batches).toEqual([3]);
    expect(spied.trace.prepared).toBe(3);
    expect(Math.max(...spied.trace.bound)).toBeLessThanOrEqual(4);
    expect(snap?.questions).toHaveLength(50);
    expect(snap?.questions.every((q) => q.options.length === 4)).toBe(true);
  });

  it("saveSessionResults : 200 joueurs x 50 questions en un batch de 17 instructions", async () => {
    await runningSession("s1", "ABC234");
    const spied = spiedDb();
    await saveSessionResults(spied.db, "s1", players(200), stats(50));
    console.log("saveSessionResults 200x50 :", spied.trace.batches, "max paramètres =", Math.max(...spied.trace.bound));
    expect(spied.trace.batches).toEqual([17]);
    expect(spied.trace.prepared).toBe(17);
    expect(Math.max(...spied.trace.bound)).toBeLessThanOrEqual(100);
    expect(await count("session_players")).toBe(200);
    expect(await count("question_stats")).toBe(50);
  });
});

describe("plafond de 50 questions et 4 options", () => {
  it("createQuiz refuse 51 questions sans rien écrire", async () => {
    await expect(createQuiz(db, "alice", { title: "Trop", questions: fullQuiz(51) })).rejects.toBeInstanceOf(QuizLimitError);
    expect(await count("quizzes")).toBe(0);
  });

  it("addQuestion refuse la 51e question", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Plein", questions: fullQuiz() });
    await expect(addQuestion(db, "alice", quizId, sampleQuestion())).rejects.toBeInstanceOf(QuizLimitError);
    expect(await count("questions")).toBe(50);
  });

  it("duplicateQuiz refuse une source au-delà du plafond", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Plein", questions: fullQuiz() });
    await env.DB.prepare("INSERT INTO questions (id, quiz_id, position, type, duration_sec) VALUES ('extra', ?, 50, 'single', 20)").bind(quizId).run();
    await expect(duplicateQuiz(db, "alice", quizId, "Copie")).rejects.toBeInstanceOf(QuizLimitError);
    expect(await count("quizzes")).toBe(1);
  });

  it("plus de 4 options refusées à la création, à l'ajout et à la modification", async () => {
    const five = sampleQuestion({ options: [...fourOptions(), { label: "e", isCorrect: false }] });
    await expect(createQuiz(db, "alice", { title: "X", questions: [five] })).rejects.toBeInstanceOf(QuizLimitError);
    const quizId = await createQuiz(db, "alice", { title: "Y" });
    await expect(addQuestion(db, "alice", quizId, five)).rejects.toBeInstanceOf(QuizLimitError);
    const qid = await addQuestion(db, "alice", quizId, sampleQuestion());
    await expect(updateQuestion(db, "alice", qid, five)).rejects.toBeInstanceOf(QuizLimitError);
    expect(await count("options")).toBe(2);
  });
});

describe("affectation de masse", () => {
  const pirate = { title: "Pirate", ownerId: "bob", id: "id-force", createdAt: new Date(0), updatedAt: new Date(0) };

  it("createQuiz ignore id et ownerId fournis dans l'entrée", async () => {
    const quizId = await createQuiz(db, "alice", pirate as never);
    expect(quizId).not.toBe("id-force");
    expect(await listQuizzes(db, "bob")).toEqual([]);
    expect(await getQuizForEditor(db, "alice", quizId)).toMatchObject({ id: quizId, ownerId: "alice", title: "Pirate" });
    expect((await getQuizForEditor(db, "alice", quizId))?.createdAt.getTime()).toBeGreaterThan(0);
  });

  it("updateQuizSettings ne change ni le propriétaire ni l'identifiant", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Avant" });
    await updateQuizSettings(db, "alice", quizId, pirate as never);
    expect(await getQuizForEditor(db, "alice", quizId)).toMatchObject({ id: quizId, ownerId: "alice", title: "Pirate" });
    expect(await count("quizzes WHERE id = 'id-force' OR owner_id = 'bob'")).toBe(0);
  });
});

describe("loadQuizSnapshot : filtré par propriétaire (IDOR)", () => {
  it("renvoie null pour le quiz d'un autre compte", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Privé", questions: [sampleQuestion()] });
    expect(await loadQuizSnapshot(db, "bob", quizId)).toBeNull();
    expect((await loadQuizSnapshot(db, "alice", quizId))?.questions).toHaveLength(1);
  });
});

describe("saveSessionResults : idempotence", () => {
  it("le second appel n'écrit rien et conserve la première date de fin", async () => {
    await runningSession("s1", "ABC234");
    const first = new Date("2026-10-01T10:00:00Z");
    expect(await saveSessionResults(db, "s1", players(5), stats(3), first)).toBe(true);
    expect(await saveSessionResults(db, "s1", players(8), stats(4), new Date("2026-10-02T10:00:00Z"))).toBe(false);
    expect(await count("session_players")).toBe(5);
    expect(await count("question_stats")).toBe(3);
    expect(await env.DB.prepare("SELECT ended_at FROM game_sessions WHERE id = 's1'").first()).toEqual({ ended_at: first.getTime() });
  });

  it("index uniques : un rang ou une position en double sont refusés par la base", async () => {
    await runningSession("s1", "ABC234");
    await expect(saveSessionResults(db, "s1", [...players(2), { ...players(1)[0]!, pseudo: "Clone" }], [])).rejects.toThrow();
    await expect(saveSessionResults(db, "s1", [], [...stats(2), stats(1)[0]!])).rejects.toThrow();
    expect(await count("session_players")).toBe(0);
    expect(await count("question_stats")).toBe(0);
  });
});

describe("contraintes de longueur", () => {
  const rawPlayer = (pseudo: string) =>
    env.DB.prepare("INSERT INTO session_players (id, session_id, pseudo, rank) VALUES (?, 's1', ?, ?)")
      .bind(crypto.randomUUID(), pseudo, Math.floor(Math.random() * 1e9))
      .run();
  beforeEach(async () => {
    await runningSession("s1", "ABC234");
  });

  it("pseudo : 20 emojis composés acceptés, vide ou plus de 200 caractères refusés", async () => {
    await expect(rawPlayer("👨‍👩‍👧‍👦".repeat(20))).resolves.toBeDefined();
    await expect(rawPlayer("")).rejects.toThrow(/CHECK constraint failed/);
    await expect(rawPlayer("x".repeat(201))).rejects.toThrow(/CHECK constraint failed/);
  });

  it("énoncé limité à 300 caractères, libellé d'option à 200", async () => {
    const quizId = await createQuiz(db, "alice", { title: "L" });
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ prompt: "é".repeat(300) }))).resolves.toBeTypeOf("string");
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ prompt: "é".repeat(301) }))).rejects.toThrow();
    await expect(
      addQuestion(db, "alice", quizId, sampleQuestion({ options: [{ label: "o".repeat(201), isCorrect: true }] })),
    ).rejects.toThrow();
    expect(await count("questions")).toBe(1);
  });
});

describe("addQuestion : garde atomique", () => {
  it("4 options : une lecture puis un batch de 3 instructions, sous 100 paramètres", async () => {
    const quizId = await createQuiz(db, "alice", { title: "A" });
    const spied = spiedDb();
    await addQuestion(spied.db, "alice", quizId, sampleQuestion({ options: fourOptions("c") }));
    expect(spied.trace.batches).toEqual([3]);
    expect(spied.trace.prepared).toBe(4);
    expect(Math.max(...spied.trace.bound)).toBeLessThanOrEqual(100);
    expect((await getQuizForEditor(db, "alice", quizId))!.questions[0]!.options.map((o) => [o.label, o.isCorrect])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
      ["d", false],
    ]);
  });

  it("quiz supprimé entre le contrôle et l'écriture : NotFoundError, aucune ligne orpheline", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Éphémère" });
    const original = env.DB.batch.bind(env.DB);
    env.DB.batch = (async (stmts: D1PreparedStatement[]) => {
      await env.DB.prepare("DELETE FROM quizzes WHERE id = ?").bind(quizId).run();
      env.DB.batch = original;
      return original(stmts);
    }) as D1Database["batch"];
    try {
      await expect(addQuestion(db, "alice", quizId, sampleQuestion())).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      env.DB.batch = original;
    }
    expect(await count("questions")).toBe(0);
    expect(await count("options")).toBe(0);
  });
});

describe("contraintes de longueur : quiz et textes longs", () => {
  const rawQuiz = (title: string, description: string | null) =>
    env.DB.prepare("INSERT INTO quizzes (id, owner_id, title, description, created_at, updated_at) VALUES (?, 'alice', ?, ?, 0, 0)")
      .bind(crypto.randomUUID(), title, description)
      .run();

  it("titre 120 et description 500 acceptés, au-delà refusés, description NULL acceptée", async () => {
    await expect(rawQuiz("t".repeat(120), "d".repeat(500))).resolves.toBeDefined();
    await expect(rawQuiz("t", null)).resolves.toBeDefined();
    await expect(rawQuiz("t".repeat(121), null)).rejects.toThrow(/CHECK constraint failed/);
    await expect(rawQuiz("t", "d".repeat(501))).rejects.toThrow(/CHECK constraint failed/);
  });

  it("référence et explication limitées à 500 caractères", async () => {
    const quizId = await createQuiz(db, "alice", { title: "R" });
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ reference: "r".repeat(500), explanation: "e".repeat(500) }))).resolves.toBeTypeOf("string");
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ reference: "r".repeat(501) }))).rejects.toThrow();
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ explanation: "e".repeat(501) }))).rejects.toThrow();
    await expect(updateQuizSettings(db, "alice", quizId, { title: "t".repeat(121) })).rejects.toThrow();
    expect(await count("questions")).toBe(1);
  });
});

describe("listes bornées à 100", () => {
  it("listQuizzes et listPlayedSessions renvoient au plus 100 lignes, les plus récentes", async () => {
    await env.DB.batch(
      Array.from({ length: 101 }, (_, i) =>
        env.DB.prepare("INSERT INTO quizzes (id, owner_id, title, created_at, updated_at) VALUES (?, 'alice', ?, 0, ?)").bind(`q${i}`, `Q${i}`, i),
      ),
    );
    await env.DB.batch(
      Array.from({ length: 101 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO game_sessions (id, code, owner_id, quiz_title, mode, show_correct_answer, shuffle, status, created_at, ended_at) VALUES (?, 'AAAAAA', 'alice', 'Q', 'together', 1, 0, 'ended', ?, ?)",
        ).bind(`s${i}`, i, i),
      ),
    );
    const quizzesList = await listQuizzes(db, "alice");
    expect(quizzesList).toHaveLength(100);
    expect(quizzesList[0]?.id).toBe("q100");
    const sessionsList = await listPlayedSessions(db, "alice");
    expect(sessionsList).toHaveLength(100);
    expect(sessionsList[0]?.id).toBe("s100");
  });
});
