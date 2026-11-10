/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type Db } from "../../../src/server/db/client";
import { purgeOldSessions } from "../../../src/server/db/purge";
import { getSessionReport, listPlayedSessions, saveSessionResults, type PlayerResult, type QuestionStatResult } from "../../../src/server/db/results";
import { gameSessions } from "../../../src/server/db/schema";
import { createGameSession, findActiveSessionByCode, generateGameCode } from "../../../src/server/db/sessions";
import {
  addQuestion,
  createQuiz,
  deleteQuestion,
  duplicateQuiz,
  getQuizForEditor,
  listQuizzes,
  loadQuizSnapshot,
  NotFoundError,
  reorderQuestions,
  updateQuestion,
  updateQuizSettings,
} from "../../../src/server/db/quizzes";
import seedSql from "../../../scripts/seed-local.sql?raw";
import { freshDb, insertUser, sampleQuestion } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-01T03:00:00Z");
let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
  await insertUser(db, "bob");
});
afterEach(() => vi.restoreAllMocks());

const sessionRow = (id: string, code: string, over: Record<string, unknown> = {}) => ({
  id,
  code,
  ownerId: "alice",
  quizTitle: "Quiz",
  mode: "together" as const,
  showCorrectAnswer: true,
  shuffle: false,
  status: "running" as const,
  ...over,
});
const players = (n: number): PlayerResult[] =>
  Array.from({ length: n }, (_, i) => ({ pseudo: `J${i}`, score: n - i, totalTimeMs: 1000 + i, rank: i + 1 }));
const stats = (n: number): QuestionStatResult[] =>
  Array.from({ length: n }, (_, i) => ({
    position: i,
    prompt: `Q${i}`,
    correctLabels: ["Six", "Sept"],
    reference: null,
    answerCount: 200,
    correctCount: 100,
    distribution: { a: 1, b: 2, c: 3, d: 4 },
  }));
const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

// Enveloppe D1 qui trace chaque instruction préparée, ses paramètres liés et les appels à batch().
function spiedDb() {
  const trace = { batches: [] as number[], bound: [] as number[], prepared: 0 };
  const proxy = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          trace.prepared++;
          const stmt = target.prepare(sql);
          const bind = stmt.bind.bind(stmt);
          stmt.bind = ((...args: unknown[]) => {
            trace.bound.push(args.length);
            return bind(...args);
          }) as typeof stmt.bind;
          return stmt;
        };
      }
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => {
          trace.batches.push(stmts.length);
          return target.batch(stmts);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
  return { db: getDb(proxy), trace };
}

