import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { chunkRows, runBatch, type Db } from "./client";
import {
  options,
  questions,
  quizzes,
  type GameMode,
  type QuestionDuration,
  type QuestionType,
} from "./schema";

export interface OptionInput {
  label: string;
  isCorrect: boolean;
}

export interface QuestionInput {
  type: QuestionType;
  prompt: string;
  durationSec: QuestionDuration;
  reference?: string | null;
  explanation?: string | null;
  options: OptionInput[];
}

export interface QuizSettings {
  title: string;
  description: string | null;
  category: string | null;
  mode: GameMode;
  showCorrectAnswer: boolean;
  shuffle: boolean;
}

export interface QuizSnapshot {
  quizId: string;
  ownerId: string;
  title: string;
  mode: GameMode;
  showCorrectAnswer: boolean;
  shuffle: boolean;
  questions: {
    id: string;
    type: QuestionType;
    prompt: string;
    durationSec: QuestionDuration;
    reference: string | null;
    explanation: string | null;
    options: { id: string; label: string; isCorrect: boolean }[];
  }[];
}

const OPTION_COLUMNS = 5;

const ownedQuiz = (ownerId: string, quizId: string) => and(eq(quizzes.id, quizId), eq(quizzes.ownerId, ownerId));

async function assertQuizOwner(db: Db, ownerId: string, quizId: string): Promise<void> {
  const row = await db.select({ id: quizzes.id }).from(quizzes).where(ownedQuiz(ownerId, quizId)).get();
  if (!row) throw new NotFoundError("Quiz introuvable");
}

async function assertQuestionOwner(db: Db, ownerId: string, questionId: string): Promise<string> {
  const row = await db
    .select({ quizId: questions.quizId })
    .from(questions)
    .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
    .where(and(eq(questions.id, questionId), eq(quizzes.ownerId, ownerId)))
    .get();
  if (!row) throw new NotFoundError("Question introuvable");
  return row.quizId;
}

// Même erreur pour « n'existe pas » et « appartient à un autre » : on ne révèle pas l'existence d'un quiz tiers.
export class NotFoundError extends Error {}

function optionRows(questionId: string, input: OptionInput[]) {
  return input.map((o, position) => ({
    id: crypto.randomUUID(),
    questionId,
    position,
    label: o.label,
    isCorrect: o.isCorrect,
  }));
}

function insertOptions(db: Db, questionId: string, input: OptionInput[]) {
  return chunkRows(optionRows(questionId, input), OPTION_COLUMNS).map((rows) => db.insert(options).values(rows));
}

export async function createQuiz(
  db: Db,
  ownerId: string,
  init: { title?: string; questions?: QuestionInput[] } & Partial<Omit<QuizSettings, "title">> = {},
): Promise<string> {
  const quizId = crypto.randomUUID();
  const { title, questions: initialQuestions = [], ...settings } = init;
  const statements: BatchItem<"sqlite">[] = [db.insert(quizzes).values({ id: quizId, ownerId, title: title ?? "", ...settings })];
  initialQuestions.forEach((q, position) => {
    const questionId = crypto.randomUUID();
    statements.push(
      db.insert(questions).values({
        id: questionId,
        quizId,
        position,
        type: q.type,
        prompt: q.prompt,
        durationSec: q.durationSec,
        reference: q.reference ?? null,
        explanation: q.explanation ?? null,
      }),
      ...insertOptions(db, questionId, q.options),
    );
  });
  await runBatch(db, statements);
  return quizId;
}

export async function updateQuizSettings(
  db: Db,
  ownerId: string,
  quizId: string,
  settings: Partial<QuizSettings>,
): Promise<void> {
  await assertQuizOwner(db, ownerId, quizId);
  await db.update(quizzes).set(settings).where(ownedQuiz(ownerId, quizId));
}

export async function deleteQuiz(db: Db, ownerId: string, quizId: string): Promise<void> {
  await assertQuizOwner(db, ownerId, quizId);
  await db.delete(quizzes).where(ownedQuiz(ownerId, quizId));
}

export async function duplicateQuiz(db: Db, ownerId: string, quizId: string, title: string): Promise<string> {
  const source = await getQuizForEditor(db, ownerId, quizId);
  if (!source) throw new NotFoundError("Quiz introuvable");
  return createQuiz(db, ownerId, {
    title,
    description: source.description,
    category: source.category,
    mode: source.mode,
    showCorrectAnswer: source.showCorrectAnswer,
    shuffle: source.shuffle,
    questions: source.questions.map((q) => ({
      type: q.type,
      prompt: q.prompt,
      durationSec: q.durationSec,
      reference: q.reference,
      explanation: q.explanation,
      options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
    })),
  });
}

