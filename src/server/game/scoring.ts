import type { QuestionKind } from "../../shared/protocol";

// Choix unique et vrai/faux : exactement une option, la bonne. Choix multiple : ensemble exact.
export function isAnswerCorrect(kind: QuestionKind, selected: string[], correct: string[]): boolean {
  const chosen = new Set(selected);
  if (chosen.size !== selected.length) return false;
  if (kind !== "multiple" && chosen.size !== 1) return false;
  return chosen.size === correct.length && correct.every((id) => chosen.has(id));
}

// Un seul Collator pour tout le module : localeCompare en recréerait un à chaque comparaison.
const pseudoCollator = new Intl.Collator("fr");

// Le rang est la position (à partir de 1) : strictement unique, comme l'exige l'index (session_id, rank) de D1.
export function rankEntries<T extends { score: number; totalMs: number; pseudo: string }>(entries: T[]): (T & { rank: number })[] {
  return [...entries]
    .sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || pseudoCollator.compare(a.pseudo, b.pseudo))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
