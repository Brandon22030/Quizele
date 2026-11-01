import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import { saveSessionResults } from "../../../src/server/db/results";
import { createQuiz, NotFoundError } from "../../../src/server/db/quizzes";
import { createGameSession, findActiveSessionByCode, generateGameCode, markSessionRunning } from "../../../src/server/db/sessions";
import { gameSessions } from "../../../src/server/db/schema";
import { freshDb, insertUser } from "./helpers";

let db: Db;
let quizId: string;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
  await insertUser(db, "bob");
  quizId = await createQuiz(db, "alice", { title: "Quiz" });
});

const base = (id: string) => ({
  id,
  ownerId: "alice",
  quizId,
  quizTitle: "Quiz",
  mode: "together" as const,
  showCorrectAnswer: true,
  shuffle: false,
});

const insertWithCode = (id: string, code: string, status: "lobby" | "running" | "ended") =>
  db.insert(gameSessions).values({ ...base(id), code, status });

describe("code de partie", () => {
  it("génère 6 caractères A-Z0-9 sans caractère ambigu", () => {
    for (let i = 0; i < 200; i++) expect(generateGameCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("refuse deux parties non terminées avec le même code", async () => {
    await insertWithCode("s1", "ABC234", "lobby");
    await expect(insertWithCode("s2", "ABC234", "running")).rejects.toThrow();
    await expect(insertWithCode("s3", "ABC234", "lobby")).rejects.toThrow();
  });

  it("libère le code une fois la partie terminée", async () => {
    await insertWithCode("s1", "ABC234", "lobby");
    await saveSessionResults(db, "s1", [], []);
    await expect(insertWithCode("s2", "ABC234", "lobby")).resolves.toBeDefined();
    expect((await findActiveSessionByCode(db, "ABC234"))?.id).toBe("s2");
  });

  it("autorise plusieurs parties terminées avec le même code", async () => {
    await insertWithCode("s1", "ABC234", "ended");
    await expect(insertWithCode("s2", "ABC234", "ended")).resolves.toBeDefined();
    expect(await findActiveSessionByCode(db, "ABC234")).toBeNull();
  });

  it("createGameSession crée une partie en salle d'attente avec un code résolu", async () => {
    const { id, code } = await createGameSession(db, base("s9"));
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(await findActiveSessionByCode(db, code)).toMatchObject({ id, status: "lobby", ownerId: "alice" });
    const row = await db.query.gameSessions.findFirst({ where: (t, { eq }) => eq(t.id, "s9") });
    expect(row).toMatchObject({ quizId, ownerId: "alice", quizTitle: "Quiz", mode: "together", showCorrectAnswer: true, shuffle: false });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });
});

describe("createGameSession : propriété du quiz (IDOR)", () => {
  it("refuse de lancer le quiz d'un autre compte, sans rien écrire", async () => {
    await expect(createGameSession(db, { ...base("vol"), ownerId: "bob" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createGameSession(db, { ...base("fantome"), quizId: "inconnu" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.select().from(gameSessions)).toEqual([]);
  });
});

describe("markSessionRunning", () => {
  it("fait passer une partie de la salle d'attente à en cours", async () => {
    await insertWithCode("s1", "ABC234", "lobby");
    await markSessionRunning(db, "s1");
    expect((await findActiveSessionByCode(db, "ABC234"))?.status).toBe("running");
  });

  it("n'a aucun effet sur une partie terminée ni sur une partie déjà en cours", async () => {
    await insertWithCode("fini", "ABC234", "ended");
    await insertWithCode("encours", "DEF567", "running");
    await markSessionRunning(db, "fini");
    await markSessionRunning(db, "encours");
    await markSessionRunning(db, "inconnu");
    const rows = await db.select({ id: gameSessions.id, status: gameSessions.status }).from(gameSessions).orderBy(gameSessions.id);
    expect(rows).toEqual([
      { id: "encours", status: "running" },
      { id: "fini", status: "ended" },
    ]);
  });
});
