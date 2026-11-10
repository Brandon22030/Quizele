import { z } from "zod";
import { gameModeSchema, questionKindSchema, type GameMode, type QuestionKind } from "../../shared/protocol";
import type { QuizSnapshot } from "../db/quizzes";
import { MAX_OPTIONS_PER_QUESTION, MAX_QUESTIONS_PER_QUIZ } from "../db/schema";

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

// Ce que le Durable Object reçoit à l'initialisation : l'instantané du quiz, correction comprise.
export interface QuizDefinition {
  title: string;
  showCorrectAnswer: boolean;
  mode?: GameMode;
  shuffle?: boolean;
  // Graine du mélange, tirée au hasard si absente. La fournir rend l'ordre reproductible.
  seed?: string;
  questions: QuizQuestion[];
}

const MIN_OPTIONS = 2;
const MAX_DURATION_SEC = 600;

const optionSchema = z.object({ id: z.string().min(1).max(64), label: z.string().min(1), isCorrect: z.boolean() });

const questionSchema = z
  .object({
    id: z.string().min(1).max(64),
    // Seuls les trois types connus : tout autre type est rejeté ici, à l'initialisation, pas au milieu d'une partie.
    kind: questionKindSchema,
    prompt: z.string().min(1),
    durationSec: z.number().int().min(1).max(MAX_DURATION_SEC),
    reference: z.string().optional(),
    explanation: z.string().optional(),
    options: z.array(optionSchema).min(MIN_OPTIONS).max(MAX_OPTIONS_PER_QUESTION),
  })
  .superRefine((question, ctx) => {
    const correct = question.options.filter((option) => option.isCorrect).length;
    if (correct === 0 || (question.kind !== "multiple" && correct !== 1)) {
      ctx.addIssue({ code: "custom", message: "Nombre de bonnes réponses incohérent avec le type de question" });
    }
    if (new Set(question.options.map((option) => option.id)).size !== question.options.length) {
      ctx.addIssue({ code: "custom", message: "Identifiants d'options en double" });
    }
  });

export const quizDefinitionSchema = z
  .object({
    title: z.string(),
    showCorrectAnswer: z.boolean(),
    mode: gameModeSchema.optional(),
    shuffle: z.boolean().optional(),
    seed: z.string().min(1).optional(),
    questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS_PER_QUIZ),
  })
  .refine((quiz) => new Set(quiz.questions.map((q) => q.id)).size === quiz.questions.length, { message: "Identifiants de questions en double" });

// Lève une erreur au premier défaut : un quiz invalide ne doit jamais atteindre le stockage du Durable Object.
export function parseQuizDefinition(input: unknown): QuizDefinition {
  const parsed = quizDefinitionSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Instantané de quiz invalide : ${parsed.error.issues[0]?.message ?? "format inattendu"}`);
  return parsed.data as QuizDefinition;
}

export function toQuizDefinition(snapshot: QuizSnapshot): QuizDefinition {
  return {
    title: snapshot.title,
    showCorrectAnswer: snapshot.showCorrectAnswer,
    mode: snapshot.mode,
    shuffle: snapshot.shuffle,
    questions: snapshot.questions.map((question) => ({
      id: question.id,
      kind: question.type,
      prompt: question.prompt,
      durationSec: question.durationSec,
      ...(question.reference ? { reference: question.reference } : {}),
      ...(question.explanation ? { explanation: question.explanation } : {}),
      options: question.options,
    })),
  };
}
