import type { GameMode, QuestionType, QuizStatus } from "../../shared/quiz-schema";
import { libelleQuestions, urlEditeur } from "../tableau-de-bord/logique";

export interface QuestionLancement {
  id: string;
  type: QuestionType;
  prompt: string;
  durationSec: number;
  explanation: string | null;
  options: { label: string; isCorrect: boolean }[];
}

export interface QuizLancement {
  id: string;
  title: string;
  mode: GameMode;
  showCorrectAnswer: boolean;
  questions: QuestionLancement[];
}

export type EtatLancement =
  | { etat: "chargement" }
  | { etat: "erreur"; message: string; introuvable: boolean }
  | { etat: "pret"; quiz: QuizLancement; status: QuizStatus };

export interface LienVerification {
  href: string;
  libelle: string;
}

export interface Verification {
  id: "questions" | "correction" | "explications";
  etat: "ok" | "alerte";
  texte: string;
  liens: LienVerification[];
}

// Numéro lu par l'éditeur (?question=n, à partir de 1) : la position serveur commence à 0.
export const urlQuestion = (quizId: string, position: number): string => `${urlEditeur(quizId)}?question=${position + 1}`;

export const urlReglages = (quizId: string): string => `${urlEditeur(quizId)}/reglages`;

export function libelleQuestionsCompletes(n: number): string {
  return n === 1 ? "1 question complète" : `${n} questions complètes`;
}

export function libelleAcompleter(n: number): string {
  return n === 1 ? "1 question à compléter" : `${n} questions à compléter`;
}

export function libelleSansExplication(n: number): string {
  return n === 1 ? "1 question sans explication" : `${n} questions sans explication`;
}

// Estimation : temps de réponse de chaque question plus une dizaine de secondes de correction entre deux questions.
const PAUSE_CORRECTION_SEC = 10;

export function dureeEstimeeMinutes(questions: readonly Pick<QuestionLancement, "durationSec">[]): number {
  const secondes = questions.reduce((total, q) => total + q.durationSec + PAUSE_CORRECTION_SEC, 0);
  return Math.max(1, Math.round(secondes / 60));
}

export function resumeQuiz(quiz: QuizLancement): string {
  if (quiz.questions.length === 0) return libelleQuestions(0);
  return `${libelleQuestions(quiz.questions.length)} - environ ${dureeEstimeeMinutes(quiz.questions)} min`;
}

// Chaque point de contrôle renvoie vers l'endroit où le corriger : le lancement ne laisse jamais dans une impasse.
export function verifications(quiz: QuizLancement, status: QuizStatus): Verification[] {
  const total = quiz.questions.length;
  const liste: Verification[] = [];

  if (total === 0) {
    liste.push({ id: "questions", etat: "alerte", texte: "Aucune question", liens: [{ href: urlEditeur(quiz.id), libelle: "Ajouter une question" }] });
  } else if (status.incompleteCount > 0) {
    liste.push({
      id: "questions",
      etat: "alerte",
      texte: libelleAcompleter(status.incompleteCount),
      liens: status.incomplete.map(({ position }) => ({ href: urlQuestion(quiz.id, position), libelle: `Aller à la question ${position + 1}` })),
    });
  } else {
    liste.push({ id: "questions", etat: "ok", texte: libelleQuestionsCompletes(total), liens: [] });
  }

  liste.push({
    id: "correction",
    etat: "ok",
    texte: quiz.showCorrectAnswer ? "Bonne réponse montrée après chaque question" : "Bonne réponse non montrée pendant la partie",
    liens: [],
  });

  const sansExplication = quiz.showCorrectAnswer ? quiz.questions.flatMap((q, position) => (q.explanation?.trim() ? [] : [position])) : [];
  const premiere = sansExplication[0];
  if (premiere !== undefined) {
    liste.push({
      id: "explications",
      etat: "alerte",
      texte: libelleSansExplication(sansExplication.length),
      liens: [{ href: urlQuestion(quiz.id, premiere), libelle: "Compléter" }],
    });
  }
  return liste;
}

export const peutLancer = (status: QuizStatus): boolean => status.ready;

export const MODES: Record<GameMode, { titre: string; description: string }> = {
  together: { titre: "Tout le monde ensemble", description: "Tu pilotes depuis ce téléphone." },
  own_pace: { titre: "Chacun à son rythme", description: "Chaque joueur avance seul, tu termines la partie quand tu veux." },
};

export const MESSAGE_RESEAU = "Connexion impossible. Vérifie ta connexion puis réessaie.";
