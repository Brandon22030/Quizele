import { z } from "zod";
import { trouverModele } from "../../contenu/modeles";
import { MAX_OPTIONS, MAX_QUESTIONS, PARTIR_DE_ZERO, TITLE_MAX, quizActionInputs, quizStatus, statusFromCounts, type QuizStatus } from "../../shared/quiz-schema";
import type { Db } from "../db/client";
import {
  NotFoundError,
  QuizLimitError,
  addQuestion,
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  duplicateQuiz,
  getQuizForEditor,
  listQuizzes,
  reorderQuestions,
  updateQuestion,
  updateQuizSettings,
} from "../db/quizzes";

export type QuizFailureCode = "UNAUTHORIZED" | "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR";

// Erreur déjà formulée pour l'utilisateur : src/actions/quiz.ts la convertit en ActionError (module virtuel d'Astro,
// indisponible dans les tests, d'où cette indirection).
export class QuizFailure extends Error {
  constructor(
    readonly code: QuizFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export interface QuizUser {
  id: string;
}

export function requireUser(user: QuizUser | null | undefined): QuizUser {
  if (!user) throw new QuizFailure("UNAUTHORIZED", "Connecte-toi pour continuer.");
  return user;
}

const REORDER_ERROR = "Ordre des questions invalide";

// Traduit les erreurs de la couche D1 en messages affichables ; le reste devient une erreur générique, sans détail interne.
export function toQuizFailure(error: unknown): QuizFailure {
  if (error instanceof QuizFailure) return error;
  if (error instanceof QuizLimitError) {
    const message =
      error.kind === "options"
        ? `Une question ne peut pas dépasser ${MAX_OPTIONS} options.`
        : `Un quiz ne peut pas dépasser ${MAX_QUESTIONS} questions.`;
    return new QuizFailure("BAD_REQUEST", message);
  }
  if (error instanceof NotFoundError) {
    const what = error.message.includes("Question") ? "Cette question est introuvable." : "Ce quiz est introuvable.";
    return new QuizFailure("NOT_FOUND", what);
  }
  if (error instanceof Error && error.message === REORDER_ERROR) {
    return new QuizFailure("BAD_REQUEST", "L'ordre des questions n'est plus à jour. Recharge la page.");
  }
  return new QuizFailure("INTERNAL_SERVER_ERROR", "Une erreur est survenue. Réessaie dans un instant.");
}

// Seule trace d'une erreur inattendue, masquée à l'utilisateur. L'entrée n'est pas journalisée : elle porte le contenu du
// quiz, bonnes réponses comprises.
export function actionFailure(action: string, error: unknown): QuizFailure {
  const failure = toQuizFailure(error);
  if (failure.code === "INTERNAL_SERVER_ERROR") {
    console.error(`quiz.${action}`, error instanceof Error ? error.message : String(error));
  }
  return failure;
}

type Input<K extends keyof typeof quizActionInputs> = z.output<(typeof quizActionInputs)[K]>;

// Le propriétaire est toujours l'utilisateur de la session : aucun ownerId n'est lu dans l'entrée.
export async function creer(db: Db, user: QuizUser | null, input: Input<"creer">): Promise<{ quizId: string }> {
  const { id } = requireUser(user);
  const modeleId = input.modele ?? PARTIR_DE_ZERO;
  if (modeleId === PARTIR_DE_ZERO) return { quizId: await createQuiz(db, id, { title: input.title }) };
  const modele = trouverModele(modeleId);
  if (!modele) throw new QuizFailure("BAD_REQUEST", "Ce modèle n'existe pas.");
  const quizId = await createQuiz(db, id, {
    title: input.title ?? modele.title,
    description: modele.description,
    category: modele.category,
    mode: modele.mode,
    questions: modele.questions,
  });
  return { quizId };
}

const COPY_SUFFIX = " (copie)";

export async function dupliquer(db: Db, user: QuizUser | null, input: Input<"dupliquer">): Promise<{ quizId: string }> {
  const { id } = requireUser(user);
  const source = await getQuizForEditor(db, id, input.quizId);
  if (!source) throw new NotFoundError("Quiz introuvable");
  // Coupe par points de code, comme les CHECK de la base : un emoji n'est jamais tranché en deux.
  const title = Array.from(source.title).slice(0, TITLE_MAX - COPY_SUFFIX.length).join("") + COPY_SUFFIX;
  return { quizId: await duplicateQuiz(db, id, input.quizId, title) };
}

export async function supprimer(db: Db, user: QuizUser | null, input: Input<"supprimer">): Promise<Record<string, never>> {
  await deleteQuiz(db, requireUser(user).id, input.quizId);
  return {};
}

export async function majReglages(db: Db, user: QuizUser | null, input: Input<"majReglages">): Promise<Record<string, never>> {
  const { quizId, ...settings } = input;
  await updateQuizSettings(db, requireUser(user).id, quizId, settings);
  return {};
}

export async function ajouterQuestion(db: Db, user: QuizUser | null, input: Input<"ajouterQuestion">): Promise<{ questionId: string }> {
  return { questionId: await addQuestion(db, requireUser(user).id, input.quizId, input.question) };
}

export async function majQuestion(db: Db, user: QuizUser | null, input: Input<"majQuestion">): Promise<Record<string, never>> {
  await updateQuestion(db, requireUser(user).id, input.questionId, input.question);
  return {};
}

export async function supprimerQuestion(db: Db, user: QuizUser | null, input: Input<"supprimerQuestion">): Promise<Record<string, never>> {
  await deleteQuestion(db, requireUser(user).id, input.questionId);
  return {};
}

export async function reordonner(db: Db, user: QuizUser | null, input: Input<"reordonner">): Promise<Record<string, never>> {
  await reorderQuestions(db, requireUser(user).id, input.quizId, input.questionIds);
  return {};
}

export interface QuizSummary {
  id: string;
  title: string;
  updatedAt: Date;
  questionCount: number;
  status: Pick<QuizStatus, "ready" | "label" | "incompleteCount">;
}

export async function lister(db: Db, user: QuizUser | null): Promise<{ quizzes: QuizSummary[] }> {
  const rows = await listQuizzes(db, requireUser(user).id);
  return {
    quizzes: rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
      questionCount: row.questionCount,
      status: { ...statusFromCounts(row.questionCount, row.incompleteCount), incompleteCount: row.incompleteCount },
    })),
  };
}

// Vue éditeur : porte is_correct, réservée au propriétaire (getQuizForEditor filtre sur owner_id). ownerId n'en sort pas.
export async function charger(db: Db, user: QuizUser | null, input: Input<"charger">) {
  const quiz = await getQuizForEditor(db, requireUser(user).id, input.quizId);
  if (!quiz) throw new NotFoundError("Quiz introuvable");
  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      category: quiz.category,
      mode: quiz.mode,
      showCorrectAnswer: quiz.showCorrectAnswer,
      shuffle: quiz.shuffle,
      updatedAt: quiz.updatedAt,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        position: q.position,
        type: q.type,
        prompt: q.prompt,
        durationSec: q.durationSec,
        reference: q.reference,
        explanation: q.explanation,
        options: q.options.map((o) => ({ id: o.id, position: o.position, label: o.label, isCorrect: o.isCorrect })),
      })),
    },
    status: quizStatus(quiz.questions),
  };
}
