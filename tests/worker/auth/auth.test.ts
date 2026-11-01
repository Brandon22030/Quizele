import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availableLoginMethods } from "../../../src/server/auth/auth";
import { getSessionUser } from "../../../src/server/auth/session";
import { isProtectedPath, loginRedirectUrl } from "../../../src/server/auth/routes";
import { magicLinkMail } from "../../../src/server/mail/templates";
import { sendMail } from "../../../src/server/mail/send-mail";
import { freshDb } from "../db/helpers";
import { authEnv, authFetch, captureConsoleMail, ORIGIN, requestMagicLink, sessionCookie } from "./helpers";

beforeEach(async () => {
  await freshDb();
  await env.DB.prepare("DELETE FROM rate_limit").run();
});
afterEach(() => vi.restoreAllMocks());

async function signIn(email: string) {
  const mail = captureConsoleMail();
  expect((await requestMagicLink(email)).status).toBe(200);
  const verify = await authFetch(new URL(mail.link()).pathname + new URL(mail.link()).search);
  return { verify, cookie: sessionCookie(verify) };
}

describe("lien magique", () => {
  it("demande de lien -> lien capturé -> session créée -> locals.user rempli", async () => {
    const { verify, cookie } = await signIn("anim@example.test");
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toContain("/tableau-de-bord");
    expect(cookie).toContain("session_token");

    const user = await getSessionUser(authEnv(), new Request(`${ORIGIN}/tableau-de-bord`, { headers: { cookie } }));
    expect(user).toEqual({ id: expect.any(String), name: null, email: "anim@example.test" });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM session").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("le middleware laisse passer une route protégée avec session et redirige sans session", async () => {
    const { cookie } = await signIn("anim@example.test");
    const anonymous = await SELF.fetch(`${ORIGIN}/tableau-de-bord`, { redirect: "manual" });
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("location")).toBe("/connexion?retour=%2Ftableau-de-bord");

    const connected = await SELF.fetch(`${ORIGIN}/tableau-de-bord`, { redirect: "manual", headers: { cookie } });
    expect(connected.status).not.toBe(302);
  });

  it("garde les routes publiques ouvertes et protège quiz et partie", async () => {
    for (const path of ["/", "/j/ABC234", "/api/parties/ABC234/joueurs", "/api/auth/get-session"]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual" });
      expect(res.headers.get("location") ?? "").not.toContain("/connexion");
    }
    for (const path of ["/quiz/abc", "/partie/abc/animer"]) {
      const res = await SELF.fetch(`${ORIGIN}${path}?x=1`, { redirect: "manual" });
      expect(res.headers.get("location")).toBe(`/connexion?retour=${encodeURIComponent(`${path}?x=1`)}`);
    }
  });

  it("un cookie de session invalide donne un utilisateur nul", async () => {
    const user = await getSessionUser(
      authEnv(),
      new Request(`${ORIGIN}/tableau-de-bord`, { headers: { cookie: "better-auth.session_token=faux.faux" } }),
    );
    expect(user).toBeNull();
  });

  it("refuse un lien expiré et ne crée aucune session", async () => {
    const mail = captureConsoleMail();
    await requestMagicLink("expire@example.test");
    await env.DB.prepare("UPDATE verification SET expires_at = ?").bind(Date.now() - 60_000).run();
    const url = new URL(mail.link());
    const res = await authFetch(url.pathname + url.search);
    expect(sessionCookie(res)).toBe("");
    expect(res.headers.get("location") ?? "").toMatch(/error=/i);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM session").first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("refuse la réutilisation d'un lien déjà consommé", async () => {
    const mail = captureConsoleMail();
    await requestMagicLink("once@example.test");
    const url = new URL(mail.link());
    const first = await authFetch(url.pathname + url.search);
    expect(sessionCookie(first)).toContain("session_token");
    const second = await authFetch(url.pathname + url.search);
    expect(sessionCookie(second)).toBe("");
  });

  it("limite les demandes par adresse e-mail, même depuis des IP différentes", async () => {
    captureConsoleMail();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await requestMagicLink("spam@example.test")).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect((await requestMagicLink("autre@example.test")).status).toBe(200);
  });

  it("est désactivé quand MAGIC_LINK_ENABLED vaut false", async () => {
    const res = await requestMagicLink("anim@example.test", {}, { MAGIC_LINK_ENABLED: "false" });
    expect(res.status).toBe(404);
    expect(availableLoginMethods(authEnv({ MAGIC_LINK_ENABLED: "false" })).magicLink).toBe(false);
    expect(availableLoginMethods(authEnv()).magicLink).toBe(true);
  });
});

