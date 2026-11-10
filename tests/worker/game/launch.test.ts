import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../../../src/server/db/client";
import { createQuiz, type QuestionInput } from "../../../src/server/db/quizzes";
import { user } from "../../../src/server/db/schema";
import { LaunchError, issueSessionToken, launchGame, type SessionUser } from "../../../src/server/game/launch";
import { GAME_CODE_PATTERN, gameStub } from "../../../src/server/game/router";
import { OWNER_ID, addPlayer, connect, prepareDb, sessionRow, type Client } from "./helpers";

const OTHER_ID = "autre-compte";
const owner: SessionUser = { id: OWNER_ID, name: "Animateur", email: "animateur@example.invalid" };
const other: SessionUser = { id: OTHER_ID, name: null, email: "autre@example.invalid" };
// Simule ce que le middleware place dans `locals` : l'action ne lit que `locals.user`.
const localsOf = (current: SessionUser | null) => ({ user: current });

const opened: Client[] = [];
afterEach(() => {
  for (const client of opened.splice(0)) client.close();
});
beforeAll(async () => {
  await prepareDb();
  await getDb(env.DB).insert(user).values({ id: OTHER_ID, name: "Autre", email: "autre@example.invalid" });
});

const question = (prompt: string, correct = true): QuestionInput => ({
  type: "single",
  prompt,
  durationSec: 20,
  explanation: "Parce que.",
  options: [
    { label: "Oui", isCorrect: correct },
    { label: "Non", isCorrect: false },
  ],
});

const quizFor = (ownerId: string, questions: QuestionInput[], extra = {}) =>
  createQuiz(getDb(env.DB), ownerId, { title: "Mon quiz", questions, ...extra });

async function failure(task: Promise<unknown>): Promise<LaunchError> {
  try {
    await task;
  } catch (error) {
    expect(error).toBeInstanceOf(LaunchError);
    return error as LaunchError;
  }
  throw new Error("Aucune erreur levée");
}

