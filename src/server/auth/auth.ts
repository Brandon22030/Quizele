import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { sendMail, type MailEnv } from "../mail/send-mail";
import { magicLinkMail } from "../mail/templates";
import { consumeEmailQuota } from "./email-quota";

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
const MAGIC_LINK_PATH = "/sign-in/magic-link";
// Fenêtre de 60 s au plus : Better Auth purge les lignes de rate_limit plus vieilles que sa plus longue fenêtre.
// Par adresse : bloque le bombardement d'une boîte e-mail depuis plusieurs IP (Better Auth limite déjà par IP).
const MAGIC_LINK_EMAIL_QUOTA = { window: 60, max: 3 };

export const isMagicLinkEnabled = (env: Pick<AuthEnv, "MAGIC_LINK_ENABLED">) =>
  (env.MAGIC_LINK_ENABLED ?? "true").trim().toLowerCase() !== "false";

export const isGoogleEnabled = (env: Pick<AuthEnv, "GOOGLE_CLIENT_ID">) => Boolean(env.GOOGLE_CLIENT_ID?.trim());

// Utilisé par la page de connexion : aucune méthode active = état d'erreur explicite.
export const availableLoginMethods = (env: AuthEnv) => ({ google: isGoogleEnabled(env), magicLink: isMagicLinkEnabled(env) });

// Les ports locaux changent d'un worktree à l'autre : en local l'origine de la requête fait foi, ailleurs la var.
function resolveBaseUrl(env: AuthEnv, request?: Request): string {
  if (request) {
    const url = new URL(request.url);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return url.origin;
  }
  if (!env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL manquant.");
  return env.BETTER_AUTH_URL;
}

// Instance créée par requête : le binding D1 n'existe que dans le contexte de la requête, et aucun état n'est gardé
// entre deux invocations (sessions en D1 uniquement, pas de KV). Pas de plugin e-mail + mot de passe : aucun
// hachage (scrypt), le poste CPU le plus lourd de Better Auth sur l'offre gratuite.
export function createAuth(env: AuthEnv, request?: Request) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET manquant.");
  const db = getDb(env.DB);
  const baseURL = resolveBaseUrl(env, request);
  const googleClientId = isGoogleEnabled(env) ? env.GOOGLE_CLIENT_ID?.trim() : undefined;

  return betterAuth({
    appName: "Quizdeszeles",
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    socialProviders: googleClientId
      ? { google: { clientId: googleClientId, clientSecret: env.GOOGLE_CLIENT_SECRET ?? "" } }
      : {},
    plugins: isMagicLinkEnabled(env)
      ? [
          magicLink({
            expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
            rateLimit: { window: 60, max: 5 },
            sendMagicLink: ({ email, url }) =>
              sendMail(env, magicLinkMail(email, url, MAGIC_LINK_EXPIRES_IN_SECONDS / 60)),
          }),
        ]
      : [],
    rateLimit: { enabled: true, storage: "database" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== MAGIC_LINK_PATH) return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string") return;
        const allowed = await consumeEmailQuota(env.DB, `magic-link:${email.trim().toLowerCase()}`, MAGIC_LINK_EMAIL_QUOTA);
        if (!allowed) throw new APIError("TOO_MANY_REQUESTS", { message: "Trop de demandes pour cette adresse. Réessayez dans quelques minutes." });
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
