import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../../src/server/auth/auth";
import { freshDb } from "../db/helpers";
import { authEnv, authFetch, captureConsoleMail, captureResendMail, ORIGIN, RESEND_ENV, requestMagicLink, sessionCookie } from "./helpers";

beforeEach(async () => {
  await freshDb();
  await env.DB.batch([env.DB.prepare("DELETE FROM rate_limit"), env.DB.prepare("DELETE FROM mail_quota")]);
});
afterEach(() => vi.restoreAllMocks());

async function signIn(email: string, overrides = {}) {
  const mail = captureConsoleMail();
  expect((await requestMagicLink(email, {}, overrides)).status).toBe(200);
  const link = new URL(mail.link());
  const verify = await authFetch(link.pathname + link.search, {}, overrides);
  return { verify, cookie: sessionCookie(verify), link };
}

const bundle = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual", ...init });

describe("middleware sur le bundle réel (SELF.fetch)", () => {
  it.each(["/tableau-de-bord", "/quiz/x", "/partie/x"])("%s sans session redirige vers /connexion?retour=", async (path) => {
    const res = await bundle(path);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/connexion?retour=${encodeURIComponent(path)}`);
  });

  it("encode correctement chemin et query, y compris les caractères spéciaux", async () => {
    const res = await bundle("/quiz/a%20b/edit?x=1&y=%C3%A9&retour=/evil#frag");
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    const retour = new URL(location, ORIGIN).searchParams.get("retour")!;
    expect(retour).toBe("/quiz/a%20b/edit?x=1&y=%C3%A9&retour=/evil");
    // Un seul paramètre `retour` au premier niveau : la query d'origine n'est pas injectée.
    expect([...new URL(location, ORIGIN).searchParams.keys()]).toEqual(["retour"]);
    expect(location.startsWith("/connexion?retour=")).toBe(true);
  });

  it("une redirection ne peut pas viser un autre site (chemin protocole-relatif)", async () => {
    const res = await bundle("//evil.example/quiz/x");
    const location = res.headers.get("location");
    if (location !== null) expect(location.startsWith("/") && !location.startsWith("//")).toBe(true);
  });

  it("garde publics /, /j/X, /api/parties/X et /api/auth/*", async () => {
    for (const path of ["/", "/j/ABC234", "/api/parties/ABC234", "/api/auth/ok", "/api/auth/get-session"]) {
      const res = await bundle(path);
      expect(res.headers.get("location") ?? "", path).not.toMatch(/connexion/);
    }
    expect((await bundle("/")).status).toBe(200);
  });

  it("sans cookie, aucune requête D1", async () => {
    const proto = Object.getPrototypeOf(env.DB) as D1Database;
    const prepare = vi.spyOn(proto, "prepare");
    const batch = vi.spyOn(proto, "batch");
    for (const path of ["/", "/tableau-de-bord", "/quiz/x", "/j/ABC234"]) await bundle(path);
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it("témoin : avec un cookie de session, D1 est bien interrogé (le test précédent n'est pas vide)", async () => {
    const { cookie } = await signIn("temoin@example.test");
    const proto = Object.getPrototypeOf(env.DB) as D1Database;
    const prepare = vi.spyOn(proto, "prepare");
    const res = await bundle("/tableau-de-bord", { headers: { cookie } });
    expect(res.headers.get("location") ?? "").not.toMatch(/connexion/);
    expect(prepare).toHaveBeenCalled();
  });

  it("une session valide passe la route protégée", async () => {
    const { cookie } = await signIn("anim@example.test");
    for (const path of ["/tableau-de-bord", "/quiz/x", "/partie/x"]) {
      const res = await bundle(path, { headers: { cookie } });
      expect(res.headers.get("location") ?? "", path).not.toMatch(/connexion/);
    }
  });

  it("un cookie falsifié est traité comme anonyme", async () => {
    const { cookie } = await signIn("forge@example.test");
    const [name, value] = cookie.split("; ")[0]!.split("=") as [string, string];
    const forged = [
      `${name}=${value.slice(0, -4)}AAAA`,
      `${name}=faux.faux`,
      `${name}=`,
      `${name}=${value.split(".")[0]}`,
      `${name}=${"A".repeat(300)}`,
    ];
    for (const c of forged) {
      const res = await bundle("/tableau-de-bord", { headers: { cookie: c } });
      expect(res.status, c).toBe(302);
      expect(res.headers.get("location")).toMatch(/^\/connexion\?retour=/);
    }
  });

  it("un cookie de session expiré est traité comme anonyme", async () => {
    const { cookie } = await signIn("perime@example.test");
    expect((await bundle("/tableau-de-bord", { headers: { cookie } })).status).not.toBe(302);
    await env.DB.prepare("UPDATE session SET expires_at = ?").bind(Date.now() - 60_000).run();
    const res = await bundle("/tableau-de-bord", { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/connexion/);
  });

  it("une session supprimée (déconnexion) n'ouvre plus rien", async () => {
    const { cookie } = await signIn("sortie@example.test");
    await env.DB.prepare("DELETE FROM session").run();
    expect((await bundle("/quiz/x", { headers: { cookie } })).status).toBe(302);
  });
});

describe("limite de débit", () => {
  const sameIp = { "cf-connecting-ip": "198.51.100.7" };

  it("par IP : 5 demandes par minute, la 6e reçoit 429", async () => {
    captureConsoleMail();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await requestMagicLink(`ip${i}@example.test`, sameIp)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    // Une autre IP n'est pas bloquée.
    expect((await requestMagicLink("autre-ip@example.test", { "cf-connecting-ip": "198.51.100.8" })).status).toBe(200);
  });

  it("par e-mail : 3 par 60 s, 429 au 4e appel depuis des IP différentes", async () => {
    captureConsoleMail();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await requestMagicLink("cible@example.test")).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("la casse et les espaces de l'e-mail ne contournent pas la limite", async () => {
    captureConsoleMail();
    const variants = ["a@x.fr", "A@x.fr", "A@X.FR", "a@x.fr", " a@x.fr ", "A@x.fr\t"];
    const statuses: number[] = [];
    for (const email of variants) statuses.push((await requestMagicLink(email)).status);
    // Au plus 3 envois acceptés pour la même boîte, quelle que soit la graphie.
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(3);
    expect(statuses.at(-1)).not.toBe(200);
    expect((await requestMagicLink("a@x.fr")).status).toBe(429);
  });

  it("la fenêtre de 60 s se rouvre", async () => {
    captureConsoleMail();
    for (let i = 0; i < 3; i += 1) await requestMagicLink("fenetre@example.test");
    expect((await requestMagicLink("fenetre@example.test")).status).toBe(429);
    await env.DB.prepare("UPDATE rate_limit SET last_request = last_request - 61000 WHERE key LIKE 'magic-link:%'").run();
    expect((await requestMagicLink("fenetre@example.test")).status).toBe(200);
  });

  it("un refus 429 n'envoie pas d'e-mail", async () => {
    const mail = captureConsoleMail();
    for (let i = 0; i < 6; i += 1) await requestMagicLink("muet@example.test");
    expect(mail.spy.mock.calls).toHaveLength(3);
  });

  it("20 demandes simultanées pour une même adresse : 3 au plus passent", async () => {
    captureConsoleMail();
    const results = await Promise.all(Array.from({ length: 20 }, () => requestMagicLink("course@example.test")));
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(3);
  });
});

describe("lien magique : cas limites", () => {
  it("MAGIC_LINK_ENABLED=false refuse aussi la vérification d'un lien déjà émis", async () => {
    const mail = captureConsoleMail();
    await requestMagicLink("ancien@example.test");
    const link = new URL(mail.link());
    const res = await authFetch(link.pathname + link.search, {}, { MAGIC_LINK_ENABLED: "false" });
    expect(sessionCookie(res)).toBe("");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM session").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it.each(["FALSE", " false ", "False"])("MAGIC_LINK_ENABLED=%j est lu comme faux", async (value) => {
    expect((await requestMagicLink("x@example.test", {}, { MAGIC_LINK_ENABLED: value })).status).toBe(404);
  });

  it("un jeton falsifié est refusé", async () => {
    const mail = captureConsoleMail();
    await requestMagicLink("forge@example.test");
    const link = new URL(mail.link());
    const token = link.searchParams.get("token")!;
    link.searchParams.set("token", `${token}x`);
    const res = await authFetch(link.pathname + link.search);
    expect(sessionCookie(res)).toBe("");
  });

  it("e-mail invalide ou corps absent : 4xx, aucun envoi", async () => {
    const mail = captureConsoleMail();
    for (const body of [{ email: "pas-un-mail" }, {}, { email: 42 }, { email: "" }]) {
      const res = await authFetch("/api/auth/sign-in/magic-link", { method: "POST", body: JSON.stringify(body) });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect(mail.spy).not.toHaveBeenCalled();
  });

  it("le lien expire après 5 minutes : la ligne de vérification porte une échéance d'au plus 5 min", async () => {
    captureConsoleMail();
    await requestMagicLink("echeance@example.test");
    const row = await env.DB.prepare("SELECT expires_at FROM verification").first<{ expires_at: number }>();
    const delta = row!.expires_at - Date.now();
    expect(delta).toBeGreaterThan(4 * 60_000);
    expect(delta).toBeLessThanOrEqual(5 * 60_000 + 2_000);
  });
});

describe("e-mail : contenu et transport", () => {
  it("le lien envoyé pointe vers l'origine de la requête en local, en français, sans association", async () => {
    const mail = captureConsoleMail();
    await requestMagicLink("fr@example.test");
    const text = mail.spy.mock.calls.map((c) => String(c[0])).join("\n");
    const link = new URL(mail.link());
    expect(link.origin).toBe(ORIGIN);
    expect(link.pathname).toBe("/api/auth/magic-link/verify");
    expect(text).toMatch(/Votre lien de connexion|Bonjour/);
    expect(text).not.toMatch(/association/i);
  });

  it("hors localhost, le lien utilise BETTER_AUTH_URL et non l'hôte de la requête", async () => {
    const mail = captureResendMail();
    const request = new Request("https://autre-hote.example/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { origin: "https://quiz.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
      body: JSON.stringify({ email: "prod@example.test" }),
    });
    const auth = createAuth(authEnv({ BETTER_AUTH_URL: "https://quiz.example", ...RESEND_ENV }), request);
    expect((await auth.handler(request)).status).toBe(200);
    const text = mail.text();
    expect(text).toContain("https://quiz.example/api/auth/magic-link/verify");
    expect(text).not.toContain("autre-hote.example");
  });

  it("transport Resend simulé : envoi sans journaliser le lien ; erreur Resend sans fuite de détail", async () => {
    const resendEnv = { MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_secret_factice_123", MAIL_FROM: "Quizdeszeles <onboarding@resend.dev>" };
    const logs = [vi.spyOn(console, "info"), vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) => s.mockImplementation(() => {}));
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("api.resend.com")) return Response.json({ message: "Domaine non vérifié", name: "validation_error" }, { status: 422 });
      return realFetch(input, init);
    });
    const res = await requestMagicLink("resend@example.test", {}, resendEnv);
    expect(fetchSpy.mock.calls.some((c) => String(c[0] instanceof Request ? c[0].url : c[0]).includes("api.resend.com"))).toBe(true);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    expect(body).not.toMatch(/re_secret_factice_123|resend|Domaine non vérifié|stack/i);
    const journal = logs.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
    expect(journal).not.toContain("re_secret_factice_123");
    expect(journal).not.toMatch(/magic-link\/verify\?token=/);
  });

  it("transport Resend réussi : le lien n'est journalisé nulle part", async () => {
    const resendEnv = { MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_ok_factice", MAIL_FROM: "Quizdeszeles <onboarding@resend.dev>" };
    const logs = [vi.spyOn(console, "info"), vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) => s.mockImplementation(() => {}));
    const realFetch = globalThis.fetch;
    let sent = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("api.resend.com")) {
        sent = String((init as RequestInit).body);
        return Response.json({ id: "e1" });
      }
      return realFetch(input, init);
    });
    expect((await requestMagicLink("ok@example.test", {}, resendEnv)).status).toBe(200);
    expect(sent).toContain("magic-link/verify");
    expect(logs.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n")).not.toContain("token=");
  });
});

describe("sécurité", () => {
  it("createAuth lève une erreur explicite sans BETTER_AUTH_SECRET", () => {
    expect(() => createAuth(authEnv({ BETTER_AUTH_SECRET: undefined }))).toThrow(/BETTER_AUTH_SECRET manquant/);
    expect(() => createAuth(authEnv({ BETTER_AUTH_SECRET: "" }))).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("hors localhost sans BETTER_AUTH_URL : erreur explicite", () => {
    const request = new Request("https://quiz.example/api/auth/ok");
    expect(() => createAuth(authEnv({ BETTER_AUTH_URL: undefined }), request)).toThrow(/BETTER_AUTH_URL/);
  });

  it("le cookie de session est HttpOnly et SameSite, sans Secure sur localhost", async () => {
    const { verify } = await signIn("cookie@example.test");
    const header = verify.headers.getSetCookie().find((c) => c.includes("session_token"))!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=(Lax|Strict)/i);
    expect(header).not.toMatch(/;\s*Secure/i);
    expect(header).toMatch(/Path=\//i);
  });

  it("le cookie de session est Secure hors localhost", async () => {
    const overrides = { BETTER_AUTH_URL: "https://quiz.example", ...RESEND_ENV };
    const mail = captureResendMail();
    const headers = { origin: "https://quiz.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" };
    const ask = new Request("https://quiz.example/api/auth/sign-in/magic-link", { method: "POST", headers, body: JSON.stringify({ email: "https@example.test" }) });
    expect((await createAuth(authEnv(overrides), ask).handler(ask)).status).toBe(200);
    const link = mail.link();
    const verify = new Request(link, { headers: { "cf-connecting-ip": "203.0.113.10" }, redirect: "manual" });
    const res = await createAuth(authEnv(overrides), verify).handler(verify);
    const header = res.headers.getSetCookie().find((c) => c.includes("session_token"))!;
    expect(header).toBeDefined();
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).toMatch(/SameSite=(Lax|Strict)/i);
  });

  it("aucun secret dans les réponses de l'API d'authentification", async () => {
    captureConsoleMail();
    const secrets = [env.BETTER_AUTH_SECRET, env.PLAYER_TOKEN_SECRET, "secret-factice"].filter(Boolean) as string[];
    const responses = [
      await requestMagicLink("sec@example.test"),
      await requestMagicLink("sec@example.test", {}, { MAGIC_LINK_ENABLED: "false" }),
      await authFetch("/api/auth/get-session"),
      await authFetch("/api/auth/sign-in/social", { method: "POST", body: JSON.stringify({ provider: "google" }) }, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret-factice" }),
      await authFetch("/api/auth/inconnu"),
      await bundle("/api/auth/get-session"),
    ];
    for (const res of responses) {
      const text = `${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${await res.text()}`;
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });

  it("le lien n'est journalisé que par le transport console, et aucun secret n'est journalisé", async () => {
    const calls = [vi.spyOn(console, "info"), vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) => s.mockImplementation(() => {}));
    await requestMagicLink("journal@example.test");
    const journal = calls.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
    expect(journal).not.toContain(env.BETTER_AUTH_SECRET as string);
    expect(journal).not.toContain(env.PLAYER_TOKEN_SECRET as string);
  });

  it("la session est stockée dans D1 (jamais en KV) avec une échéance", async () => {
    await signIn("d1@example.test");
    const row = await env.DB.prepare("SELECT user_id, expires_at FROM session").first<{ user_id: string; expires_at: number }>();
    expect(row?.expires_at).toBeGreaterThan(Date.now());
  });
});