describe("partie.lancer", () => {
  it("lance une partie : code unique, ligne D1 en attente, Durable Object initialisé, jeton hôte valide", async () => {
    const quizId = await quizFor(OWNER_ID, [question("Un ?"), question("Deux ?")]);
    const result = await launchGame(env, localsOf(owner).user, quizId);
    expect(result.code).toMatch(GAME_CODE_PATTERN);
    expect(await sessionRow(result.sessionId)).toMatchObject({ status: "lobby" });

    const host = await connect(result.code, result.hostToken);
    opened.push(host);
    host.send({ type: "resume" });
    const snapshot = await host.waitFor("snapshot");
    expect(snapshot).toMatchObject({ role: "host", phase: "lobby", title: "Mon quiz", mode: "together" });
    const questions = await runInDurableObject(gameStub(env, result.sessionId), (_i, state) => state.storage.sql.exec("SELECT COUNT(*) AS n FROM questions").one());
    expect(questions).toEqual({ n: 2 });

    // Un joueur rejoint par le code, via D1.
    const player = await addPlayer(result.code, "Awa");
    opened.push(player.client);
  });

  it("deux lancements du même quiz donnent deux parties distinctes avec deux codes", async () => {
    const quizId = await quizFor(OWNER_ID, [question("Un ?")]);
    const [a, b] = await Promise.all([launchGame(env, owner, quizId), launchGame(env, owner, quizId)]);
    expect(a.code).not.toBe(b.code);
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("refuse un utilisateur non connecté", async () => {
    const quizId = await quizFor(OWNER_ID, [question("Un ?")]);
    expect((await failure(launchGame(env, localsOf(null).user, quizId))).code).toBe("UNAUTHORIZED");
  });

  it("refuse le quiz d'un autre compte sans révéler qu'il existe, et ne crée aucune partie", async () => {
    const quizId = await quizFor(OWNER_ID, [question("Un ?")]);
    const error = await failure(launchGame(env, other, quizId));
    expect(error.code).toBe("NOT_FOUND");
    expect((await failure(launchGame(env, other, "inexistant"))).message).toBe(error.message);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM game_sessions WHERE owner_id = ?").bind(OTHER_ID).first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("refuse un quiz incomplet : sans question, ou avec une question sans bonne réponse", async () => {
    const empty = await failure(launchGame(env, owner, await quizFor(OWNER_ID, [])));
    expect(empty).toMatchObject({ code: "BAD_REQUEST" });
    const incomplete = await failure(launchGame(env, owner, await quizFor(OWNER_ID, [question("Un ?"), question("Deux ?", false)])));
    expect(incomplete).toMatchObject({ code: "BAD_REQUEST" });
    expect(incomplete.message).toBe("Le quiz n'est pas prêt : la question 2 est à compléter.");
    const several = await failure(launchGame(env, owner, await quizFor(OWNER_ID, [question("A", false), question("B"), question("C", false)])));
    expect(several.message).toBe("Le quiz n'est pas prêt : les questions 1, 3 sont à compléter.");
    const blank = await failure(launchGame(env, owner, await quizFor(OWNER_ID, [{ ...question("  "), prompt: "  " }])));
    expect(blank.message).toContain("la question 1");
  });

  it("conserve les réglages du quiz : mode et correction masquée", async () => {
    const quizId = await quizFor(OWNER_ID, [question("Un ?")], { mode: "own_pace", showCorrectAnswer: false, shuffle: true });
    const result = await launchGame(env, owner, quizId);
    const row = await env.DB.prepare("SELECT mode, show_correct_answer AS show, shuffle FROM game_sessions WHERE id = ?").bind(result.sessionId).first();
    expect(row).toEqual({ mode: "own_pace", show: 0, shuffle: 1 });
    const meta = await runInDurableObject(gameStub(env, result.sessionId), (_i, state) => state.storage.sql.exec("SELECT key, value FROM meta WHERE key IN ('mode', 'shuffle', 'show_correct')").toArray());
    expect(Object.fromEntries(meta.map((r) => [r.key, r.value]))).toEqual({ mode: "own_pace", shuffle: "1", show_correct: "0" });
  });
});

describe("partie.jetonEcran et partie.jetonHote", () => {
  it("le propriétaire obtient un jeton écran, qui ouvre la projection en lecture seule", async () => {
    const result = await launchGame(env, owner, await quizFor(OWNER_ID, [question("Un ?")]));
    const { code, token } = await issueSessionToken(env, owner, result.sessionId, "screen");
    expect(code).toBe(result.code);
    const screen = await connect(code, token);
    opened.push(screen);
    screen.send({ type: "resume" });
    expect(await screen.waitFor("snapshot")).toMatchObject({ role: "screen" });
    screen.send({ type: "start" });
    expect((await screen.waitFor("error")).code).toBe("forbidden");
  });

  it("le propriétaire retrouve la main avec un jeton hôte après un rechargement", async () => {
    const result = await launchGame(env, owner, await quizFor(OWNER_ID, [question("Un ?")]));
    const { token } = await issueSessionToken(env, owner, result.sessionId, "host");
    const host = await connect(result.code, token);
    opened.push(host);
    host.send({ type: "resume" });
    expect(await host.waitFor("snapshot")).toMatchObject({ role: "host" });
  });

  it("refuse un autre compte, un visiteur et une partie terminée", async () => {
    const result = await launchGame(env, owner, await quizFor(OWNER_ID, [question("Un ?")]));
    expect((await failure(issueSessionToken(env, other, result.sessionId, "screen"))).code).toBe("NOT_FOUND");
    expect((await failure(issueSessionToken(env, null, result.sessionId, "host"))).code).toBe("UNAUTHORIZED");
    const host = await connect(result.code, result.hostToken);
    opened.push(host);
    host.send({ type: "end" });
    await host.waitFor("finished");
    expect((await failure(issueSessionToken(env, owner, result.sessionId, "screen"))).code).toBe("NOT_FOUND");
  });
});
