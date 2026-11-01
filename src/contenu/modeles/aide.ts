import type { QuestionData } from "../../shared/quiz-schema";

// Constructeurs des trois types de question : durée par défaut courte pour vrai/faux, plus longue pour le multiple.
export function choixUnique(prompt: string, bonne: string, autres: string[], reference: string, explanation?: string): QuestionData {
  return {
    type: "single",
    prompt,
    durationSec: 20,
    reference,
    explanation: explanation ?? null,
    options: [{ label: bonne, isCorrect: true }, ...autres.map((label) => ({ label, isCorrect: false }))],
  };
}

export function choixMultiple(prompt: string, bonnes: string[], autres: string[], reference: string, explanation?: string): QuestionData {
  return {
    type: "multiple",
    prompt,
    durationSec: 30,
    reference,
    explanation: explanation ?? null,
    options: [...bonnes.map((label) => ({ label, isCorrect: true })), ...autres.map((label) => ({ label, isCorrect: false }))],
  };
}

export function vraiFaux(prompt: string, vrai: boolean, reference: string, explanation?: string): QuestionData {
  return {
    type: "true_false",
    prompt,
    durationSec: 10,
    reference,
    explanation: explanation ?? null,
    options: [
      { label: "Vrai", isCorrect: vrai },
      { label: "Faux", isCorrect: !vrai },
    ],
  };
}
