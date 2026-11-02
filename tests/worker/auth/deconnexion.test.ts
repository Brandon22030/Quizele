import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCrossSiteRequest } from "../../../src/server/auth/sign-out";
import { freshDb } from "../db/helpers";
import { authFetch, captureConsoleMail, ORIGIN, requestMagicLink, sessionCookie } from "./helpers";

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