describe("Google OAuth", () => {
  const google = { GOOGLE_CLIENT_ID: "client-factice", GOOGLE_CLIENT_SECRET: "secret-factice" };

  it("n'est actif que si GOOGLE_CLIENT_ID est défini", async () => {
    expect(availableLoginMethods(authEnv()).google).toBe(false);
    expect(availableLoginMethods(authEnv(google)).google).toBe(true);
    const res = await authFetch("/api/auth/sign-in/social", {
      method: "POST",
      body: JSON.stringify({ provider: "google", callbackURL: "/tableau-de-bord" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("callback simulé : crée l'utilisateur et la session", async () => {
    const start = await authFetch(
      "/api/auth/sign-in/social",
      { method: "POST", body: JSON.stringify({ provider: "google", callbackURL: "/tableau-de-bord" }) },
      google,
    );
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state");
    expect(new URL(url).origin).toBe("https://accounts.google.com");

    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const idToken = `${b64({ alg: "none" })}.${b64({ sub: "google-123", email: "g@example.test", email_verified: true, name: "Gaëlle" })}.x`;
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const target = input instanceof Request ? input.url : String(input);
      if (target.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "at", id_token: idToken, expires_in: 3600, token_type: "Bearer" });
      }
      return realFetch(input, init);
    });

    const cookies = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const callback = await authFetch(
      `/api/auth/callback/google?code=code-factice&state=${state}`,
      { headers: { cookie: cookies } },
      google,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain("/tableau-de-bord");
    const cookie = sessionCookie(callback);
    expect(cookie).toContain("session_token");
    const user = await getSessionUser(authEnv(google), new Request(`${ORIGIN}/tableau-de-bord`, { headers: { cookie } }));
    expect(user).toMatchObject({ email: "g@example.test", name: "Gaëlle" });
  });
});

describe("e-mail", () => {
  it("le transport console journalise le lien, sans appel réseau", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sendMail(authEnv(), magicLinkMail("a@example.test", "https://exemple.test/lien", 5));
    expect(info.mock.calls[0]?.[0]).toContain("https://exemple.test/lien");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("le transport resend envoie depuis MAIL_FROM via l'API Resend", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: "email-1" }));
    await sendMail(
      authEnv({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_factice", MAIL_FROM: "Quizdeszeles <onboarding@resend.dev>" }),
      magicLinkMail("a@example.test", "https://exemple.test/lien", 5),
    );
    const request = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(String((request[1] as RequestInit).body));
    expect(String(request[0])).toContain("api.resend.com/emails");
    expect(body.from).toBe("Quizdeszeles <onboarding@resend.dev>");
    expect(body.to).toBe("a@example.test");
  });

  it("le transport resend refuse de partir sans clé", async () => {
    await expect(
      sendMail(authEnv({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "" }), magicLinkMail("a@example.test", "https://x.test", 5)),
    ).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("le message est en français, sans mention d'association, et échappe le lien en HTML", () => {
    const mail = magicLinkMail("a@example.test", 'https://x.test/?a=1&b="2"', 5);
    expect(mail.subject).toBe("Votre lien de connexion à Quizdeszeles");
    expect(`${mail.text} ${mail.html}`).not.toMatch(/association/i);
    expect(mail.text).toContain("valable 5 minutes");
    expect(mail.html).toContain("a=1&amp;b=&quot;2&quot;");
  });
});

describe("routes protégées", () => {
  it("reconnaît les préfixes sans déborder sur des routes voisines", () => {
    expect(isProtectedPath("/tableau-de-bord")).toBe(true);
    expect(isProtectedPath("/quiz/x/reglages")).toBe(true);
    expect(isProtectedPath("/partie/x")).toBe(true);
    expect(isProtectedPath("/quizz")).toBe(false);
    expect(isProtectedPath("/j/ABC234")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
    expect(loginRedirectUrl(new URL("https://x.test/quiz/a?b=c"))).toBe("/connexion?retour=%2Fquiz%2Fa%3Fb%3Dc");
  });
});
