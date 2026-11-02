import { localNow } from "../../shared/clock";
import { joinResponseSchema, type JoinResponse } from "../../shared/protocol";

// Clé partagée avec la page « rejoindre » (QZ-002-10), qui écrit ce jeton après l'inscription. Le code est en
// majuscules : le même joueur ne doit pas avoir deux entrées selon la casse de l'URL.
export const cleJeton = (code: string): string => `quizdeszeles:jeton:${code.toUpperCase()}`;

export type JetonJoueur = JoinResponse;

type Stockage = Pick<Storage, "getItem" | "removeItem">;

function stockageNavigateur(): Stockage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accès refusé (navigation privée stricte, cookies bloqués) : équivaut à l'absence de jeton.
    return null;
  }
}

// Expiration `e` (ms) lue dans la charge utile, avant la signature. Illisible : le serveur tranchera.
export function jetonExpire(token: string, maintenant: number = localNow()): boolean {
  try {
    const charge = token.split(".")[0] ?? "";
    const json = atob(charge.replace(/-/g, "+").replace(/_/g, "/"));
    const { e } = JSON.parse(json) as { e?: unknown };
    return typeof e === "number" && e <= maintenant;
  } catch {
    return false;
  }
}

// Un jeton expiré vaut absence de jeton : inutile d'ouvrir une connexion que le serveur refuserait.
export function lireJeton(code: string, stockage: Stockage | null = stockageNavigateur(), maintenant: number = localNow()): JetonJoueur | null {
  try {
    const brut = stockage?.getItem(cleJeton(code));
    if (!brut) return null;
    const lu = joinResponseSchema.safeParse(JSON.parse(brut));
    return lu.success && !jetonExpire(lu.data.token, maintenant) ? lu.data : null;
  } catch {
    return null;
  }
}

export function effacerJeton(code: string, stockage: Stockage | null = stockageNavigateur()): void {
  try {
    stockage?.removeItem(cleJeton(code));
  } catch {
    // Rien à effacer si le stockage est inaccessible.
  }
}

export const urlRejoindre = (code: string): string => `/j/${code.toUpperCase()}`;

/** Sans jeton exploitable, le joueur repart de la page de saisie : la clé périmée est supprimée pour éviter une boucle. */
export function retourRejoindre(code: string): void {
  effacerJeton(code);
  location.replace(urlRejoindre(code));
}
