import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPrivateCacheHeaders } from "../../../src/server/auth/routes";
import { createAuth, type AuthEnv } from "../../../src/server/auth/auth";
import { isCrossSiteRequest, SIGN_OUT_FAILED_LOCATION, signOutResponse } from "../../../src/server/auth/sign-out";
import { freshDb } from "../db/helpers";
import { authEnv, authFetch, captureConsoleMail, ORIGIN, requestMagicLink, sessionCookie } from "./helpers";

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

// Ce qu'envoie le formulaire HTML de MenuCompte, sans JavaScript.
const postForm = (headers: Record<string, string>) =>
  SELF.fetch(`${ORIGIN}/deconnexion`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: "",
  });

const getSession = async (cookie: string) => (await (await authFetch("/api/auth/get-session", { headers: { cookie } })).json()) as unknown;
const sessionCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM session").first<{ n: number }>())!.n;

// Le navigateur applique les Set-Cookie reçus : on rejoue ce qu'il garderait.
function applySetCookies(cookie: string, res: Response): string {
  const jar = new Map(cookie.split("; ").filter(Boolean).map((c) => c.split("=", 2) as [string, string]));
  for (const header of res.headers.getSetCookie()) {
    const [pair, ...attrs] = header.split(";").map((p) => p.trim());
    const [name, value] = pair!.split("=", 2) as [string, string];
    const expired = attrs.some((a) => /^max-age=0$/i.test(a) || (/^expires=/i.test(a) && Date.parse(a.slice(8)) < Date.now()));
    if (expired || value === "") jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

describe("POST /deconnexion", () => {
  it("avec une session, efface la session, renvoie les cookies d'effacement et redirige en 303 vers /", async () => {
    const cookie = await signIn("sortie@example.test");
    expect(await getSession(cookie)).not.toBeNull();
    const res = await postForm({ origin: ORIGIN, "sec-fetch-site": "same-origin", cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const cleared = res.headers.getSetCookie().find((c) => c.includes("session_token"));
    expect(cleared).toMatch(/max-age=0/i);
    expect(await sessionCount()).toBe(0);
    // Ni le cookie d'origine, ni ce que le navigateur garderait, n'ouvrent encore une session.
    expect(await getSession(cookie)).toBeNull();
    expect(await getSession(applySetCookies(cookie, res))).toBeNull();
  });

  it.each<Record<string, string>>([
    { origin: "https://evil.example" },
    { origin: "http://localhost:9999" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { origin: "https://evil.example", "content-type": "application/json" },
  ])("depuis un autre site (%j) : 403 et la session est conservée", async (headers) => {
    const cookie = await signIn("cible@example.test");
    const res = await postForm({ ...headers, cookie });
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await sessionCount()).toBe(1);
    expect(await getSession(cookie)).not.toBeNull();
  });

  it.each(["GET", "PUT", "DELETE"])("%s renvoie 405 et ne touche pas à la session", async (method) => {
    const cookie = await signIn(`methode-${method.toLowerCase()}@example.test`);
    const res = await SELF.fetch(`${ORIGIN}/deconnexion`, { method, redirect: "manual", headers: { cookie } });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await sessionCount()).toBe(1);
  });

  it("sans cookie, redirige quand même vers / sans erreur et sans requête D1", async () => {
    const proto = Object.getPrototypeOf(env.DB) as D1Database;
    const prepare = vi.spyOn(proto, "prepare");
    const res = await postForm({ origin: ORIGIN });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("avec un cookie de session invalide, redirige vers / sans erreur", async () => {
    const res = await postForm({ origin: ORIGIN, cookie: "better-auth.session_token=faux.faux" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("déconnexion en panne côté serveur", () => {
  const post = (origin: string, cookie: string) =>
    new Request(`${origin}/deconnexion`, { method: "POST", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" } });
  // Better Auth avale les erreurs D1 de signOut : la panne est simulée sur l'appel lui-même.
  const failingAuth = (failure: () => Promise<Response>) => (e: AuthEnv, r: Request) => {
    const real = createAuth(e, r);
    return { $context: real.$context, api: { ...real.api, signOut: failure } as unknown as typeof real.api };
  };
  const failures: [string, () => Promise<Response>][] = [
    ["réponse 500", async () => new Response(null, { status: 500 })],
    ["réponse 503", async () => new Response(null, { status: 503 })],
    ["exception", async () => Promise.reject(new Error("D1_ERROR: base indisponible pour panne@example.test"))],
  ];

  it.each(failures)("%s : cookies du navigateur expirés et redirection vers /connexion?error=deconnexion", async (_cas, failure) => {
    const cookie = await signIn("panne@example.test");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await signOutResponse(authEnv(), post(ORIGIN, cookie), failingAuth(failure));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/connexion?error=deconnexion");
    expect(SIGN_OUT_FAILED_LOCATION).toBe("/connexion?error=deconnexion");
    const setCookies = res.headers.getSetCookie();
    for (const name of ["better-auth.session_token", "better-auth.session_data"]) {
      const header = setCookies.find((c) => c.startsWith(`${name}=;`));
      expect(header, name).toBe(`${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
    }
    // Le navigateur, qui applique ces cookies, ne présente plus de session.
    expect(applySetCookies(cookie, res)).not.toContain("session_token");
    const journal = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(journal).toMatch(/déconnexion non confirmée/);
    expect(journal).not.toContain("panne@example.test");
  });

  it("en https, les cookies expirés reprennent le préfixe __Secure- et l'attribut Secure de Better Auth", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const https = "https://quiz.example";
    const res = await signOutResponse(
      authEnv({ BETTER_AUTH_URL: https, MAIL_TRANSPORT: "resend" }),
      post(https, "__Secure-better-auth.session_token=x.y"),
      failingAuth(async () => new Response(null, { status: 500 })),
    );
    expect(res.headers.get("location")).toBe(SIGN_OUT_FAILED_LOCATION);
    const setCookies = res.headers.getSetCookie();
    for (const name of ["__Secure-better-auth.session_token", "__Secure-better-auth.session_data"]) {
      expect(setCookies.find((c) => c.startsWith(`${name}=;`)), name).toBe(`${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
    }
  });

  it("témoin : les cookies expirés ont les mêmes attributs que ceux qu'efface Better Auth lui-même", async () => {
    const cookie = await signIn("temoin-panne@example.test");
    const ok = await signOutResponse(authEnv(), post(ORIGIN, cookie));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ko = await signOutResponse(authEnv(), post(ORIGIN, cookie), failingAuth(async () => new Response(null, { status: 500 })));
    const attrs = (res: Response, name: string) => {
      const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))!;
      return header.split(";").slice(1).map((a) => a.trim().toLowerCase()).filter((a) => !a.startsWith("expires=")).sort();
    };
    expect(attrs(ko, "better-auth.session_token")).toEqual(attrs(ok, "better-auth.session_token"));
  });

  it("une base indisponible n'empêche pas Better Auth d'effacer les cookies du navigateur", async () => {
    const cookie = await signIn("base-ko@example.test");
    const brokenDb = {
      prepare: () => {
        throw new Error("D1_ERROR");
      },
      batch: () => Promise.reject(new Error("D1_ERROR")),
    } as unknown as D1Database;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await signOutResponse(authEnv({ DB: brokenDb }), post(ORIGIN, cookie));
    expect(res.status).toBe(303);
    expect(applySetCookies(cookie, res)).not.toContain("session_token");
  });
});

describe("isCrossSiteRequest", () => {
  const req = (headers: Record<string, string>) => new Request(`${ORIGIN}/deconnexion`, { method: "POST", headers });

  it("accepte la même origine, une navigation directe et l'absence d'en-têtes", () => {
    expect(isCrossSiteRequest(req({ origin: ORIGIN }))).toBe(false);
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "same-origin", origin: ORIGIN }))).toBe(false);
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "none" }))).toBe(false);
    expect(isCrossSiteRequest(req({}))).toBe(false);
  });

  it("refuse toute autre origine, y compris un sous-domaine ou un autre port", () => {
    expect(isCrossSiteRequest(req({ origin: "null" }))).toBe(true);
    expect(isCrossSiteRequest(req({ origin: "http://localhost:4322" }))).toBe(true);
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "same-site", origin: ORIGIN }))).toBe(true);
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "cross-site" }))).toBe(true);
  });
});

