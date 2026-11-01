import type { QuestionKind } from "../../shared/protocol";

// Choix unique et vrai/faux : exactement une option, la bonne. Choix multiple : ensemble exact.
export function isAnswerCorrect(kind: QuestionKind, selected: string[], correct: string[]): boolean {
  const chosen = new Set(selected);
  if (chosen.size !== selected.length) return false;
  if (kind !== "multiple" && chosen.size !== 1) return false;
  return chosen.size === correct.length && correct.every((id) => chosen.has(id));
}

export function rankEntries<T extends { score: number; totalMs: number; pseudo: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.pseudo.localeCompare(b.pseudo, "fr"));
}
