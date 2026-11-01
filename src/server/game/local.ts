import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { createQuiz, loadQuizSnapshot } from "../db/quizzes";
import { user } from "../db/schema";
import { launchGame, type LaunchResult } from "./launch";
import type { QuizDefinition } from "./quiz";

export const LOCAL_USER = { id: "local-dev", name: "Animateur local", email: "local-dev@example.invalid" };

export interface LocalGame extends LaunchResult {
  quizId: string;
  // Bonnes et mauvaises réponses de chaque question, pour les scripts qui jouent à la place des joueurs.
  quiz: { id: string; good: string[]; bad: string[] }[];
}

// Outillage local uniquement (page de démonstration, script de charge) : crée un quiz dans D1 à partir d'une définition
// puis passe par le vrai chemin de lancement. N'est jamais appelé par une action.
export async function createLocalGame(env: Env, definition: QuizDefinition): Promise<LocalGame> {
  const db = getDb(env.DB);
  if (!(await db.select({ id: user.id }).from(user).where(eq(user.id, LOCAL_USER.id)).get())) {
    await db.insert(user).values(LOCAL_USER);
  }
  const quizId = await createQuiz(db, LOCAL_USER.id, {
    title: definition.title,
    mode: definition.mode ?? "together",
    showCorrectAnswer: definition.showCorrectAnswer,
    shuffle: definition.shuffle ?? false,
    questions: definition.questions.map((question) => ({
      type: question.kind,
      prompt: question.prompt,
      durationSec: question.durationSec,
      reference: question.reference,
      explanation: question.explanation,
      options: question.options.map(({ label, isCorrect }) => ({ label, isCorrect })),
    })),
  });
  const launched = await launchGame(env, LOCAL_USER, quizId, { unlimited: true });
  const snapshot = await loadQuizSnapshot(db, LOCAL_USER.id, quizId);
  return {
    ...launched,
    quizId,
    quiz: (snapshot?.questions ?? []).map((question) => ({
      id: question.id,
      good: question.options.filter((o) => o.isCorrect).map((o) => o.id),
      bad: question.options.filter((o) => !o.isCorrect).map((o) => o.id),
    })),
  };
}