describe("isolation owner_id : toutes les fonctions", () => {
  it("lecture, bilan, liste et parties d'un autre compte ne fuitent jamais", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Privé", questions: [sampleQuestion()] });
    await db.insert(gameSessions).values(sessionRow("s1", "ABC234", { quizId }));
    await saveSessionResults(db, "s1", players(2), stats(1));

    expect(await getQuizForEditor(db, "bob", quizId)).toBeNull();
    expect(await listQuizzes(db, "bob")).toEqual([]);
    expect(await getSessionReport(db, "bob", "s1")).toBeNull();
    expect(await listPlayedSessions(db, "bob")).toEqual([]);
    expect(await getSessionReport(db, "alice", "s1")).not.toBeNull();
  });

  it("quiz d'un autre compte : aucune écriture ne passe, état inchangé", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Privé", questions: [sampleQuestion({ prompt: "Original" })] });
    const [q] = (await getQuizForEditor(db, "alice", quizId))!.questions;
    const before = JSON.stringify(await getQuizForEditor(db, "alice", quizId));

    await expect(updateQuizSettings(db, "bob", quizId, { title: "X" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateQuestion(db, "bob", q!.id, sampleQuestion({ prompt: "Piraté" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteQuestion(db, "bob", q!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(duplicateQuiz(db, "bob", quizId, "Vol")).rejects.toBeInstanceOf(NotFoundError);
    await expect(addQuestion(db, "bob", quizId, sampleQuestion())).rejects.toBeInstanceOf(NotFoundError);
    await expect(reorderQuestions(db, "bob", quizId, [q!.id])).rejects.toBeInstanceOf(NotFoundError);

    expect(JSON.stringify(await getQuizForEditor(db, "alice", quizId))).toBe(before);
    expect(await count("quizzes")).toBe(1);
  });

  it("identifiants inexistants : NotFoundError, pas d'effet de bord", async () => {
    await expect(updateQuizSettings(db, "alice", "nope", { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateQuestion(db, "alice", "nope", sampleQuestion())).rejects.toBeInstanceOf(NotFoundError);
    await expect(duplicateQuiz(db, "alice", "nope", "c")).rejects.toBeInstanceOf(NotFoundError);
    expect(await count("quizzes")).toBe(0);
  });
});

describe("bonnes réponses : aucune lecture destinée au client ne renvoie is_correct", () => {
  const leaks = (value: unknown) => /is_?correct/i.test(JSON.stringify(value));

  it("listes, bilan, recherche par code : aucune clé isCorrect / is_correct", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Q", questions: [sampleQuestion()] });
    await db.insert(gameSessions).values(sessionRow("s1", "ABC234", { quizId }));
    await db.insert(gameSessions).values(sessionRow("s2", "DEF567", { quizId }));
    await saveSessionResults(db, "s1", players(2), stats(2));

    expect(leaks(await listQuizzes(db, "alice"))).toBe(false);
    expect(leaks(await listPlayedSessions(db, "alice"))).toBe(false);
    expect(leaks(await getSessionReport(db, "alice", "s1"))).toBe(false);
    expect(leaks(await findActiveSessionByCode(db, "DEF567"))).toBe(false);
  });

  it("seuls getQuizForEditor (propriétaire) et loadQuizSnapshot portent la correction", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Q", questions: [sampleQuestion()] });
    expect(leaks(await getQuizForEditor(db, "alice", quizId))).toBe(true);
    expect(leaks(await loadQuizSnapshot(db, "alice", quizId))).toBe(true);
    expect(leaks(await getQuizForEditor(db, "bob", quizId))).toBe(false);
  });
});

describe("contraintes CHECK", () => {
  const rawQuestion = (type: unknown, duration: unknown) =>
    env.DB.prepare("INSERT INTO questions (id, quiz_id, position, type, duration_sec) VALUES (?, ?, 0, ?, ?)")
      .bind(crypto.randomUUID(), "z", type, duration)
      .run();
  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO quizzes (id, owner_id, title, created_at, updated_at) VALUES ('z', 'alice', 't', 0, 0)").run();
  });

  it.each([["SINGLE"], [""], ["text"], ["true-false"], ["free_text"]])("type %j refusé", async (type) => {
    await expect(rawQuestion(type, 20)).rejects.toThrow(/CHECK constraint failed/);
  });
  it("type NULL refusé", async () => {
    await expect(rawQuestion(null, 20)).rejects.toThrow();
  });
  it.each([10, 20, 30, 60])("durée %i acceptée", async (d) => {
    await expect(rawQuestion("single", d)).resolves.toBeDefined();
  });
  it.each([[0], [5], [15], [45], [61], [-10], ["20x"]])("durée %j refusée", async (d) => {
    await expect(rawQuestion("single", d)).rejects.toThrow();
  });
  it("mode invalide refusé sur quizzes et game_sessions", async () => {
    await expect(env.DB.prepare("UPDATE quizzes SET mode = 'solo' WHERE id = 'z'").run()).rejects.toThrow(/CHECK constraint failed/);
    await expect(db.insert(gameSessions).values(sessionRow("s1", "ABC234", { mode: "solo" as never }))).rejects.toThrow();
    await expect(db.insert(gameSessions).values(sessionRow("s2", "ABC235", { status: "paused" as never }))).rejects.toThrow();
  });
  it("les fonctions d'accès refusent un type ou une durée invalide sans rien écrire", async () => {
    const quizId = await createQuiz(db, "alice", { title: "T" });
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ type: "text" as never }))).rejects.toThrow();
    await expect(addQuestion(db, "alice", quizId, sampleQuestion({ durationSec: 15 as never }))).rejects.toThrow();
    expect(await count("questions")).toBe(0);
    expect(await count("options")).toBe(0);
  });
});

