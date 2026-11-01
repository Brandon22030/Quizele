import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../src/server/db/client";
import { createQuiz } from "../../../src/server/db/quizzes";
import { freshDb } from "../db/helpers";
import { authFetch, captureConsoleMail, ORIGIN, requestMagicLink, sessionCookie } from "../auth/helpers";

beforeEach(async () => {
  await freshDb();
  await env.DB.batch([env.DB.prepare("DELETE FROM rate_limit"), env.DB.prepare("DELETE FROM mail_quota"), env.DB.prepare("DELETE FROM quota")]);
});
afterEach(() => vi.restoreAllMocks());

async function signIn(email: string) {
  const mail = captureConsoleMail();
  expect((await requestMagicLink(email)).status).toBe(200);
  const link = new URL(mail.link());
  const cookie = sessionCookie(await authFetch(link.pathname + link.search));
  mail.spy.mockRestore();
  return cookie;
}

const callAction = (name: string, input: unknown, cookie?: string) =>
  SELF.fetch(`${ORIGIN}/_actions/${name}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(input),
  });

async function quizOf(email: string): Promise<string> {
  const owner = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  return createQuiz(getDb(env.DB), owner!.id, {
    title: "Quiz lancé par l'action",
    questions: [{ type: "single", prompt: "Un ?", durationSec: 20, options: [{ label: "Oui", isCorrect: true }, { label: "Non", isCorrect: false }] }],
  });
}

describe("POST /_actions/partie.lancer via le vrai middleware", () => {
  it("avec un cookie de session valide, la partie est créée et le jeton hôte renvoyé", async () => {
    const email = "animateur-lancer@example.test";
    const cookie = await signIn(email);
    const quizId = await quizOf(email);
    const res = await callAction("partie.lancer", { quizId }, cookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("hostToken");
    expect(text).toContain("sessionId");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM game_sessions").first<{ n: number }>())!.n).toBe(1);
  });

  it("sans cookie, la réponse est 401 et aucune partie n'est créée", async () => {
    const email = "animateur-sans-cookie@example.test";
    await signIn(email);
    const quizId = await quizOf(email);
    const res = await callAction("partie.lancer", { quizId });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/UNAUTHORIZED/);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM game_sessions").first<{ n: number }>())!.n).toBe(0);
  });

  it("le quiz d'un autre compte est introuvable (404) même avec une session valide", async () => {
    const cookie = await signIn("intrus@example.test");
    const owner = "proprio@example.test";
    await signIn(owner);
    const res = await callAction("partie.lancer", { quizId: await quizOf(owner) }, cookie);
    expect(res.status).toBe(404);
  });
});
