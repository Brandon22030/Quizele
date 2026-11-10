import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "../db/helpers";
import { authFetch, captureConsoleMail, ORIGIN, requestMagicLink, sessionCookie } from "../auth/helpers";

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
  const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  return { cookie, userId: row!.id };
}

async function partie(ownerId: string, id: string) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO game_sessions (id, code, owner_id, quiz_id, quiz_title, mode, show_correct_answer, shuffle, status, created_at, ended_at) VALUES (?, 'ABC234', ?, NULL, 'Secret', 'together', 1, 0, 'ended', 1793000000000, 1793003600000)",
    ).bind(id, ownerId),
    env.DB.prepare("INSERT INTO session_players (id, session_id, pseudo, score, total_time_ms, rank) VALUES (?, ?, 'Grâce', 1, 1000, 1)").bind(`${id}-j`, id),
  ]);
}

const get = (chemin: string, cookie?: string) => SELF.fetch(`${ORIGIN}${chemin}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
const signature = async (r: Response) => ({ status: r.status, cache: r.headers.get("cache-control"), type: r.headers.get("content-type"), location: r.headers.get("location") });

describe("accès au bilan : refus identiques (QA)", () => {
  it("export : non propriétaire, partie inconnue et identifiant exotique donnent la même réponse", async () => {
    const proprio = await signIn("proprio@example.invalid");
    await partie(proprio.userId, "p1");
    const autre = await signIn("autre@example.invalid");
    const reponses = [];
    for (const id of ["p1", "inconnue", encodeURIComponent("../p1"), encodeURIComponent("p1' OR '1'='1"), "%00"]) {
      const r = await get(`/partie/${id}/export.csv`, autre.cookie);
      reponses.push({ ...(await signature(r)), corps: await r.text() });
    }
    expect(new Set(reponses.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(reponses[0]).toMatchObject({ status: 404, cache: "private, no-store", corps: "Bilan introuvable." });
  });

  it("page : non propriétaire et inconnue ont même statut, mêmes en-têtes et même corps hors identifiants", async () => {
    const proprio = await signIn("proprio@example.invalid");
    await partie(proprio.userId, "p1");
    const autre = await signIn("autre@example.invalid");
    const a = await get("/partie/p1/bilan", autre.cookie);
    const b = await get("/partie/inconnue/bilan", autre.cookie);
    expect(await signature(a)).toEqual(await signature(b));
    expect(a.status).toBe(404);
    const [ta, tb] = [await a.text(), await b.text()];
    expect(ta).not.toContain("Secret");
    expect(ta).not.toContain("Grâce");
    expect(ta.replace(/p1/g, "X")).toBe(tb.replace(/inconnue/g, "X").replace(/X/g, "X"));
  });

  it("anonyme : page et export redirigent vers la connexion, existante ou non, sans contenu", async () => {
    const proprio = await signIn("proprio@example.invalid");
    await partie(proprio.userId, "p1");
    for (const chemin of ["/partie/p1/bilan", "/partie/p1/export.csv", "/partie/inconnue/bilan", "/partie/inconnue/export.csv"]) {
      const r = await get(chemin);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe(`/connexion?retour=${encodeURIComponent(chemin)}`);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(await r.text()).not.toContain("Grâce");
    }
  });

  it("cookie de session falsifié : traité comme anonyme", async () => {
    const r = await get("/partie/p1/export.csv", "better-auth.session_token=forge.forge");
    expect(r.status).toBe(302);
  });

  it("le propriétaire ne peut pas exporter avec un autre verbe ; POST non accepté", async () => {
    const proprio = await signIn("proprio@example.invalid");
    await partie(proprio.userId, "p1");
    const r = await SELF.fetch(`${ORIGIN}/partie/p1/export.csv`, { method: "POST", redirect: "manual", headers: { cookie: proprio.cookie, origin: ORIGIN } });
    expect(r.status).not.toBe(200);
    expect(await r.text()).not.toContain("Grâce");
  });
});