describe("Cache-Control des pages privées", () => {
  const cacheOf = async (path: string, cookie?: string) =>
    (await SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} })).headers.get("cache-control");

  it("/connexion et ses sous-pages ne sont jamais mises en cache, connecté ou non", async () => {
    const cookie = await signIn("cache@example.test");
    for (const path of ["/connexion", "/connexion/verifier"]) {
      expect(await cacheOf(path, cookie), path).toBe("private, no-store");
      expect(await cacheOf(path), path).toBe("private, no-store");
    }
  });

  it("la redirection d'un chemin protégé vers /connexion n'est pas mise en cache", async () => {
    for (const path of ["/tableau-de-bord", "/quiz/x", "/partie/x/animer"]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual" });
      expect(res.status, path).toBe(302);
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    }
  });

  it("les pages publiques ne reçoivent pas l'en-tête, même avec une session", async () => {
    const cookie = await signIn("public@example.test");
    for (const path of ["/", "/j/ABC234", "/api/auth/get-session"]) expect(await cacheOf(path, cookie), path).not.toBe("private, no-store");
  });

  // Les pages protégées (tableau de bord, éditeur) ne sont pas encore construites sur cette branche : la règle
  // appliquée par le middleware à leur réponse est vérifiée sur la fonction qu'il appelle.
  it("une page protégée reçoit toujours private, no-store ; /connexion* garde sa propre politique", () => {
    for (const path of ["/tableau-de-bord", "/quiz/abc/editer", "/partie/x/animer", "/connexion"]) {
      expect(applyPrivateCacheHeaders(path, new Response("ok")).headers.get("cache-control"), path).toBe("private, no-store");
    }
    for (const path of ["/quiz/x", "/tableau-de-bord", "/partie/x"]) {
      const own = new Response("ok", { headers: { "Cache-Control": "public, max-age=3600" } });
      expect(applyPrivateCacheHeaders(path, own).headers.get("cache-control"), path).toBe("private, no-store");
    }
    for (const path of ["/connexion", "/connexion/verifier"]) {
      const own = new Response("ok", { headers: { "Cache-Control": "no-cache" } });
      expect(applyPrivateCacheHeaders(path, own).headers.get("cache-control"), path).toBe("no-cache");
    }
    const player = new Response("ok", { headers: { "Cache-Control": "private, max-age=30" } });
    expect(applyPrivateCacheHeaders("/j/ABC234", player).headers.get("cache-control")).toBe("private, max-age=30");
    for (const path of ["/", "/j/ABC234", "/quizz", "/connexionx"]) {
      expect(applyPrivateCacheHeaders(path, new Response("ok")).headers.has("cache-control"), path).toBe(false);
    }
  });
});
