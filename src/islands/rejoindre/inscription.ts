import { CODE_LENGTH } from "../../components/jeu/code-input";
import { localNow } from "../../shared/clock";
import { PSEUDO_MAX_LENGTH, joinResponseSchema, pseudoSchema } from "../../shared/protocol";

export type JoinFailure = "invalid_pseudo" | "pseudo_taken" | "game_full" | "game_not_found" | "game_finished" | "network" | "unknown";

export const JOIN_MESSAGES: Record<JoinFailure, string> = {
  invalid_pseudo: `Ce pseudo n'est pas valide. Choisis-en un de 1 à ${PSEUDO_MAX_LENGTH} caractères.`,
  pseudo_taken: "Ce pseudo est déjà pris dans cette partie. Choisis-en un autre.",
  game_full: "Cette partie est pleine. Demande à l'animateur de faire de la place.",
  game_not_found: "Aucune partie ne correspond à ce code. Vérifie-le auprès de l'animateur.",
  game_finished: "Cette partie est terminée. Demande un nouveau code à l'animateur.",
  network: "Connexion impossible. Vérifie ton réseau puis réessaie.",
  unknown: "Un problème est survenu. Réessaie dans un instant.",
};

export interface StoredToken {
  playerId: string;
  token: string;
}

export type JoinResult = ({ ok: true } & StoredToken) | { ok: false; error: JoinFailure };

// Clé propre à la partie : un joueur peut avoir des jetons de plusieurs parties sans qu'ils se mélangent.
export function tokenKey(code: string): string {
  return `quizdeszeles:jeton:${code.toUpperCase()}`;
}

export function playPath(code: string): string {
  return `/j/${code.toUpperCase()}/jouer`;
}

export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LENGTH;
}

export function validatePseudo(raw: string): string | null {
  const parsed = pseudoSchema.safeParse(raw);
  return parsed.success ? null : JOIN_MESSAGES.invalid_pseudo;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Le serveur juge la signature ; le client ne lit que l'échéance `e` (en ms) de la charge utile pour ne pas
// garder un jeton mort. Une charge illisible n'est pas écartée ici : /jouer la fera refuser par le serveur.
function isExpired(token: string, now: number): boolean {
  try {
    const payload = token.split(".")[0] ?? "";
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    const expiresAt = typeof claims === "object" && claims !== null && "e" in claims ? (claims as { e: unknown }).e : null;
    return typeof expiresAt === "number" && expiresAt <= now;
  } catch {
    return false;
  }
}

export function readToken(store: Store, code: string, now: number = localNow()): StoredToken | null {
  try {
    const parsed: unknown = JSON.parse(store.getItem(tokenKey(code)) ?? "null");
    const found = joinResponseSchema.safeParse(parsed);
    if (!found.success) return null;
    if (isExpired(found.data.token, now)) {
      store.removeItem(tokenKey(code));
      return null;
    }
    return found.data;
  } catch {
    // Stockage inaccessible (navigation privée stricte) ou valeur corrompue : comme s'il n'y avait pas de jeton.
    return null;
  }
}

export function writeToken(store: Store, code: string, value: StoredToken): boolean {
  try {
    store.setItem(tokenKey(code), JSON.stringify({ playerId: value.playerId, token: value.token }));
    return true;
  } catch {
    return false;
  }
}

const KNOWN: readonly JoinFailure[] = ["invalid_pseudo", "pseudo_taken", "game_full", "game_not_found", "game_finished"];

export async function joinGame(code: string, pseudo: string, doFetch: typeof fetch = fetch): Promise<JoinResult> {
  let response: Response;
  try {
    response = await doFetch(`/api/parties/${encodeURIComponent(code.toUpperCase())}/joueurs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pseudo }),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 201) {
    const found = joinResponseSchema.safeParse(body);
    return found.success ? { ok: true, ...found.data } : { ok: false, error: "unknown" };
  }
  const error = typeof body === "object" && body !== null && "error" in body ? (body as { error: unknown }).error : null;
  const known = KNOWN.find((k) => k === error);
  return { ok: false, error: known ?? "unknown" };
}
