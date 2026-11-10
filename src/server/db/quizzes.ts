import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { chunkRows, runBatch, type Db } from "./client";
import {
  MAX_OPTIONS_PER_QUESTION,
  MAX_QUESTIONS_PER_QUIZ,
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
const QUESTION_COLUMNS = 8;
const LIST_LIMIT = 100;
const SETTINGS_KEYS = ["title", "description", "category", "mode", "showCorrectAnswer", "shuffle"] as const satisfies readonly (keyof QuizSettings)[];

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

// Les plafonds bornent le nombre d'instructions par batch sous les 50 requêtes D1 d'une invocation.
// `kind` dit quel plafond est atteint, pour que l'appelant traduise sans analyser le message.
export class QuizLimitError extends Error {
  constructor(
    readonly kind: "questions" | "options",
    message: string,
  ) {
    super(message);
  }
}

function assertOptionLimit(input: QuestionInput): void {
  if (input.options.length > MAX_OPTIONS_PER_QUESTION) {
    throw new QuizLimitError("options", `Une question compte au plus ${MAX_OPTIONS_PER_QUESTION} options`);
  }
}

function assertQuizLimits(input: QuestionInput[]): void {
  if (input.length > MAX_QUESTIONS_PER_QUIZ) throw new QuizLimitError("questions", `Un quiz compte au plus ${MAX_QUESTIONS_PER_QUIZ} questions`);
  input.forEach(assertOptionLimit);
}

// Liste blanche : l'entrée vient d'une action, un id ou un ownerId glissé dedans ne doit jamais atteindre la base.
function pickSettings(input: Partial<QuizSettings>): Partial<QuizSettings> {
  const picked: Partial<Record<keyof QuizSettings, unknown>> = {};
  for (const key of SETTINGS_KEYS) if (input[key] !== undefined) picked[key] = input[key];
  return picked as Partial<QuizSettings>;
}

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

// 4 paramètres par option (id, position, label, is_correct), plus question_id dans la ligne et dans la garde.
const GUARDED_OPTION_PARAMS = 4;

function insertOptionsIfQuestionExists(db: Db, questionId: string, input: OptionInput[]) {
  const rows = input.map((o, position) => sql`(${crypto.randomUUID()}, ${position}, ${o.label}, ${o.isCorrect ? 1 : 0})`);
  return chunkRows(rows, GUARDED_OPTION_PARAMS, 2).map((chunk) =>
    db.insert(options).select(sql`SELECT column1, ${questionId}, column2, column3, column4 FROM (VALUES ${sql.join(chunk, sql`, `)})
      WHERE EXISTS (SELECT 1 FROM questions WHERE id = ${questionId})`),
  );
}

export async function createQuiz(
  db: Db,
  ownerId: string,
  init: Partial<QuizSettings> & { questions?: QuestionInput[] } = {},
): Promise<string> {
  const initialQuestions = init.questions ?? [];
  assertQuizLimits(initialQuestions);
  const quizId = crypto.randomUUID();
  const questionRows = initialQuestions.map((q, position) => ({
    id: crypto.randomUUID(),
    quizId,
    position,
    type: q.type,
    prompt: q.prompt,
    durationSec: q.durationSec,
    reference: q.reference ?? null,
    explanation: q.explanation ?? null,
  }));
  const allOptionRows = questionRows.flatMap((row, i) => optionRows(row.id, initialQuestions[i]!.options));
  // Insertions multi-lignes : 50 questions de 4 options tiennent en 1 + 5 + 10 instructions.
  await runBatch(db, [
    db.insert(quizzes).values({ title: "", ...pickSettings(init), id: quizId, ownerId }),
    ...chunkRows(questionRows, QUESTION_COLUMNS).map((rows) => db.insert(questions).values(rows)),
    ...chunkRows(allOptionRows, OPTION_COLUMNS).map((rows) => db.insert(options).values(rows)),
  ]);
  return quizId;
}

export async function updateQuizSettings(
  db: Db,
  ownerId: string,
  quizId: string,
  settings: Partial<QuizSettings>,
): Promise<void> {
  await assertQuizOwner(db, ownerId, quizId);
  const picked = pickSettings(settings);
  if (Object.keys(picked).length === 0) return;
  await db.update(quizzes).set(picked).where(ownedQuiz(ownerId, quizId));
}

export async function deleteQuiz(db: Db, ownerId: string, quizId: string): Promise<void> {
  await assertQuizOwner(db, ownerId, quizId);
  await db.delete(quizzes).where(ownedQuiz(ownerId, quizId));
}

export async function duplicateQuiz(db: Db, ownerId: string, quizId: string, title: string): Promise<string> {
  const source = await getQuizForEditor(db, ownerId, quizId);
  if (!source) throw new NotFoundError("Quiz introuvable");
  return createQuiz(db, ownerId, {
    ...pickSettings(source),
    title,
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
  assertOptionLimit(input);
  const quiz = await db
    .select({ questionCount: sql<number>`(SELECT COUNT(*) FROM questions WHERE questions.quiz_id = quizzes.id)` })
    .from(quizzes)
    .where(ownedQuiz(ownerId, quizId))
    .get();
  if (!quiz) throw new NotFoundError("Quiz introuvable");
  if (quiz.questionCount >= MAX_QUESTIONS_PER_QUIZ) throw new QuizLimitError("questions", `Un quiz compte au plus ${MAX_QUESTIONS_PER_QUIZ} questions`);
  const questionId = crypto.randomUUID();
  // Garde répétée dans l'insertion (plafond, propriété) : deux ajouts simultanés ne dépassent pas 50. Les options sont
  // conditionnées à l'existence de la question, sinon une question refusée ferait échouer le batch sur la clé étrangère.
  const [inserted] = await db.batch([
    db.insert(questions).select(sql`SELECT ${questionId}, ${quizId}, next_position, ${input.type}, ${input.prompt}, ${input.durationSec},
        ${input.reference ?? null}, ${input.explanation ?? null}
      FROM (SELECT COALESCE(MAX(position) + 1, 0) AS next_position, COUNT(*) AS question_count FROM questions WHERE quiz_id = ${quizId})
      WHERE question_count < ${MAX_QUESTIONS_PER_QUIZ}
        AND EXISTS (SELECT 1 FROM quizzes WHERE id = ${quizId} AND owner_id = ${ownerId})`),
    ...insertOptionsIfQuestionExists(db, questionId, input.options),
    db.update(quizzes).set({ updatedAt: new Date() }).where(ownedQuiz(ownerId, quizId)),
  ]);
  if (inserted.meta.changes === 0) {
    const stillOwned = await db.select({ id: quizzes.id }).from(quizzes).where(ownedQuiz(ownerId, quizId)).get();
    if (!stillOwned) throw new NotFoundError("Quiz introuvable");
    throw new QuizLimitError("questions", `Un quiz compte au plus ${MAX_QUESTIONS_PER_QUIZ} questions`);
  }
  return questionId;
}

export async function updateQuestion(db: Db, ownerId: string, questionId: string, input: QuestionInput): Promise<void> {
  assertOptionLimit(input);
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

// 3 paramètres liés par question (CASE id WHEN ? THEN ? et la liste IN), plus quiz_id.
const REORDER_ROW_PARAMS = 3;

export async function reorderQuestions(db: Db, ownerId: string, quizId: string, orderedIds: string[]): Promise<void> {
  await assertQuizOwner(db, ownerId, quizId);
  const current = await db.select({ id: questions.id }).from(questions).where(eq(questions.quizId, quizId));
  const known = new Set(current.map((q) => q.id));
  const requested = new Set(orderedIds);
  // Ensembles égaux et sans doublon : sinon deux questions partageraient une position et une autre garderait l'ancienne.
  if (requested.size !== orderedIds.length || requested.size !== known.size || !orderedIds.every((qid) => known.has(qid))) {
    throw new Error("Ordre des questions invalide");
  }
  const entries = orderedIds.map((qid, position) => ({ qid, position }));
  await runBatch(
    db,
    chunkRows(entries, REORDER_ROW_PARAMS, 1).map((chunk) => {
      const cases: SQL[] = chunk.map(({ qid, position }) => sql`WHEN ${qid} THEN ${position}`);
      return db
        .update(questions)
        .set({ position: sql`CASE ${questions.id} ${sql.join(cases, sql` `)} END` })
        .where(and(eq(questions.quizId, quizId), inArray(questions.id, chunk.map((e) => e.qid))));
    }),
  );
}

export async function listQuizzes(db: Db, ownerId: string) {
  return db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      updatedAt: quizzes.updatedAt,
      questionCount: sql<number>`(SELECT COUNT(*) FROM questions WHERE questions.quiz_id = quizzes.id)`,
      // Même règle que isQuestionComplete (src/shared/quiz-schema.ts) : énoncé non vide, au moins 2 options toutes
      // libellées, au moins 1 bonne réponse, exactement 1 hors choix multiple, exactement 2 options pour vrai/faux.
      // Sans option, aucun groupe n'existe : la question compte comme incomplète.
      incompleteCount: sql<number>`(SELECT COUNT(*) FROM questions q WHERE q.quiz_id = quizzes.id AND NOT EXISTS (
        SELECT 1 FROM options o WHERE o.question_id = q.id
        GROUP BY o.question_id
        HAVING TRIM(q.prompt) <> ''
          AND COUNT(*) >= 2
          AND SUM(TRIM(o.label) = '') = 0
          AND SUM(o.is_correct) >= 1
          AND (q.type = 'multiple' OR SUM(o.is_correct) = 1)
          AND (q.type <> 'true_false' OR COUNT(*) = 2)
      ))`,
    })
    .from(quizzes)
    .where(eq(quizzes.ownerId, ownerId))
    .orderBy(desc(quizzes.updatedAt))
    .limit(LIST_LIMIT);
}

// Vue éditeur : contient is_correct, réservée au propriétaire.
export async function getQuizForEditor(db: Db, ownerId: string, quizId: string) {
  const quiz = await db.query.quizzes.findFirst({
    where: ownedQuiz(ownerId, quizId),
    with: { questions: { orderBy: asc(questions.position), with: { options: { orderBy: asc(options.position) } } } },
  });
  return quiz ?? null;
}

// SERVEUR UNIQUEMENT : l'instantané porte la correction (is_correct). Appelants autorisés : l'action de lancement de
// partie (partie.lancer, QZ-002-07) et l'initialisation du Durable Object GameSession par cette même action. Jamais
// d'îlot, de page publique ni de réponse destinée aux joueurs. Filtré par propriétaire : null pour un quiz tiers.
export async function loadQuizSnapshot(db: Db, ownerId: string, quizId: string): Promise<QuizSnapshot | null> {
  // Sous-requêtes sur quiz_id : nombre de paramètres constant quel que soit le nombre de questions, en une requête.
  const ownedQuizId = db.select({ id: quizzes.id }).from(quizzes).where(ownedQuiz(ownerId, quizId));
  const ownedQuestionIds = db.select({ id: questions.id }).from(questions).where(inArray(questions.quizId, ownedQuizId));
  const [quizRows, questionRows, optionRows] = await db.batch([
    db.select().from(quizzes).where(ownedQuiz(ownerId, quizId)).limit(1),
    db.select().from(questions).where(inArray(questions.quizId, ownedQuizId)).orderBy(asc(questions.position)),
    db.select().from(options).where(inArray(options.questionId, ownedQuestionIds)).orderBy(asc(options.position)),
  ]);
  const quiz = quizRows[0];
  if (!quiz) return null;
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
