import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availableLoginMethods, createAuth, isMagicLinkPath, MAGIC_LINK_DAILY_MAX } from "../../../src/server/auth/auth";
import { consumeDailyMailQuota, dailyMailQuotaKey, hashEmailKey, normalizeEmailKey } from "../../../src/server/auth/email-quota";
import { PROTECTED_PREFIXES, safeReturnPath, shouldResolveSession } from "../../../src/server/auth/routes";
import { sendMail } from "../../../src/server/mail/send-mail";
import { magicLinkMail } from "../../../src/server/mail/templates";
import { freshDb } from "../db/helpers";
import { authEnv, authFetch, captureConsoleMail, freshIp, ORIGIN, requestMagicLink, sessionCookie } from "./helpers";

// Requête légitime de l'encart de /j/X : statut, titre du quiz et nom de l'animateur, rien d'autre de la table user.
const APERCU_PARTIE = /^select "game_sessions"\."status", "game_sessions"\."quiz_title", "user"\."name" from "game_sessions" inner join "user" on/;

beforeEach(async () => {
  await freshDb();
  await env.DB.batch([env.DB.prepare("DELETE FROM rate_limit"), env.DB.prepare("DELETE FROM mail_quota")]);
});
afterEach(() => vi.restoreAllMocks());

const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;

async function signIn(email: string, overrides = {}) {
  const mail = captureConsoleMail();
  expect((await requestMagicLink(email, {}, overrides)).status).toBe(200);
  const link = new URL(mail.link());
  const verify = await authFetch(link.pathname + link.search, {}, overrides);
  mail.spy.mockRestore();
  return { verify, cookie: sessionCookie(verify), link };
}

