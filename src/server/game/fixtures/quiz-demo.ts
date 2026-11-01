import type { QuestionKind } from "../../../shared/protocol";

export interface QuizOption {
  id: string;
  label: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  durationSec: 10 | 20 | 30 | 60;
  reference?: string;
  explanation?: string;
  options: QuizOption[];
}

export interface QuizDefinition {
  title: string;
  showCorrectAnswer: boolean;
  questions: QuizQuestion[];
}

// Quiz de démonstration du prototype : QZ-002-07 le remplace par le quiz lu dans D1.
export const quizDemo: QuizDefinition = {
  title: "Quiz de démonstration",
  showCorrectAnswer: true,
  questions: [
    {
      id: "q1",
      kind: "single",
      prompt: "Combien de jours la création a-t-elle duré ?",
      durationSec: 20,
      reference: "Genèse 1",
      explanation: "Six jours de travail, puis un jour de repos.",
      options: [
        { id: "q1a", label: "Trois", isCorrect: false },
        { id: "q1b", label: "Six", isCorrect: true },
        { id: "q1c", label: "Sept", isCorrect: false },
        { id: "q1d", label: "Quarante", isCorrect: false },
      ],
    },
    {
      id: "q2",
      kind: "multiple",
      prompt: "Lesquels sont des fruits ?",
      durationSec: 20,
      explanation: "La tomate est botaniquement un fruit.",
      options: [
        { id: "q2a", label: "Mangue", isCorrect: true },
        { id: "q2b", label: "Carotte", isCorrect: false },
        { id: "q2c", label: "Tomate", isCorrect: true },
        { id: "q2d", label: "Oignon", isCorrect: false },
      ],
    },
    {
      id: "q3",
      kind: "true_false",
      prompt: "Un quiz en direct se joue seul.",
      durationSec: 10,
      options: [
        { id: "q3a", label: "Vrai", isCorrect: false },
        { id: "q3b", label: "Faux", isCorrect: true },
      ],
    },
  ],
};