describe("code de partie", () => {
  // createGameSession exige un quiz appartenant à l'animateur.
  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO quizzes (id, owner_id, title, created_at, updated_at) VALUES ('qa-quiz', 'alice', 'Q', 0, 0)").run();
  });

  it("alphabet : jamais 0, O, 1, I, ni minuscule, sur un grand tirage", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) for (const c of generateGameCode()) seen.add(c);
    expect([...seen].join("")).not.toMatch(/[01OI]/);
    expect(seen.size).toBeGreaterThan(25);
  });

  it("générateur borné : max exclu respecté aux deux extrémités", () => {
    expect(generateGameCode(() => 0)).toBe("AAAAAA");
    expect(generateGameCode((max) => max - 1)).toBe("999999".replace(/9/g, "9"));
  });

  function forceCodes(collisions: number, then: number) {
    let calls = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint32Array) => {
      arr[0] = Math.floor(calls++ / 6) < collisions ? 0 : then;
      return arr;
    }) as never);
  }

  it("collision avec une partie active : réessaie et obtient un autre code", async () => {
    await db.insert(gameSessions).values(sessionRow("s0", "AAAAAA", { status: "lobby" }));
    forceCodes(2, 5);
    const { code } = await createGameSession(db, { id: "s1", ownerId: "alice", quizId: "qa-quiz", quizTitle: "Q", mode: "together", showCorrectAnswer: true, shuffle: false });
    expect(code).toBe("FFFFFF");
    expect((await findActiveSessionByCode(db, "AAAAAA"))?.id).toBe("s0");
  });

  it("épuise les tentatives et lève une erreur claire", async () => {
    await db.insert(gameSessions).values(sessionRow("s0", "AAAAAA", { status: "running" }));
    forceCodes(1000, 0);
    await expect(
      createGameSession(db, { id: "s1", ownerId: "alice", quizId: "qa-quiz", quizTitle: "Q", mode: "together", showCorrectAnswer: true, shuffle: false }),
    ).rejects.toThrow("Aucun code de partie disponible");
    expect(await count("game_sessions")).toBe(1);
  });

  it("n'avale pas une erreur qui n'est pas une collision (propriétaire inconnu)", async () => {
    await expect(
      createGameSession(db, { id: "s1", ownerId: "fantome", quizId: "qa-quiz", quizTitle: "Q", mode: "together", showCorrectAnswer: true, shuffle: false }),
    ).rejects.toThrow();
  });

  it("code d'une partie terminée réutilisable, et unicité conservée sur lobby/running", async () => {
    await db.insert(gameSessions).values(sessionRow("s0", "AAAAAA", { status: "running" }));
    forceCodes(1000, 0);
    await expect(
      createGameSession(db, { id: "s1", ownerId: "alice", quizId: "qa-quiz", quizTitle: "Q", mode: "together", showCorrectAnswer: true, shuffle: false }),
    ).rejects.toThrow();
    await saveSessionResults(db, "s0", [], []);
    const { code } = await createGameSession(db, { id: "s2", ownerId: "alice", quizId: "qa-quiz", quizTitle: "Q", mode: "together", showCorrectAnswer: true, shuffle: false });
    expect(code).toBe("AAAAAA");
    expect((await findActiveSessionByCode(db, "AAAAAA"))?.id).toBe("s2");
  });

  it("findActiveSessionByCode : code inconnu, minuscules et vide donnent null", async () => {
    await db.insert(gameSessions).values(sessionRow("s0", "ABC234", { status: "lobby" }));
    expect(await findActiveSessionByCode(db, "ZZZZZZ")).toBeNull();
    expect(await findActiveSessionByCode(db, "")).toBeNull();
    expect(await findActiveSessionByCode(db, "abc234")).toBeNull();
  });
});

