import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldResolveSession } from "../../../src/server/auth/routes";
import { freshDb } from "../db/helpers";
import { authFetch, captureConsoleMail, ORIGIN, requestMagicLink, sessionCookie } from "./helpers";

// Requête légitime de l'encart de /j/X : statut, titre du quiz et nom de l'animateur, rien d'autre de la table user.
const APERCU_PARTIE = /^select "game_sessions"\."status", "game_sessions"\."quiz_title", "user"\."name" from "game_sessions" inner join "user" on/;

beforeEach(async () => {
  await freshDb();
  await env.DB.batch([env.DB.prepare("DELETE FROM rate_limit"), env.DB.prepare("DELETE FROM mail_quota")]);
});
afterEach(() => vi.restoreAllMocks());

async function signIn(email: string) {
  const mail = captureConsoleMail();
  expect((await requestMagicLink(email)).status).toBe(200);
  const link = new URL(mail.link());
  const cookie = sessionCookie(await authFetch(link.pathname + link.search));
  mail.spy.mockRestore();
  expect(cookie).toContain("session_token");
  return cookie;
}

// Format RPC d'Astro 7 : POST /_actions/<nom>, corps JSON, origine identique (contrôle CSRF d'Astro).
const callAction = (name: string, input: unknown, cookie?: string) =>
  SELF.fetch(`${ORIGIN}/_actions/${name}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(input),
  });

describe("Astro Actions et session", () => {
  it("résout la session sur /_actions/ sans s'étendre aux routes des joueurs", () => {
    expect(shouldResolveSession("/_actions/quiz.lister")).toBe(true);
    expect(shouldResolveSession("/_actions/partie.lancer")).toBe(true);
    for (const path of ["/_actions", "/_actionsx/quiz.lister", "/j/ABC234", "/j/_actions/x", "/api/parties/ABC234/joueurs"]) {
      expect(shouldResolveSession(path), path).toBe(false);
    }
  });

  it("une action appelée avec une session valide voit l'utilisateur et renvoie ses données", async () => {
    const cookie = await signIn("createur@example.test");
    const created = await callAction("quiz.creer", { title: "Quiz des actions" }, cookie);
    expect(created.status).toBe(200);
    const res = await callAction("quiz.lister", {}, cookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/UNAUTHORIZED/);
    expect(text).toContain("Quiz des actions");
  });

  it("sans cookie, l'action répond UNAUTHORIZED sans interroger D1 pour la session", async () => {
    const proto = Object.getPrototypeOf(env.DB) as D1Database;
    const prepare = vi.spyOn(proto, "prepare");
    const res = await callAction("quiz.lister", {});
    expect(prepare).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/UNAUTHORIZED/);
  });

  it("aucune requête ne touche les tables session, user ou account sur /j/X, même avec un cookie valide", async () => {
    const cookie = await signIn("joueur-actions@example.test");
    const proto = Object.getPrototypeOf(env.DB) as D1Database;
    const prepare = vi.spyOn(proto, "prepare");
    const batch = vi.spyOn(proto, "batch");
    // /j/X lit D1 pour l'encart titre et animateur (seule jointure autorisée : le nom de l'animateur), sans résoudre de session.
    await SELF.fetch(`${ORIGIN}/j/ABC234`, { redirect: "manual", headers: { cookie } });
    const touched = prepare.mock.calls.map((c) => String(c[0])).filter((sql) => /\b(session|user|account)\b/i.test(sql) && !APERCU_PARTIE.test(sql));
    expect(touched).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
    // Témoin : sur `/`, le même cookie provoque bien la lecture de la session.
    prepare.mockClear();
    await SELF.fetch(`${ORIGIN}/`, { redirect: "manual", headers: { cookie } });
    expect(prepare.mock.calls.map((c) => String(c[0])).some((sql) => /\b(session|user)\b/i.test(sql))).toBe(true);
    // Chemin qui ne lit rien : aucune requête D1 du tout.
    prepare.mockClear();
    await SELF.fetch(`${ORIGIN}/api/parties/ABC234/joueurs`, { redirect: "manual", headers: { cookie } });
    expect(prepare).not.toHaveBeenCalled();
  });

  describe("CSRF : envoi d'un autre site avec un cookie valide", () => {
    const EVIL = "https://evil.example";
    const quizCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>())!.n;
    const forms: [string, () => { body: BodyInit; headers: Record<string, string> }][] = [
      ["multipart/form-data", () => {
        const body = new FormData();
        body.set("title", "Quiz piégé");
        return { body, headers: {} };
      }],
      ["application/x-www-form-urlencoded", () => ({ body: "title=Quiz+pi%C3%A9g%C3%A9", headers: { "content-type": "application/x-www-form-urlencoded" } })],
      ["text/plain", () => ({ body: "title=Quiz piégé", headers: { "content-type": "text/plain" } })],
    ];

    it.each(forms)("%s depuis une origine étrangère : 403 et aucun quiz créé", async (_type, make) => {
      const cookie = await signIn("cible-csrf@example.test");
      const { body, headers } = make();
      const crossSite: Record<string, string>[] = [{ origin: EVIL }, { "sec-fetch-site": "cross-site" }];
      for (const extra of crossSite) {
        const res = await SELF.fetch(`${ORIGIN}/_actions/quiz.creer`, {
          method: "POST",
          redirect: "manual",
          headers: { ...headers, ...extra, cookie },
          body,
        });
        expect(res.status).toBe(403);
      }
      expect(await quizCount()).toBe(0);
    });

    it("témoin : le même FormData depuis la même origine est accepté", async () => {
      const cookie = await signIn("temoin-csrf@example.test");
      const body = new FormData();
      body.set("title", "Quiz légitime");
      const res = await SELF.fetch(`${ORIGIN}/_actions/quiz.creer`, { method: "POST", redirect: "manual", headers: { origin: ORIGIN, cookie }, body });
      expect(res.status).not.toBe(403);
    });
  });
});
