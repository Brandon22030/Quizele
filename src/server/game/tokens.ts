import { z } from "zod";
import { PLAYER_TOKEN_TTL_MS, roleSchema, type Role } from "../../shared/protocol";

const claimsSchema = z.object({
  c: z.string(),
  r: roleSchema,
  p: z.string().optional(),
  e: z.number(),
});

export interface TokenClaims {
  code: string;
  role: Role;
  playerId?: string;
  expiresAt: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(texte: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(texte.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function importKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signToken(
  secret: string,
  claims: { code: string; role: Role; playerId?: string },
  now: number = Date.now(),
  ttlMs: number = PLAYER_TOKEN_TTL_MS,
): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ c: claims.code, r: claims.role, p: claims.playerId, e: now + ttlMs })),
  );
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

// Renvoie null pour tout jeton invalide : signature, expiration, ou code de partie différent.
export async function verifyToken(
  secret: string,
  token: string,
  expectedCode: string,
  now: number = Date.now(),
): Promise<TokenClaims | null> {
  const [payload, signature, ...reste] = token.split(".");
  if (!payload || !signature || reste.length > 0) return null;
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;
  // crypto.subtle.verify compare en temps constant.
  const valid = await crypto.subtle.verify("HMAC", await importKey(secret, "verify"), signatureBytes, encoder.encode(payload));
  if (!valid) return null;
  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  let parsed: ReturnType<typeof claimsSchema.safeParse>;
  try {
    parsed = claimsSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const { c, r, p, e } = parsed.data;
  if (c !== expectedCode || e <= now) return null;
  if (r === "player" && !p) return null;
  return { code: c, role: r, playerId: p, expiresAt: e };
}