describe("saveSessionResults : limites D1", () => {
  beforeEach(async () => {
    await db.insert(gameSessions).values(sessionRow("s1", "ABC234"));
  });

  it("200 joueurs x 25 questions : un batch, au plus 100 paramètres par requête, moins de 50 requêtes", async () => {
    const spied = spiedDb();
    await saveSessionResults(spied.db, "s1", players(200), stats(25));
    expect(spied.trace.batches).toHaveLength(1);
    expect(spied.trace.batches[0]).toBeLessThan(50);
    expect(Math.max(...spied.trace.bound)).toBeLessThanOrEqual(100);
    expect(spied.trace.prepared).toBe(spied.trace.batches[0]);
    expect(await count("session_players")).toBe(200);
    expect(await count("question_stats")).toBe(25);
  });

  it("aucune question, aucun joueur : termine quand même la partie", async () => {
    await saveSessionResults(db, "s1", [], []);
    expect((await getSessionReport(db, "alice", "s1"))?.session.status).toBe("ended");
  });

  it("atomicité : échec sur une statistique annule aussi les joueurs et le statut", async () => {
    const broken = [...stats(2), { ...stats(1)[0]!, prompt: null as unknown as string }];
    await expect(saveSessionResults(db, "s1", players(20), broken)).rejects.toThrow();
    expect(await count("session_players")).toBe(0);
    expect(await count("question_stats")).toBe(0);
    expect((await env.DB.prepare("SELECT status, ended_at FROM game_sessions").first())).toEqual({ status: "running", ended_at: null });
  });

  it("partie inconnue : rejet, rien d'écrit", async () => {
    await expect(saveSessionResults(db, "fantome", players(2), stats(1))).rejects.toThrow();
    expect(await count("session_players")).toBe(0);
    expect(await count("question_stats")).toBe(0);
  });

  it("appel en double sur la même partie : pas de joueurs ni de statistiques dupliqués", async () => {
    await saveSessionResults(db, "s1", players(5), stats(3));
    await saveSessionResults(db, "s1", players(5), stats(3)).catch(() => undefined);
    expect(await count("session_players")).toBe(5);
    expect(await count("question_stats")).toBe(3);
  });
});