export async function addQuestion(db: Db, ownerId: string, quizId: string, input: QuestionInput): Promise<string> {
  await assertQuizOwner(db, ownerId, quizId);
  const questionId = crypto.randomUUID();
  await runBatch(db, [
    db.insert(questions).values({
      id: questionId,
      quizId,
      position: sql`(SELECT COALESCE(MAX(position) + 1, 0) FROM questions WHERE quiz_id = ${quizId})`,
      type: input.type,
      prompt: input.prompt,
      durationSec: input.durationSec,
      reference: input.reference ?? null,
      explanation: input.explanation ?? null,
    }),
    ...insertOptions(db, questionId, input.options),
    db.update(quizzes).set({ updatedAt: new Date() }).where(eq(quizzes.id, quizId)),
  ]);
  return questionId;
}

export async function updateQuestion(db: Db, ownerId: string, questionId: string, input: QuestionInput): Promise<void> {
  const quizId = await assertQuestionOwner(db, ownerId, questionId);
  await runBatch(db, [
    db
      .update(questions)
      .set({
        type: input.type,
        prompt: input.prompt,
        durationSec: input.durationSec,
        reference: input.reference ?? null,
        explanation: input.explanation ?? null,
      })
      .where(eq(questions.id, questionId)),
    db.delete(options).where(eq(options.questionId, questionId)),
    ...insertOptions(db, questionId, input.options),
    db.update(quizzes).set({ updatedAt: new Date() }).where(eq(quizzes.id, quizId)),
  ]);
}

export async function deleteQuestion(db: Db, ownerId: string, questionId: string): Promise<void> {
  const quizId = await assertQuestionOwner(db, ownerId, questionId);
  await runBatch(db, [
    db.delete(questions).where(eq(questions.id, questionId)),
    db.update(quizzes).set({ updatedAt: new Date() }).where(eq(quizzes.id, quizId)),
  ]);
}

export async function reorderQuestions(db: Db, ownerId: string, quizId: string, orderedIds: string[]): Promise<void> {
  await assertQuizOwner(db, ownerId, quizId);
  const current = await db.select({ id: questions.id }).from(questions).where(eq(questions.quizId, quizId));
  const known = new Set(current.map((q) => q.id));
  if (orderedIds.length !== known.size || !orderedIds.every((qid) => known.has(qid))) {
    throw new Error("Ordre des questions invalide");
  }
  await runBatch(
    db,
    orderedIds.map((qid, position) =>
      db
        .update(questions)
        .set({ position })
        .where(and(eq(questions.id, qid), eq(questions.quizId, quizId))),
    ),
  );
}

export async function listQuizzes(db: Db, ownerId: string) {
  return db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      updatedAt: quizzes.updatedAt,
      questionCount: sql<number>`(SELECT COUNT(*) FROM questions WHERE questions.quiz_id = quizzes.id)`,
      // Question complète : énoncé non vide, au moins 2 options libellées, au moins une bonne réponse.
      incompleteCount: sql<number>`(SELECT COUNT(*) FROM questions q WHERE q.quiz_id = quizzes.id AND (
        TRIM(q.prompt) = ''
        OR (SELECT COUNT(*) FROM options o WHERE o.question_id = q.id AND TRIM(o.label) <> '') < 2
        OR (SELECT COUNT(*) FROM options o WHERE o.question_id = q.id AND o.is_correct = 1) < 1
      ))`,
    })
    .from(quizzes)
    .where(eq(quizzes.ownerId, ownerId))
    .orderBy(desc(quizzes.updatedAt));
}

// Vue éditeur : contient is_correct, réservée au propriétaire.
export async function getQuizForEditor(db: Db, ownerId: string, quizId: string) {
  const quiz = await db.query.quizzes.findFirst({
    where: ownedQuiz(ownerId, quizId),
    with: { questions: { orderBy: asc(questions.position), with: { options: { orderBy: asc(options.position) } } } },
  });
  return quiz ?? null;
}

// Usage serveur uniquement (lancement de partie, initialisation du Durable Object) : porte la correction.
export async function loadQuizSnapshot(db: Db, quizId: string): Promise<QuizSnapshot | null> {
  const quiz = await db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
  if (!quiz) return null;
  const questionRows = await db.select().from(questions).where(eq(questions.quizId, quizId)).orderBy(asc(questions.position));
  const optionRows = questionRows.length
    ? await db
        .select()
        .from(options)
        .where(
          inArray(
            options.questionId,
            questionRows.map((q) => q.id),
          ),
        )
        .orderBy(asc(options.position))
    : [];
  return {
    quizId: quiz.id,
    ownerId: quiz.ownerId,
    title: quiz.title,
    mode: quiz.mode,
    showCorrectAnswer: quiz.showCorrectAnswer,
    shuffle: quiz.shuffle,
    questions: questionRows.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      durationSec: q.durationSec,
      reference: q.reference,
      explanation: q.explanation,
      options: optionRows
        .filter((o) => o.questionId === q.id)
        .map((o) => ({ id: o.id, label: o.label, isCorrect: o.isCorrect })),
    })),
  };
}
