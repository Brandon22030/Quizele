import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import { saveSessionResults } from "../../../src/server/db/results";
import { createGameSession, findActiveSessionByCode, generateGameCode } from "../../../src/server/db/sessions";
import { gameSessions } from "../../../src/server/db/schema";
import { freshDb, insertUser } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
});

const base = (id: string) => ({
  id,
  ownerId: "alice",
  quizId: null as unknown as string,
  quizTitle: "Quiz",
  mode: "together" as const,
  showCorrectAnswer: true,
  shuffle: false,
});

const insertWithCode = (id: string, code: string, status: "lobby" | "running" | "ended") =>
  db.insert(gameSessions).values({ ...base(id), quizId: null, code, status });

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
    const { id, code } = await createGameSession(db, { ...base("s9"), quizId: undefined as never });
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(await findActiveSessionByCode(db, code)).toMatchObject({ id, status: "lobby", ownerId: "alice" });
  });
});