describe("purge 90 jours : cas limites", () => {
  async function session(id: string, code: string, createdDays: number, endedDays: number | null) {
    await db.insert(gameSessions).values(
      sessionRow(id, code, {
        status: endedDays === null ? "lobby" : "running",
        createdAt: new Date(NOW.getTime() - createdDays * DAY),
      }),
    );
    if (endedDays !== null)
      await saveSessionResults(db, id, players(2), stats(2), new Date(NOW.getTime() - endedDays * DAY));
  }
  const ids = async () => (await env.DB.prepare("SELECT id FROM game_sessions ORDER BY id").all<{ id: string }>()).results.map((r) => r.id);

  it("bornes 89 j / 90 j pile / 90 j + 1 ms / 91 j", async () => {
    await session("j89", "AAAAA2", 89, 89);
    await session("j90", "AAAAA3", 90, 90);
    await session("j90m", "AAAAA4", 90, 90 + 1 / DAY);
    await session("j91", "AAAAA5", 91, 91);
    await purgeOldSessions(db, NOW);
    expect(await ids()).toEqual(["j89", "j90"]);
    expect(await count("session_players")).toBe(4);
    expect(await count("question_stats")).toBe(4);
  });

  it("partie jamais terminée : conservée à 89 j, supprimée à 91 j ; longue partie récemment terminée conservée", async () => {
    await session("lobby89", "BBBBB2", 89, null);
    await session("lobby91", "BBBBB3", 91, null);
    await session("long", "BBBBB4", 200, 10);
    await purgeOldSessions(db, NOW);
    expect(await ids()).toEqual(["lobby89", "long"]);
    expect(await count("session_players")).toBe(2);
  });

  it("cascade : joueurs et statistiques des seules parties expirées, quiz et comptes intacts", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Garde", questions: [sampleQuestion()] });
    await db.insert(gameSessions).values(sessionRow("vieux", "CCCCC2", { quizId, createdAt: new Date(NOW.getTime() - 120 * DAY) }));
    await saveSessionResults(db, "vieux", players(3), stats(2), new Date(NOW.getTime() - 120 * DAY));
    await session("frais", "CCCCC3", 1, 1);
    await purgeOldSessions(db, NOW);
    expect(await ids()).toEqual(["frais"]);
    expect(await count("session_players")).toBe(2);
    expect(await count("question_stats")).toBe(2);
    expect(await count("quizzes")).toBe(1);
    expect(await count("questions")).toBe(1);
    expect(await count("options")).toBe(2);
    expect(await count("user")).toBe(2);
    expect((await getQuizForEditor(db, "alice", quizId))?.title).toBe("Garde");
  });

  it("base vide et double exécution : sans erreur, idempotent", async () => {
    await purgeOldSessions(db, NOW);
    await session("vieux", "DDDDD2", 100, 100);
    await purgeOldSessions(db, NOW);
    await purgeOldSessions(db, NOW);
    expect(await count("game_sessions")).toBe(0);
  });

  it("gros volume : 200 joueurs x 25 questions purgés en un batch de 3 requêtes", async () => {
    await db.insert(gameSessions).values(sessionRow("gros", "EEEEE2", { createdAt: new Date(NOW.getTime() - 100 * DAY) }));
    await saveSessionResults(db, "gros", players(200), stats(25), new Date(NOW.getTime() - 100 * DAY));
    const spied = spiedDb();
    await purgeOldSessions(spied.db, NOW);
    expect(spied.trace.batches).toEqual([3]);
    expect(Math.max(...spied.trace.bound)).toBeLessThanOrEqual(100);
    expect(await count("session_players")).toBe(0);
    expect(await count("question_stats")).toBe(0);
  });
});

