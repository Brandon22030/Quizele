import { z } from "zod";
import { PLAYER_TOKEN_TTL_MS, WS_SUBPROTOCOL, roleSchema, type Role } from "../../shared/protocol";

const MIN_SECRET_BYTES = 32;

const claimsSchema = z.object({
  c: z.string(),
  s: z.string().min(1),
  r: roleSchema,
  p: z.string().optional(),
  e: z.number(),
});

export interface TokenClaims {
  code: string;
  // Identifiant unique de la partie : le code court est réutilisable, le sid ne l'est jamais.
  sid: string;
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
  // Un secret court rendrait les jetons forgeables : on échoue bruyamment plutôt que de signer mal.
  if (encoder.encode(secret).length < MIN_SECRET_BYTES) {
    throw new Error(`PLAYER_TOKEN_SECRET doit faire au moins ${MIN_SECRET_BYTES} octets`);
  }
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signToken(
  secret: string,
  claims: { code: string; sid: string; role: Role; playerId?: string },
  now: number = Date.now(),
  ttlMs: number = PLAYER_TOKEN_TTL_MS,
): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ c: claims.code, s: claims.sid, r: claims.role, p: claims.playerId, e: now + ttlMs })),
  );
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

// Renvoie null pour tout jeton invalide : signature, expiration, code de partie ou sid différent.
export async function verifyToken(
  secret: string,
  token: string,
  expected: { code: string; sid?: string },
  now: number = Date.now(),
): Promise<TokenClaims | null> {
  // Vérifié avant l'analyse du jeton : une configuration invalide doit se voir même sur un jeton malformé.
  const key = await importKey(secret, "verify");
  const [payload, signature, ...reste] = token.split(".");
  if (!payload || !signature || reste.length > 0) return null;
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;
  // crypto.subtle.verify compare en temps constant.
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(payload));
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
  const { c, s, r, p, e } = parsed.data;
  if (c !== expected.code || e <= now) return null;
  if (expected.sid !== undefined && s !== expected.sid) return null;
  if (r === "player" && !p) return null;
  return { code: c, sid: s, role: r, playerId: p, expiresAt: e };
}

// Le navigateur ne peut pas poser d'en-tête sur un WebSocket : le jeton accompagne le sous-protocole.
export function tokenFromRequest(request: Request): string {
  const offered = (request.headers.get("Sec-WebSocket-Protocol") ?? "").split(",").map((item) => item.trim());
  return offered.find((item) => item !== "" && item !== WS_SUBPROTOCOL) ?? "";
}
