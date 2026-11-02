import type { Brouillon } from "./modele";

// Sous-ensemble de Storage : permet d'injecter un faux dans les tests et de survivre à un navigateur sans localStorage.
export interface Stockage {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

const PREFIXE = "quizdeszeles:editeur:";
const VERSION = 1;
export const CLE_NOUVEAU = "nouveau";

export function cleStockage(quizId: string | null): string {
  return `${PREFIXE}${quizId ?? CLE_NOUVEAU}`;
}

export function stockageNavigateur(): Stockage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Accès refusé (navigation privée stricte, cookies bloqués) : l'éditeur fonctionne, sans reprise après rechargement.
    return null;
  }
}

export function ecrireBrouillon(stockage: Stockage | null, b: Brouillon): void {
  try {
    stockage?.setItem(cleStockage(b.quizId), JSON.stringify({ v: VERSION, brouillon: b }));
  } catch {
    // Quota plein : la file garde tout en mémoire, seule la reprise après rechargement est perdue.
  }
}

export function effacerBrouillon(stockage: Stockage | null, quizId: string | null): void {
  try {
    stockage?.removeItem(cleStockage(quizId));
  } catch {
    // Rien à nettoyer si le stockage est inaccessible.
  }
}

function estBrouillon(valeur: unknown): valeur is Brouillon {
  if (typeof valeur !== "object" || valeur === null) return false;
  const b = valeur as Partial<Brouillon>;
  return (
    typeof b.title === "string" &&
    Array.isArray(b.questions) &&
    typeof b.sale === "object" &&
    b.sale !== null &&
    Array.isArray(b.sale.questions) &&
    Array.isArray(b.sale.supprimees)
  );
}

// Un brouillon sans marque n'a rien à reprendre : le serveur est la référence.
export function lireBrouillon(stockage: Stockage | null, quizId: string | null): Brouillon | null {
  try {
    const brut = stockage?.getItem(cleStockage(quizId));
    if (!brut) return null;
    const lu: unknown = JSON.parse(brut);
    if (typeof lu !== "object" || lu === null || (lu as { v?: number }).v !== VERSION) return null;
    const brouillon = (lu as { brouillon?: unknown }).brouillon;
    return estBrouillon(brouillon) ? brouillon : null;
  } catch {
    return null;
  }
}
