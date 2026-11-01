import { z } from "zod";

// Isomorphe : l'éditeur valide côté navigateur avec les mêmes règles que les Actions. Les bornes dupliquent celles de
// src/server/db/schema.ts (les CHECK de la base), qu'un test de worker garde alignées.
export const QUESTION_TYPES = ["single", "multiple", "true_false"] as const;
export const QUESTION_DURATIONS = [10, 20, 30, 60] as const;
export const GAME_MODES = ["together", "own_pace"] as const;

export const MAX_QUESTIONS = 50;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const TITLE_MAX = 120;
export const PROMPT_MAX = 300;
export const OPTION_LABEL_MAX = 200;
export const LONG_TEXT_MAX = 500;
// La base ne borne pas la catégorie : 60 est une limite d'affichage choisie pour les cartes du tableau de bord.
export const CATEGORY_MAX = 60;

const tooLong = (what: string, max: number) => `${what} ne peut pas dépasser ${max} caractères.`;

// Un champ vide (après trim) devient null : la base distingue « absent » de « vide » pour les champs optionnels.
const optionalText = (what: string, max: number) =>
  z
    .string({ error: `${what} doit être un texte.` })
    .trim()
    .max(max, tooLong(what, max))
    .nullish()
    .transform((value) => (value ? value : null));

export const titleSchema = z
  .string({ error: "Le titre est obligatoire." })
  .trim()
  .min(1, "Le titre est obligatoire.")
  .max(TITLE_MAX, tooLong("Le titre", TITLE_MAX));

export const questionTypeSchema = z.enum(QUESTION_TYPES, { error: "Ce type de question n'existe pas." });
export const gameModeSchema = z.enum(GAME_MODES, { error: "Ce mode de jeu n'existe pas." });

export const durationSchema = z
  .number({ error: "La durée doit être 10, 20, 30 ou 60 secondes." })
  .refine((value): value is (typeof QUESTION_DURATIONS)[number] => (QUESTION_DURATIONS as readonly number[]).includes(value), {
    error: "La durée doit être 10, 20, 30 ou 60 secondes.",
  });

// Les libellés vides sont permis : un brouillon se sauvegarde au fil de la saisie, quizStatus signale ce qui reste à remplir.
export const optionSchema = z.object({
  label: z
    .string({ error: "Le libellé de la réponse doit être un texte." })
    .trim()
    .max(OPTION_LABEL_MAX, tooLong("Une réponse", OPTION_LABEL_MAX)),
  isCorrect: z.boolean({ error: "Indique si la réponse est juste." }),
});

export const questionSchema = z
  .object({
    type: questionTypeSchema,
    prompt: z
      .string({ error: "L'énoncé doit être un texte." })
      .trim()
      .max(PROMPT_MAX, tooLong("L'énoncé", PROMPT_MAX)),
    durationSec: durationSchema,
    reference: optionalText("La référence", LONG_TEXT_MAX),
    explanation: optionalText("L'explication", LONG_TEXT_MAX),
    options: z
      .array(optionSchema, { error: "Les réponses sont invalides." })
      .min(MIN_OPTIONS, `Une question a au moins ${MIN_OPTIONS} réponses.`)
      .max(MAX_OPTIONS, `Une question ne peut pas dépasser ${MAX_OPTIONS} réponses.`),
  })
  .superRefine((question, ctx) => {
    const correct = question.options.filter((o) => o.isCorrect).length;
    if (question.type === "true_false" && question.options.length !== 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Une question vrai ou faux a exactement 2 réponses." });
    }
    if (question.type === "single" && correct !== 1) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Une question à choix unique a exactement 1 bonne réponse." });
    }
    if (question.type === "multiple" && correct < 1) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Une question à choix multiples a au moins 1 bonne réponse." });
    }
  });

export type QuestionData = z.output<typeof questionSchema>;
export type QuestionFormData = z.input<typeof questionSchema>;

const idSchema = (what: string) => z.string({ error: `${what} est invalide.` }).min(1, `${what} est invalide.`);
const quizId = idSchema("L'identifiant du quiz");
const questionId = idSchema("L'identifiant de la question");

// Réglages visibles : mode, correction, mélange ; repliés : description et catégorie. Rien d'autre n'est accepté.
const settingsShape = {
  title: titleSchema,
  mode: gameModeSchema,
  showCorrectAnswer: z.boolean({ error: "Réglage invalide." }),
  shuffle: z.boolean({ error: "Réglage invalide." }),
  description: optionalText("La description", LONG_TEXT_MAX),
  category: optionalText("La catégorie", CATEGORY_MAX),
};

export const settingsSchema = z.object(settingsShape).partial();

// Entrées des Actions : le serveur et les îlots importent les mêmes schémas.
export const quizActionInputs = {
  // Le titre est facultatif seulement si un modèle fournit le sien : la règle se vérifie ici pour avoir un message de champ.
  creer: z
    .object({
      title: titleSchema.optional(),
      modele: z.string({ error: "Ce modèle n'existe pas." }).min(1, "Ce modèle n'existe pas.").optional(),
    })
    .superRefine((input, ctx) => {
      if (input.title === undefined && (input.modele === undefined || input.modele === "zero")) {
        ctx.addIssue({ code: "custom", path: ["title"], message: "Le titre est obligatoire." });
      }
    }),
  dupliquer: z.object({ quizId }),
  supprimer: z.object({ quizId }),
  majReglages: z.object({ quizId, ...settingsSchema.shape }),
  ajouterQuestion: z.object({ quizId, question: questionSchema }),
  majQuestion: z.object({ questionId, question: questionSchema }),
  supprimerQuestion: z.object({ questionId }),
  reordonner: z.object({
    quizId,
    questionIds: z
      .array(questionId, { error: "L'ordre des questions est invalide." })
      .max(MAX_QUESTIONS, `Un quiz ne peut pas dépasser ${MAX_QUESTIONS} questions.`),
  }),
  charger: z.object({ quizId }),
};

export interface QuizStatus {
  ready: boolean;
  // Libellé tel qu'affiché : « Prêt à jouer » ou « Brouillon - n à compléter ».
  label: string;
  incompleteCount: number;
  incomplete: { questionId: string; position: number }[];
}

export interface QuestionForStatus {
  id: string;
  prompt: string;
  options: { label: string; isCorrect: boolean }[];
}

// Même règle que la sous-requête SQL de listQuizzes (src/server/db/quizzes.ts) : énoncé non vide, au moins deux
// réponses libellées, au moins une bonne réponse.
export function isQuestionComplete(question: Pick<QuestionForStatus, "prompt" | "options">): boolean {
  const labelled = question.options.filter((o) => o.label.trim() !== "").length;
  return question.prompt.trim() !== "" && labelled >= MIN_OPTIONS && question.options.some((o) => o.isCorrect);
}

export function statusFromCounts(questionCount: number, incompleteCount: number): Pick<QuizStatus, "ready" | "label"> {
  if (questionCount === 0) return { ready: false, label: "Brouillon - aucune question" };
  if (incompleteCount > 0) return { ready: false, label: `Brouillon - ${incompleteCount} à compléter` };
  return { ready: true, label: "Prêt à jouer" };
}

// `position` est le rang de la question dans le quiz (à partir de 0), l'ordre du tableau fait foi.
export function quizStatus(questions: readonly QuestionForStatus[]): QuizStatus {
  const incomplete = questions.flatMap((q, position) => (isQuestionComplete(q) ? [] : [{ questionId: q.id, position }]));
  return { ...statusFromCounts(questions.length, incomplete.length), incompleteCount: incomplete.length, incomplete };
}
