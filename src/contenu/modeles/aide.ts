import type { QuestionData } from "../../shared/quiz-schema";

// La bonne réponse est désignée par son rang (à partir de 0) : on la place à la main, jamais toujours en tête, sinon
// les joueurs apprennent la position au lieu du contenu.
function options(reponses: string[], bonnes: number[]): QuestionData["options"] {
  for (const index of bonnes) {
    if (!Number.isInteger(index) || index < 0 || index >= reponses.length) {
      throw new Error(`Modèle mal formé : aucune réponse au rang ${index}.`);
    }
  }
  return reponses.map((label, index) => ({ label, isCorrect: bonnes.includes(index) }));
}

// Constructeurs des trois types de question : durée par défaut courte pour vrai/faux, plus longue pour le multiple.
export function choixUnique(prompt: string, reponses: string[], bonne: number, reference: string, explanation?: string): QuestionData {
  return { type: "single", prompt, durationSec: 20, reference, explanation: explanation ?? null, options: options(reponses, [bonne]) };
}

export function choixMultiple(prompt: string, reponses: string[], bonnes: number[], reference: string, explanation?: string): QuestionData {
  return { type: "multiple", prompt, durationSec: 30, reference, explanation: explanation ?? null, options: options(reponses, bonnes) };
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
