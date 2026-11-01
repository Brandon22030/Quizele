import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import * as z from "zod";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { sendMail, type MailEnv } from "../mail/send-mail";
import { magicLinkMail } from "../mail/templates";
import { consumeDailyMailQuota, consumeEmailQuota, hashEmailKey } from "./email-quota";

export interface AuthEnv extends MailEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Absente tant que QZ-002-18 ne l'a pas ajoutée à wrangler.jsonc : lien magique actif par défaut.
  MAGIC_LINK_ENABLED?: string;
}

export const MAGIC_LINK_EXPIRES_IN_SECONDS = 5 * 60;
const MAGIC_LINK_PATH = "/api/auth/sign-in/magic-link";
const IP_RATE_LIMIT = { window: 60, max: 5 };
// Fenêtre de 60 s au plus : Better Auth purge les lignes de rate_limit plus vieilles que sa plus longue fenêtre.
// Par adresse : bloque le bombardement d'une boîte e-mail depuis plusieurs IP (Better Auth limite déjà par IP).
const MAGIC_LINK_EMAIL_QUOTA = { window: 60, max: 3 };
// L'offre gratuite de Resend s'arrête à 100 e-mails par jour : la marge garde de quoi dépanner à la main.
export const MAGIC_LINK_DAILY_MAX = 80;
const MAX_NAME_LENGTH = 80;
const emailSchema = z.email().max(254);

export const isMagicLinkEnabled = (env: Pick<AuthEnv, "MAGIC_LINK_ENABLED">) =>
  (env.MAGIC_LINK_ENABLED ?? "true").trim().toLowerCase() !== "false";

export const isGoogleEnabled = (env: Pick<AuthEnv, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">) =>
  Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());

// Utilisé par la page de connexion : aucune méthode active = état d'erreur explicite.
export const availableLoginMethods = (env: AuthEnv) => ({ google: isGoogleEnabled(env), magicLink: isMagicLinkEnabled(env) });

const isLocalhost = (url: URL) => url.hostname === "localhost" || url.hostname === "127.0.0.1";

// Les ports locaux changent d'un worktree à l'autre : l'origine de la requête ne fait foi que si la var elle-même
// désigne localhost. En ligne, un en-tête Host forgé ne doit jamais choisir l'hôte des liens envoyés.
function resolveBaseUrl(env: AuthEnv, request?: Request): string {
  if (!env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL manquant.");
  if (request && isLocalhost(new URL(env.BETTER_AUTH_URL))) {
    const url = new URL(request.url);
    if (isLocalhost(url)) return url.origin;
  }
  return env.BETTER_AUTH_URL;
}

// Réponse identique au refus par IP de Better Auth : un refus par adresse ou par plafond global
// ne doit pas se distinguer, sinon il renseigne sur l'existence d'une cible ou sur le volume d'envois.
function tooManyRequests(): Response {
  return new Response(JSON.stringify({ message: "Too many requests. Please try again later." }), {
    status: 429,
    statusText: "Too Many Requests",
    headers: { "Content-Type": "application/json", "X-Retry-After": String(IP_RATE_LIMIT.window) },
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request
    .clone()
    .json()
    // Corps illisible : Better Auth le refusera lui-même, rien n'est compté.
    .catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

// onRequest passe après la limite par IP de Better Auth mais avant sa validation zod : on valide donc soi-même
// avant d'écrire quoi que ce soit, puis on compte par adresse, puis globalement.
function magicLinkQuotaPlugin(env: AuthEnv): BetterAuthPlugin {
  return {
    id: "magic-link-quota",
    async onRequest(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== MAGIC_LINK_PATH) return;
      const body = await readJsonBody(request);
      if (!body) return;
      const email = emailSchema.safeParse(body.email);
      if (!email.success) {
        return { response: Response.json({ code: "INVALID_EMAIL", message: "Adresse e-mail invalide." }, { status: 400 }) };
      }
      const emailKey = `magic-link:${await hashEmailKey(email.data)}`;
      if (!(await consumeEmailQuota(env.DB, emailKey, MAGIC_LINK_EMAIL_QUOTA))) return { response: tooManyRequests() };
      if (!(await consumeDailyMailQuota(env.DB, MAGIC_LINK_DAILY_MAX))) return { response: tooManyRequests() };
      if (body.name === undefined) return;
      // Le nom saisi ici deviendrait le nom affiché du compte créé : il est borné, ou retiré s'il n'est pas du texte.
      const { name, ...rest } = body;
      const nextBody = typeof name === "string" ? { ...rest, name: name.slice(0, MAX_NAME_LENGTH) } : rest;
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      return { request: new Request(request.url, { method: request.method, headers, body: JSON.stringify(nextBody) }) };
    },
  };
}

// Instance créée par requête : le binding D1 n'existe que dans le contexte de la requête, et aucun état n'est gardé
// entre deux invocations (sessions en D1 uniquement, pas de KV). Pas de plugin e-mail + mot de passe : aucun
// hachage (scrypt), le poste CPU le plus lourd de Better Auth sur l'offre gratuite.
export function createAuth(env: AuthEnv, request?: Request) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET manquant.");
  const db = getDb(env.DB);
  const baseURL = resolveBaseUrl(env, request);
  if (env.GOOGLE_CLIENT_ID?.trim() && !env.GOOGLE_CLIENT_SECRET?.trim()) {
    console.warn("[auth] GOOGLE_CLIENT_ID défini sans GOOGLE_CLIENT_SECRET : connexion Google désactivée.");
  }

  return betterAuth({
    appName: "Quizdeszeles",
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    socialProviders: isGoogleEnabled(env)
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET!.trim() } }
      : {},
    session: { expiresIn: 7 * 86400, updateAge: 86400, cookieCache: { enabled: true, maxAge: 300 } },
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    plugins: isMagicLinkEnabled(env)
      ? [
          magicLinkQuotaPlugin(env),
          magicLink({
            expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
            storeToken: "hashed",
            rateLimit: IP_RATE_LIMIT,
            sendMagicLink: ({ email, url }) =>
              sendMail(env, magicLinkMail(email, url, MAGIC_LINK_EXPIRES_IN_SECONDS / 60)),
          }),
        ]
      : [],
    rateLimit: { enabled: true, storage: "database" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
  });
}

export type Auth = ReturnType<typeof createAuth>;
