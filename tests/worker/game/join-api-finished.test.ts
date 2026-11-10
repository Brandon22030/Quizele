import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/server/db/client";
import { createQuiz } from "../../../src/server/db/quizzes";
import { gameSessions } from "../../../src/server/db/schema";
import { freshDb, insertUser } from "../db/helpers";

const ORIGIN = "http://localhost";

const join = (code: string) =>
  SELF.fetch(`${ORIGIN}/api/parties/${code}/joueurs`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ pseudo: "Léa" }),
  });

let quizId: string;
beforeEach(async () => {
  const db = await freshDb();
  await insertUser(db, "alice");
  quizId = await createQuiz(db, "alice", { title: "Quiz" });
});

const insertSession = (id: string, code: string, status: "lobby" | "running" | "ended", createdAt: number) =>
  getDb(env.DB)
    .insert(gameSessions)
    .values({ id, code, ownerId: "alice", quizId, quizTitle: "Quiz", mode: "together", showCorrectAnswer: true, shuffle: false, status, createdAt: new Date(createdAt) });

describe("POST /api/parties/<code>/joueurs : code périmé", () => {
  it("répond 410 game_finished pour une partie terminée", async () => {
    await insertSession("s1", "ABC234", "ended", 1000);
    const res = await join("ABC234");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "game_finished" });
  });

  it("répond 410 quand la plus récente partie du code est terminée", async () => {
    await insertSession("vieille", "ABC234", "ended", 1000);
    await insertSession("recente", "ABC234", "ended", 2000);
    expect((await join("ABC234")).status).toBe(410);
  });

  it("répond 404 game_not_found pour un code inconnu", async () => {
    const res = await join("ZZZZZZ");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "game_not_found" });
  });
});