describe("reorderQuestions : ordres invalides", () => {
  async function setup() {
    const quizId = await createQuiz(db, "alice", { title: "A" });
    const ids = [] as string[];
    for (const p of ["Un", "Deux", "Trois"]) ids.push(await addQuestion(db, "alice", quizId, sampleQuestion({ prompt: p })));
    return { quizId, ids };
  }
  const order = async (quizId: string) => (await getQuizForEditor(db, "alice", quizId))!.questions.map((q) => q.prompt);

  it.each([
    ["id manquant", (i: string[]) => [i[0]!, i[1]!]],
    ["liste vide", () => []],
    ["id en trop", (i: string[]) => [...i, "inconnu"]],
    ["id inconnu à la place d'un", (i: string[]) => [i[0]!, i[1]!, "inconnu"]],
    ["doublon (même longueur)", (i: string[]) => [i[0]!, i[0]!, i[1]!]],
    ["doublon + manquant", (i: string[]) => [i[0]!, i[0]!, i[0]!]],
  ])("%s : rejeté sans modifier l'ordre", async (_n, make) => {
    const { quizId, ids } = await setup();
    await expect(reorderQuestions(db, "alice", quizId, make(ids))).rejects.toThrow();
    expect(await order(quizId)).toEqual(["Un", "Deux", "Trois"]);
  });

  it("ids d'un autre quiz du même propriétaire : rejeté, aucun des deux quiz modifié", async () => {
    const a = await setup();
    const b = await createQuiz(db, "alice", { title: "B", questions: [sampleQuestion({ prompt: "B1" }), sampleQuestion({ prompt: "B2" }), sampleQuestion({ prompt: "B3" })] });
    const foreign = (await getQuizForEditor(db, "alice", b))!.questions.map((q) => q.id);
    await expect(reorderQuestions(db, "alice", a.quizId, foreign)).rejects.toThrow();
    await expect(reorderQuestions(db, "alice", a.quizId, [a.ids[0]!, a.ids[1]!, foreign[0]!])).rejects.toThrow();
    expect(await order(a.quizId)).toEqual(["Un", "Deux", "Trois"]);
    expect(await order(b)).toEqual(["B1", "B2", "B3"]);
  });

  it("ids d'un quiz d'un autre compte : rejeté, quiz de la victime intact", async () => {
    const a = await setup();
    const bobQuiz = await createQuiz(db, "bob", { title: "Bob", questions: [sampleQuestion({ prompt: "Bob1" })] });
    const bobIds = (await getQuizForEditor(db, "bob", bobQuiz))!.questions.map((q) => q.id);
    await expect(reorderQuestions(db, "alice", a.quizId, [...a.ids.slice(0, 2), bobIds[0]!])).rejects.toThrow();
    await expect(reorderQuestions(db, "alice", bobQuiz, bobIds)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getQuizForEditor(db, "bob", bobQuiz))!.questions.map((q) => q.prompt)).toEqual(["Bob1"]);
    expect(await order(a.quizId)).toEqual(["Un", "Deux", "Trois"]);
  });

  it("quiz sans question : liste vide acceptée", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Vide" });
    await expect(reorderQuestions(db, "alice", quizId, [])).resolves.toBeUndefined();
  });
});

describe("mesure : createQuiz et limite de 50 requêtes", () => {
  it("INFO nombre d'instructions du batch createQuiz pour 10 questions de 4 options", async () => {
    const spied = spiedDb();
    const qs = Array.from({ length: 10 }, () => sampleQuestion({ options: ["a", "b", "c", "d"].map((label) => ({ label, isCorrect: label === "a" })) }));
    await createQuiz(spied.db, "alice", { title: "Gros", questions: qs });
    console.log("createQuiz 10 questions : instructions =", spied.trace.batches[0]);
    expect(spied.trace.batches).toHaveLength(1);
  });
});

describe("seed local rejouable", () => {
  const statements = seedSql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const run = () => env.DB.batch(statements.map((s) => env.DB.prepare(s)));

  it("deux exécutions donnent le même état, sans doublon, avec un quiz jouable", async () => {
    await run();
    expect(await count("user WHERE id = 'seed-user'")).toBe(1);
    const first = await Promise.all(["quizzes", "questions", "options"].map(count));
    await run();
    const second = await Promise.all(["quizzes", "questions", "options"].map(count));
    expect(first).toEqual([1, 3, 10]);
    expect(second).toEqual(first);
    const snap = await loadQuizSnapshot(db, "seed-user", "seed-quiz");
    expect(snap?.questions).toHaveLength(3);
    for (const q of snap!.questions) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options.some((o) => o.isCorrect)).toBe(true);
    }
    expect(snap!.questions.map((q) => q.type)).toEqual(["single", "multiple", "true_false"]);
    expect(await listQuizzes(db, "seed-user")).toMatchObject([{ questionCount: 3, incompleteCount: 0 }]);
  });

  it("rejoué après une partie jouée sur le quiz de démonstration : ne plante pas", async () => {
    await run();
    await db.insert(gameSessions).values(sessionRow("sd", "SEED22", { ownerId: "seed-user", quizId: "seed-quiz" }));
    await expect(run()).resolves.toBeDefined();
    expect(await count("quizzes")).toBe(1);
  });
});