describe("limite par adresse : validation, normalisation, empreinte", () => {
  it("normalise casse, espaces et sous-adressage", () => {
    expect(normalizeEmailKey(" Victime+1@Example.FR ")).toBe("victime@example.fr");
    expect(normalizeEmailKey("victime+a+b@example.fr")).toBe("victime@example.fr");
    expect(normalizeEmailKey("VICTIME@example.fr\t")).toBe("victime@example.fr");
    expect(normalizeEmailKey("autre@example.fr")).toBe("autre@example.fr");
  });

  it("gmail.com et googlemail.com : points ignorés et domaines confondus", async () => {
    expect(normalizeEmailKey("Vic.Ti.Me+x@GoogleMail.com")).toBe("victime@gmail.com");
    expect(normalizeEmailKey("v.ictime@gmail.com")).toBe("victime@gmail.com");
    // Ailleurs, le point est significatif.
    expect(normalizeEmailKey("v.ictime@example.fr")).toBe("v.ictime@example.fr");
    captureConsoleMail();
    const statuses: number[] = [];
    for (const email of ["victime@gmail.com", "v.ictime@gmail.com", "vic.time@googlemail.com", "V.I.C.T.I.M.E+z@gmail.com"]) {
      statuses.push((await requestMagicLink(email)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("les variantes +tag d'une même boîte partagent la limite, l'envoi part vers l'adresse saisie", async () => {
    const mail = captureConsoleMail();
    const statuses: number[] = [];
    for (const email of ["victime+1@example.test", "victime+2@example.test", "Victime@example.test", "victime+3@example.test"]) {
      statuses.push((await requestMagicLink(email)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    const journal = mail.spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(journal).toMatch(/victime\+1@example\.test/i);
    expect(journal).toMatch(/victime\+2@example\.test/i);
  });

  it("seule l'empreinte SHA-256 de la clé normalisée est stockée", async () => {
    captureConsoleMail();
    await requestMagicLink("Empreinte+x@Example.test");
    const keys = (await env.DB.prepare("SELECT key FROM rate_limit").all<{ key: string }>()).results.map((r) => r.key);
    const expected = `magic-link:${await hashEmailKey("empreinte@example.test")}`;
    expect(expected).toMatch(/^magic-link:[0-9a-f]{64}$/);
    expect(keys).toContain(expected);
    expect(keys.join(" ")).not.toMatch(/empreinte|example/i);
  });

  it("une adresse invalide est refusée sans rien écrire ni envoyer", async () => {
    const mail = captureConsoleMail();
    for (const email of ["pas-un-mail", `${"a".repeat(250)}@x.fr`, 42, ""]) {
      const res = await authFetch("/api/auth/sign-in/magic-link", { method: "POST", body: JSON.stringify({ email }) });
      expect(res.status, String(email)).toBeGreaterThanOrEqual(400);
      expect(res.status, String(email)).toBeLessThan(500);
    }
    expect(await count("SELECT COUNT(*) AS n FROM rate_limit WHERE key LIKE 'magic-link:%'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM mail_quota")).toBe(0);
    expect(mail.spy).not.toHaveBeenCalled();
  });
});

describe("variantes de chemin et de corps du lien magique", () => {
  const post = (path: string, body: BodyInit, contentType: string | null = "application/json") => {
    const headers = new Headers({ origin: ORIGIN, "cf-connecting-ip": freshIp() });
    if (contentType !== null) headers.set("content-type", contentType);
    const request = new Request(`${ORIGIN}${path}`, { method: "POST", headers, body, redirect: "manual" });
    return createAuth(authEnv(), request).handler(request);
  };
  const variants = [
    "/api/auth/sign-in/magic-link/",
    "/api/auth/sign-in/magic-link//",
    "/api/auth//sign-in/magic-link",
    "/api/auth/sign-in//magic-link",
    "/api/auth/sign-in%2Fmagic-link",
    "/api/auth/sign-in/magic-link%2F",
    "/api/auth/sign-in/magic%2Dlink",
    "/api/auth/sign-in/Magic-Link",
    "/API/AUTH/sign-in/magic-link/",
    "/api/auth/sign-in/./magic-link",
    "/api/auth/x/../sign-in/magic-link",
  ];

  it("reconnaît le chemin quelles que soient barres finales, doubles barres, casse ou encodage", () => {
    for (const path of ["/api/auth/sign-in/magic-link", ...variants.map((v) => new URL(v, ORIGIN).pathname)]) {
      expect(isMagicLinkPath(path), path).toBe(true);
    }
    for (const path of ["/api/auth/sign-in/magic-link-x", "/api/auth/magic-link/verify", "/api/auth/sign-in/social"]) {
      expect(isMagicLinkPath(path), path).toBe(false);
    }
  });

  it.each(variants)("%s : 429 au 4e appel pour une même adresse, et compté dans le plafond", async (path) => {
    const mail = captureConsoleMail();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await post(path, JSON.stringify({ email: "variante@example.test" }))).status);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
    expect(await count("SELECT count AS n FROM mail_quota")).toBe(3);
    expect(mail.spy.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("une variante de chemin ne réinitialise pas la limite de l'adresse", async () => {
    captureConsoleMail();
    for (let i = 0; i < 3; i += 1) expect((await requestMagicLink("melange@example.test")).status).toBe(200);
    expect((await post("/api/auth/sign-in/magic-link/", JSON.stringify({ email: "melange@example.test" }))).status).toBe(429);
  });

  it.each([
    "application/x-www-form-urlencoded, application/json",
    "application/x-www-form-urlencoded; application/json",
    "text/plain; application/json",
    "application/jsonx",
    "multipart/form-data",
    null,
  ])("Content-Type %j : 415, rien n'est envoyé ni compté", async (contentType) => {
    const mail = captureConsoleMail();
    const res = await post("/api/auth/sign-in/magic-link", "email=form%40example.test", contentType);
    expect(res.status).toBe(415);
    expect(mail.spy).not.toHaveBeenCalled();
    expect(await count("SELECT COUNT(*) AS n FROM mail_quota")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM rate_limit WHERE key LIKE 'magic-link:%'")).toBe(0);
  });

  it("le formulaire déguisé en JSON par une liste de types ne passe pas, même avec un JSON valide", async () => {
    const mail = captureConsoleMail();
    const res = await post("/api/auth/sign-in/magic-link", JSON.stringify({ email: "liste@example.test" }), "application/x-www-form-urlencoded, application/json");
    expect(res.status).toBe(415);
    expect(mail.spy).not.toHaveBeenCalled();
  });

  it("application/json avec charset, quelle que soit la casse, est accepté", async () => {
    captureConsoleMail();
    for (const contentType of ["application/json; charset=utf-8", "Application/JSON"]) {
      expect((await post("/api/auth/sign-in/magic-link", JSON.stringify({ email: "charset@example.test" }), contentType)).status).toBe(200);
    }
  });

  it.each(["email=x%40example.test", "{", "[]", "null", "\"\"", ""])("corps JSON illisible %j : 400, rien n'est envoyé ni compté", async (body) => {
    const mail = captureConsoleMail();
    const res = await post("/api/auth/sign-in/magic-link", body);
    expect(res.status).toBe(400);
    expect(mail.spy).not.toHaveBeenCalled();
    expect(await count("SELECT COUNT(*) AS n FROM mail_quota")).toBe(0);
  });
});

describe("plafond global quotidien", () => {
  const seedDailyCount = (n: number) =>
    env.DB.prepare("INSERT INTO mail_quota (key, count) VALUES (?1, ?2)").bind(dailyMailQuotaKey(Date.now()), n).run();

  it("vaut 80 et bloque au-delà, quelles que soient l'adresse et l'IP", async () => {
    expect(MAGIC_LINK_DAILY_MAX).toBe(80);
    const mail = captureConsoleMail();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedDailyCount(MAGIC_LINK_DAILY_MAX - 2);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await requestMagicLink(`jour${i}@example.test`, { "cf-connecting-ip": `198.18.0.${i + 1}` })).status);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
    expect(mail.spy).toHaveBeenCalledTimes(2);
    const warnings = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(warnings).toMatch(/plafond quotidien/);
    expect(warnings).not.toMatch(/jour\d@example\.test/);
    expect(await count("SELECT count AS n FROM mail_quota")).toBe(MAGIC_LINK_DAILY_MAX);
  });

  it("le refus par plafond, par adresse et par IP sont indiscernables", async () => {
    captureConsoleMail();
    const snapshot = async (res: Response) => ({
      status: res.status,
      statusText: res.statusText,
      type: res.headers.get("content-type"),
      retry: res.headers.has("x-retry-after"),
      body: await res.text(),
    });

    const sameIp = { "cf-connecting-ip": "198.18.1.1" };
    let byIp: Response | undefined;
    for (let i = 0; i < 6; i += 1) byIp = await requestMagicLink(`ip${i}@example.test`, sameIp);

    let byEmail: Response | undefined;
    for (let i = 0; i < 4; i += 1) byEmail = await requestMagicLink("adresse@example.test");

    await env.DB.prepare("UPDATE mail_quota SET count = ?1").bind(MAGIC_LINK_DAILY_MAX).run();
    const byDay = await requestMagicLink("plafond@example.test");

    const reference = await snapshot(byIp!);
    expect(reference.status).toBe(429);
    expect(await snapshot(byEmail!)).toEqual(reference);
    expect(await snapshot(byDay)).toEqual(reference);
  });

  it("le compteur repart chaque jour UTC et les jours passés sont purgés", async () => {
    const day1 = Date.UTC(2026, 10, 1, 23, 59, 0);
    const day2 = Date.UTC(2026, 10, 2, 0, 0, 1);
    expect(await consumeDailyMailQuota(env.DB, 2, day1)).toBe(true);
    expect(await consumeDailyMailQuota(env.DB, 2, day1)).toBe(true);
    expect(await consumeDailyMailQuota(env.DB, 2, day1)).toBe(false);
    expect(await consumeDailyMailQuota(env.DB, 2, day2)).toBe(true);
    const keys = (await env.DB.prepare("SELECT key FROM mail_quota").all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual([dailyMailQuotaKey(day2)]);
  });

  it("20 demandes simultanées sur des adresses différentes ne dépassent pas le plafond", async () => {
    captureConsoleMail();
    await seedDailyCount(MAGIC_LINK_DAILY_MAX - 3);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => requestMagicLink(`course${i}@example.test`)));
    expect(results.filter((r) => r.status === 200).length).toBe(3);
    expect(await count("SELECT count AS n FROM mail_quota")).toBe(MAGIC_LINK_DAILY_MAX);
  });

  it("le compteur vit hors de rate_limit, que Better Auth purge après 60 s", async () => {
    captureConsoleMail();
    await requestMagicLink("hors-rate-limit@example.test");
    expect(await count("SELECT COUNT(*) AS n FROM rate_limit WHERE key LIKE '%global%'")).toBe(0);
    expect(await count("SELECT count AS n FROM mail_quota")).toBe(1);
  });
});

describe("transport d'e-mail", () => {
  const mail = magicLinkMail("a@example.test", "http://localhost:4321/lien", 5);

  it.each([undefined, "", "Console", "smtp", " console"])("MAIL_TRANSPORT=%j lève une erreur explicite", async (value) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(sendMail(authEnv({ MAIL_TRANSPORT: value }), mail)).rejects.toThrow(/MAIL_TRANSPORT/);
    expect(info).not.toHaveBeenCalled();
  });

  it.each(["https://quiz.example", "HTTPS://quiz.example"])("le transport console est refusé quand BETTER_AUTH_URL=%s", async (url) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(sendMail(authEnv({ MAIL_TRANSPORT: "console", BETTER_AUTH_URL: url }), mail)).rejects.toThrow(/https/);
    expect(info).not.toHaveBeenCalled();
  });

  it("en https, une demande de lien avec le transport console n'écrit le lien nulle part", async () => {
    const logs = [vi.spyOn(console, "info"), vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) =>
      s.mockImplementation(() => {}),
    );
    const request = new Request("https://quiz.example/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { origin: "https://quiz.example", "content-type": "application/json", "cf-connecting-ip": "198.18.2.1" },
      body: JSON.stringify({ email: "console-https@example.test" }),
    });
    const res = await createAuth(authEnv({ BETTER_AUTH_URL: "https://quiz.example", MAIL_TRANSPORT: "console" }), request).handler(request);
    expect(res.status).not.toBe(200);
    expect(logs.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n")).not.toMatch(/token=/);
  });

  it("le transport console reste actif en local (http://localhost)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendMail(authEnv({ MAIL_TRANSPORT: "console", BETTER_AUTH_URL: "http://localhost:4321" }), mail);
    expect(String(info.mock.calls[0]?.[0])).toContain("http://localhost:4321/lien");
  });

  it("une erreur Resend ne relaie que le statut HTTP et le code, jamais le message", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ message: "Adresse a@example.test refusée", name: "validation_error", statusCode: 422 }, { status: 422 }),
    );
    const error = await sendMail(authEnv({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_factice", MAIL_FROM: "Q <q@resend.dev>" }), mail).catch(
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/422/);
    expect(error!.message).toMatch(/validation_error/);
    expect(error!.message).not.toMatch(/refusée|a@example\.test/);
  });
});

describe("baseURL", () => {
  const ask = (requestOrigin: string, betterAuthUrl: string, ip: string) => {
    const request = new Request(`${requestOrigin}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { origin: requestOrigin, "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ email: `base-${ip}@example.test` }),
    });
    return createAuth(authEnv({ BETTER_AUTH_URL: betterAuthUrl }), request).handler(request);
  };

  it("en local, l'origine de la requête fait foi (port variable d'un worktree à l'autre)", async () => {
    const mail = captureConsoleMail();
    expect((await ask("http://localhost:5555", "http://localhost:4321", "198.18.3.1")).status).toBe(200);
    expect(new URL(mail.link()).origin).toBe("http://localhost:5555");
  });

  it("si BETTER_AUTH_URL n'est pas localhost, une requête localhost ne choisit pas l'hôte du lien", async () => {
    const mail = captureConsoleMail();
    const request = new Request("http://localhost:5555/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { origin: "http://quiz.example", "content-type": "application/json", "cf-connecting-ip": "198.18.3.2" },
      body: JSON.stringify({ email: "base-distante@example.test" }),
    });
    const res = await createAuth(authEnv({ BETTER_AUTH_URL: "http://quiz.example" }), request).handler(request);
    expect(res.status).toBe(200);
    expect(new URL(mail.link()).origin).toBe("http://quiz.example");
  });
});

describe("lien magique : jeton haché et nom borné", () => {
  it("le jeton n'est stocké qu'haché, et le lien reste valide une seule fois avant expiration", async () => {
    const mail = captureConsoleMail();
    await requestMagicLink("hache@example.test");
    const link = new URL(mail.link());
    const token = link.searchParams.get("token")!;
    const row = await env.DB.prepare("SELECT identifier, value FROM verification").first<{ identifier: string; value: string }>();
    expect(row!.identifier).not.toContain(token);
    expect(row!.value).not.toContain(token);
    const first = await authFetch(link.pathname + link.search);
    expect(sessionCookie(first)).toContain("session_token");
    expect(sessionCookie(await authFetch(link.pathname + link.search))).toBe("");
  });

  it("le nom fourni est borné à 80 caractères", async () => {
    const mail = captureConsoleMail();
    const res = await authFetch("/api/auth/sign-in/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: "nom-long@example.test", name: "N".repeat(500), callbackURL: "/tableau-de-bord" }),
    });
    expect(res.status).toBe(200);
    const link = new URL(mail.link());
    await authFetch(link.pathname + link.search);
    const row = await env.DB.prepare("SELECT name FROM user WHERE email = 'nom-long@example.test'").first<{ name: string }>();
    expect(row!.name).toBe("N".repeat(80));
  });

  it("un nom qui n'est pas du texte est ignoré", async () => {
    captureConsoleMail();
    const res = await authFetch("/api/auth/sign-in/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: "nom-objet@example.test", name: { $gt: "" } }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Google sans secret", () => {
  it("est désactivé, avec un avertissement qui ne contient aucune valeur de configuration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const overrides = { GOOGLE_CLIENT_ID: "client-id-visible", GOOGLE_CLIENT_SECRET: undefined };
    expect(availableLoginMethods(authEnv(overrides)).google).toBe(false);
    expect(availableLoginMethods(authEnv({ ...overrides, GOOGLE_CLIENT_SECRET: "  " })).google).toBe(false);
    const res = await authFetch("/api/auth/sign-in/social", { method: "POST", body: JSON.stringify({ provider: "google" }) }, overrides);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(warn).toHaveBeenCalled();
    const text = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(text).toMatch(/GOOGLE_CLIENT_SECRET/);
    expect(text).not.toContain("client-id-visible");
    expect(text).not.toContain(env.BETTER_AUTH_SECRET as string);
  });

  it("sans GOOGLE_CLIENT_ID, aucun avertissement", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createAuth(authEnv({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("session et liaison de comptes", () => {
  it("session de 7 jours, cache de cookie de 5 minutes", async () => {
    const { verify } = await signIn("duree@example.test");
    const row = await env.DB.prepare("SELECT expires_at FROM session").first<{ expires_at: number }>();
    const delta = row!.expires_at - Date.now();
    expect(delta).toBeGreaterThan(7 * 86_400_000 - 60_000);
    expect(delta).toBeLessThanOrEqual(7 * 86_400_000 + 1_000);
    const cache = verify.headers.getSetCookie().find((c) => c.includes("session_data"));
    expect(cache).toMatch(/Max-Age=300/i);
    const options = createAuth(authEnv()).options;
    expect(options.session).toMatchObject({ expiresIn: 7 * 86400, updateAge: 86400, cookieCache: { enabled: true, maxAge: 300 } });
  });

  it("une connexion Google sur l'adresse d'un compte lien magique rejoint ce compte", async () => {
    const google = { GOOGLE_CLIENT_ID: "client-factice", GOOGLE_CLIENT_SECRET: "secret-factice" };
    expect(createAuth(authEnv(google)).options.account?.accountLinking).toEqual({ enabled: true, trustedProviders: ["google"] });
    await signIn("lie@example.test");
    const start = await authFetch(
      "/api/auth/sign-in/social",
      { method: "POST", body: JSON.stringify({ provider: "google", callbackURL: "/tableau-de-bord" }) },
      google,
    );
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state");
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const idToken = `${b64({ alg: "none" })}.${b64({ sub: "google-lie", email: "lie@example.test", email_verified: true, name: "Lié" })}.x`;
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const target = input instanceof Request ? input.url : String(input);
      if (target.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "at", id_token: idToken, expires_in: 3600, token_type: "Bearer" });
      }
      return realFetch(input, init);
    });
    const cookies = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const callback = await authFetch(`/api/auth/callback/google?code=c&state=${state}`, { headers: { cookie: cookies } }, google);
    expect(callback.headers.get("location") ?? "").not.toMatch(/error/i);
    expect(await count("SELECT COUNT(*) AS n FROM user")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM account WHERE provider_id = 'google'")).toBe(1);
  });
});

describe("middleware : résolution de session ciblée", () => {
  it("ne résout la session que sur les pages qui en ont besoin", () => {
    for (const path of ["/", "/connexion", "/tableau-de-bord", "/quiz/x", "/partie/x/animer"]) expect(shouldResolveSession(path), path).toBe(true);
    for (const path of ["/j/ABC234", "/api/parties/ABC234/joueurs", "/connexion/x", "/dev/prototype", "/quizz"]) {
      expect(shouldResolveSession(path), path).toBe(false);
    }
  });

  it("aucune requête ne touche les tables session, user ou account sur /j/X, même avec un cookie valide", async () => {
    const { cookie } = await signIn("joueur@example.test");
    const proto = Object.getPrototypeOf(env.DB) as D1Database;
    const prepare = vi.spyOn(proto, "prepare");
    const batch = vi.spyOn(proto, "batch");
    // /j/X lit D1 pour l'encart titre et animateur (seule jointure autorisée : le nom de l'animateur), sans résoudre de session.
    await SELF.fetch(`${ORIGIN}/j/ABC234`, { redirect: "manual", headers: { cookie } });
    const touched = prepare.mock.calls.map((c) => String(c[0])).filter((sql) => /\b(session|user|account)\b/i.test(sql) && !APERCU_PARTIE.test(sql));
    expect(touched).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
    // Témoin : la même session interroge bien D1 sur une page qui la résout.
    prepare.mockClear();
    await SELF.fetch(`${ORIGIN}/`, { redirect: "manual", headers: { cookie } });
    expect(prepare.mock.calls.some((c) => /\b(session|user)\b/i.test(String(c[0])))).toBe(true);
    // Chemin qui ne lit rien : aucune requête D1 du tout.
    prepare.mockClear();
    await SELF.fetch(`${ORIGIN}/api/parties/ABC234/joueurs`, { redirect: "manual", headers: { cookie } });
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("safeReturnPath", () => {
  const origin = "https://quiz.example";
  const fallback = "/tableau-de-bord";

  it("accepte les chemins internes protégés, décodés une seule fois", () => {
    expect(safeReturnPath("/tableau-de-bord", origin)).toBe("/tableau-de-bord");
    expect(safeReturnPath("%2Fquiz%2Fabc%3Fx%3D1", origin)).toBe("/quiz/abc?x=1");
    expect(safeReturnPath("/partie/x/animer", origin)).toBe("/partie/x/animer");
    expect(safeReturnPath("/quiz", origin)).toBe("/quiz");
    expect(safeReturnPath("/quiz/x#fragment", origin)).toBe("/quiz/x");
    expect(safeReturnPath("/quiz/x", "https://quiz.example/chemin/ignore")).toBe("/quiz/x");
    for (const prefix of PROTECTED_PREFIXES) expect(safeReturnPath(prefix, origin)).toBe(prefix);
  });

  it.each([
    null,
    undefined,
    "",
    " /quiz/x",
    "quiz/x",
    "https://evil.example/quiz",
    "http://quiz.example.evil.example/quiz",
    "//evil.example/quiz",
    "///evil.example/quiz",
    "/\\evil.example/quiz",
    "\\\\evil.example/quiz",
    "/quiz\\..\\..\\evil",
    "%2F%2Fevil.example%2Fquiz",
    "%2F%5Cevil.example",
    "/%5Cevil.example",
    "%252F%252Fevil.example%252Fquiz",
    "/%2F%2Fevil.example",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)//quiz",
    "data:text/html,<script>alert(1)</script>",
    "/quiz/../../evil",
    "/quiz/%2e%2e/evil",
    "/quiz/%252e%252e/evil",
    "/quiz@evil.example",
    "/quizz",
    "/j/ABC234",
    "/connexion?retour=/quiz",
    "/\tevil.example",
    "/quiz/x%0d%0aSet-Cookie:a=b",
    "/quiz/x\nLocation: https://evil.example",
    "/quiz/%00",
    "%E0%A4%A",
    `/quiz/${"a".repeat(600)}`,
    `/quiz/${"%61".repeat(200)}`,
  ])("refuse %j et replie sur /tableau-de-bord", (retour) => {
    expect(safeReturnPath(retour, origin)).toBe(fallback);
  });

  it("le résultat n'est jamais interprétable comme une autre origine", () => {
    const tricky = ["/quiz/x?next=//evil.example", "/tableau-de-bord?u=https://evil.example"];
    for (const retour of tricky) {
      const result = safeReturnPath(retour, origin);
      expect(new URL(result, origin).origin).toBe(origin);
      expect(result.startsWith("/") && !result.startsWith("//")).toBe(true);
    }
  });
});
