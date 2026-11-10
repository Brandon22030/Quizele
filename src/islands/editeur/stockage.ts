import { localNow } from "../../shared/clock";
import type { Brouillon } from "./modele";

// Sous-ensemble de Storage : permet d'injecter un faux dans les tests et de survivre à un navigateur sans localStorage.
// `length` et `key` servent à retrouver les brouillons de nouveaux quiz, rangés sous une clé par onglet.
export interface Stockage {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

const PREFIXE = "quizdeszeles:editeur:";
const VERSION = 1;
export const CLE_NOUVEAU = "nouveau";

// Un nouveau quiz n'a pas encore d'identifiant : chaque onglet range son brouillon sous sa propre session, sinon deux onglets
// sur /quiz/nouveau s'écraseraient l'un l'autre.
export function cleStockage(quizId: string | null, session?: string | null): string {
  if (quizId !== null) return `${PREFIXE}${quizId}`;
  return `${PREFIXE}${CLE_NOUVEAU}:${session ?? ""}`;
}

export function stockageNavigateur(): Stockage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Accès refusé (navigation privée stricte, cookies bloqués) : l'éditeur fonctionne, sans reprise après rechargement.
    return null;
  }
}

export function ecrireBrouillon(stockage: Stockage | null, b: Brouillon, session: string | null = null): void {
  try {
    stockage?.setItem(cleStockage(b.quizId, session), JSON.stringify({ v: VERSION, brouillon: b, t: localNow() }));
  } catch {
    // Quota plein : la file garde tout en mémoire, seule la reprise après rechargement est perdue.
  }
}

export function effacerBrouillon(stockage: Stockage | null, quizId: string | null, session: string | null = null): void {
  try {
    stockage?.removeItem(cleStockage(quizId, session));
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

export interface EntreeBrouillon {
  brouillon: Brouillon;
  session: string | null;
  t: number;
}

export interface EntreeNouveau extends EntreeBrouillon {
  session: string;
}

function lireEntree(stockage: Stockage | null, cle: string, session: string | null): EntreeBrouillon | null {
  try {
    const brut = stockage?.getItem(cle);
    if (!brut) return null;
    const lu: unknown = JSON.parse(brut);
    if (typeof lu !== "object" || lu === null || (lu as { v?: number }).v !== VERSION) return null;
    const { brouillon, t } = lu as { brouillon?: unknown; t?: unknown };
    if (!estBrouillon(brouillon)) return null;
    return { brouillon, session, t: typeof t === "number" ? t : 0 };
  } catch {
    return null;
  }
}

// Un brouillon sans marque n'a rien à reprendre : le serveur est la référence.
export function lireBrouillon(stockage: Stockage | null, quizId: string | null, session?: string | null): Brouillon | null {
  return lireEntree(stockage, cleStockage(quizId, session), session ?? null)?.brouillon ?? null;
}

// Brouillons de nouveaux quiz, du plus récent au plus ancien : un par onglet qui a commencé un quiz sans le créer.
export function brouillonsNouveaux(stockage: Stockage | null): EntreeNouveau[] {
  const prefixe = cleStockage(null);
  const sessions: string[] = [];
  try {
    const n = stockage?.length ?? 0;
    for (let i = 0; i < n; i += 1) {
      const cle = stockage?.key?.(i);
      if (cle && cle.startsWith(prefixe) && cle.length > prefixe.length) sessions.push(cle.slice(prefixe.length));
    }
  } catch {
    return [];
  }
  return sessions
    .map((session) => lireEntree(stockage, cleStockage(null, session), session))
    .filter((e): e is EntreeNouveau => e !== null && e.session !== null && e.brouillon.quizId === null)
    .sort((a, b) => b.t - a.t);
}
