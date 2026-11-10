import { describe, expect, it } from "vitest";
import {
  GAME_MODES,
  LONG_TEXT_MAX,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  OPTION_LABEL_MAX,
  PROMPT_MAX,
  QUESTION_DURATIONS,
  QUESTION_TYPES,
  TITLE_MAX,
  quizActionInputs,
  questionSchema,
  quizStatus,
  settingsSchema,
  statusFromCounts,
} from "../../../src/shared/quiz-schema";
import * as dbSchema from "../../../src/server/db/schema";

const opts = (...flags: boolean[]) => flags.map((isCorrect, i) => ({ label: `R${i}`, isCorrect }));
const single = (overrides: object = {}) => ({ type: "single", prompt: "Q ?", durationSec: 20, options: opts(true, false), ...overrides });
const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) => result.error?.issues.map((i) => i.message) ?? [];

describe("bornes alignées sur la base", () => {
  it("reprend exactement les valeurs des CHECK", () => {
    expect(MAX_QUESTIONS).toBe(dbSchema.MAX_QUESTIONS_PER_QUIZ);
    expect(MAX_OPTIONS).toBe(dbSchema.MAX_OPTIONS_PER_QUESTION);
    expect(TITLE_MAX).toBe(dbSchema.QUIZ_TITLE_MAX_CHARS);
    expect(PROMPT_MAX).toBe(dbSchema.PROMPT_MAX_CHARS);
    expect(OPTION_LABEL_MAX).toBe(dbSchema.OPTION_LABEL_MAX_CHARS);
    expect(LONG_TEXT_MAX).toBe(dbSchema.LONG_TEXT_MAX_CHARS);
    expect([...QUESTION_TYPES]).toEqual([...dbSchema.QUESTION_TYPES]);
    expect([...QUESTION_DURATIONS]).toEqual([...dbSchema.QUESTION_DURATIONS]);
    expect([...GAME_MODES]).toEqual([...dbSchema.GAME_MODES]);
  });
});

describe("questionSchema", () => {
  it("accepte les trois types seulement", () => {
    expect(questionSchema.safeParse(single()).success).toBe(true);
    expect(questionSchema.safeParse(single({ type: "multiple", options: opts(true, true) })).success).toBe(true);
    expect(questionSchema.safeParse(single({ type: "true_false" })).success).toBe(true);
    for (const type of ["text", "free_text", "short_answer", ""]) {
      expect(questionSchema.safeParse(single({ type })).success).toBe(false);
    }
  });

  it("vrai/faux : exactement 2 options", () => {
    const tf = (n: number) => single({ type: "true_false", options: opts(true, ...Array(n - 1).fill(false)) });
    expect(questionSchema.safeParse(tf(2)).success).toBe(true);
    expect(messages(questionSchema.safeParse(tf(3)))).toContain("Une question vrai ou faux a exactement 2 réponses.");
  });

  it("choix unique : au plus 1 bonne réponse, 0 permis en brouillon", () => {
    expect(questionSchema.safeParse(single({ options: opts(false, false) })).success).toBe(true);
    expect(questionSchema.safeParse(single({ options: opts(true, true) })).success).toBe(false);
    expect(messages(questionSchema.safeParse(single({ options: opts(true, true, false) })))).toContain(
      "Une question à choix unique a une seule bonne réponse.",
    );
  });

  it("choix multiple : 0 bonne réponse permis en brouillon", () => {
    expect(questionSchema.safeParse(single({ type: "multiple", options: opts(false, false) })).success).toBe(true);
    expect(questionSchema.safeParse(single({ type: "multiple", options: opts(true, false) })).success).toBe(true);
    expect(questionSchema.safeParse(single({ type: "multiple", options: opts(true, true, true, true) })).success).toBe(true);
  });

  it("2 à 4 options", () => {
    expect(questionSchema.safeParse(single({ options: opts(true) })).success).toBe(false);
    expect(questionSchema.safeParse(single({ options: opts(true, false, false, false) })).success).toBe(true);
    expect(messages(questionSchema.safeParse(single({ options: opts(true, false, false, false, false) })))).toContain(
      "Une question ne peut pas dépasser 4 réponses.",
    );
  });

  it("durée : 10, 20, 30 ou 60 seulement", () => {
    for (const d of [10, 20, 30, 60]) expect(questionSchema.safeParse(single({ durationSec: d })).success).toBe(true);
    for (const d of [0, 15, 45, 61, "20", null]) expect(questionSchema.safeParse(single({ durationSec: d })).success).toBe(false);
  });

  it("longueurs : énoncé 300, option 200, référence et explication 500", () => {
    expect(questionSchema.safeParse(single({ prompt: "a".repeat(300) })).success).toBe(true);
    expect(questionSchema.safeParse(single({ prompt: "a".repeat(301) })).success).toBe(false);
    expect(questionSchema.safeParse(single({ options: [{ label: "a".repeat(200), isCorrect: true }, { label: "b", isCorrect: false }] })).success).toBe(true);
    expect(questionSchema.safeParse(single({ options: [{ label: "a".repeat(201), isCorrect: true }, { label: "b", isCorrect: false }] })).success).toBe(false);
    expect(questionSchema.safeParse(single({ reference: "a".repeat(500), explanation: "a".repeat(500) })).success).toBe(true);
    expect(questionSchema.safeParse(single({ reference: "a".repeat(501) })).success).toBe(false);
    expect(questionSchema.safeParse(single({ explanation: "a".repeat(501) })).success).toBe(false);
  });

  it("normalise : trim, champs optionnels vides = null", () => {
    const parsed = questionSchema.parse(single({ prompt: "  Q ?  ", reference: "   ", explanation: undefined }));
    expect(parsed.prompt).toBe("Q ?");
    expect(parsed.reference).toBeNull();
    expect(parsed.explanation).toBeNull();
  });

  it("ignore les champs supprimés (points, indice, bonus)", () => {
    const parsed = questionSchema.parse(single({ points: 5, hint: "x", speedBonus: true })) as Record<string, unknown>;
    expect(parsed.points).toBeUndefined();
    expect(parsed.hint).toBeUndefined();
  });
});

describe("entrées des actions", () => {
  const settings = quizActionInputs.majReglages;

  it("titre : requis, 1 à 120 caractères", () => {
    expect(quizActionInputs.creer.safeParse({ title: "a".repeat(120) }).success).toBe(true);
    expect(messages(quizActionInputs.creer.safeParse({ title: "a".repeat(121) }))).toContain("Le titre ne peut pas dépasser 120 caractères.");
    expect(messages(quizActionInputs.creer.safeParse({ title: "   " }))).toContain("Le titre est obligatoire.");
    expect(messages(quizActionInputs.creer.safeParse({}))).toContain("Le titre est obligatoire.");
    expect(messages(quizActionInputs.creer.safeParse({ modele: "zero" }))).toContain("Le titre est obligatoire.");
    expect(quizActionInputs.creer.safeParse({ modele: "vie-de-jesus" }).success).toBe(true);
  });

  it("réglages : mode, interrupteurs, description 500, catégorie 60", () => {
    expect(settings.safeParse({ quizId: "q", mode: "own_pace", showCorrectAnswer: false, shuffle: true }).success).toBe(true);
    expect(settings.safeParse({ quizId: "q", mode: "self_paced" }).success).toBe(false);
    expect(settings.safeParse({ quizId: "q", description: "a".repeat(500) }).success).toBe(true);
    expect(settings.safeParse({ quizId: "q", description: "a".repeat(501) }).success).toBe(false);
    expect(settings.safeParse({ quizId: "q", category: "a".repeat(61) }).success).toBe(false);
    expect(settings.safeParse({ quizId: "q", title: "" }).success).toBe(false);
    expect(settings.safeParse({ quizId: "" }).success).toBe(false);
  });

  it("réglages supprimés : ils n'atteignent jamais la base", () => {
    const parsed = settings.parse({ quizId: "q", points: 3, visibility: "public", coverUrl: "x", status: "published" }) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["quizId"]);
    expect(Object.keys(settingsSchema.parse({ shuffle: true, indice: "x" }))).toEqual(["shuffle"]);
  });

  it("réordonnancement : au plus 50 identifiants", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `q${i}`);
    expect(quizActionInputs.reordonner.safeParse({ quizId: "q", questionIds: ids(50) }).success).toBe(true);
    expect(messages(quizActionInputs.reordonner.safeParse({ quizId: "q", questionIds: ids(51) }))).toContain(
      "Un quiz ne peut pas dépasser 50 questions.",
    );
  });

  it("chaque action refuse une entrée sans identifiant", () => {
    for (const name of ["dupliquer", "supprimer", "majReglages", "ajouterQuestion", "majQuestion", "supprimerQuestion", "reordonner", "charger"] as const) {
      expect(quizActionInputs[name].safeParse({}).success, name).toBe(false);
    }
  });
});

describe("quizStatus", () => {
  const complete = { id: "a", type: "single" as const, prompt: "Q ?", options: [{ label: "x", isCorrect: true }, { label: "y", isCorrect: false }] };

  it("prêt à jouer quand tout est complet", () => {
    expect(quizStatus([complete, { ...complete, id: "b" }])).toEqual({ ready: true, label: "Prêt à jouer", incompleteCount: 0, incomplete: [] });
  });

  it("brouillon : liste les questions incomplètes avec leur rang", () => {
    const status = quizStatus([
      complete,
      { ...complete, id: "b", prompt: "  " },
      { ...complete, id: "c", options: [{ label: "x", isCorrect: true }, { label: "", isCorrect: false }] },
      { ...complete, id: "d", options: [{ label: "x", isCorrect: false }, { label: "y", isCorrect: false }] },
    ]);
    expect(status.ready).toBe(false);
    expect(status.label).toBe("Brouillon - 3 à compléter");
    expect(status.incomplete).toEqual([
      { questionId: "b", position: 1 },
      { questionId: "c", position: 2 },
      { questionId: "d", position: 3 },
    ]);
  });

  it("un quiz sans question n'est pas prêt", () => {
    expect(quizStatus([]).ready).toBe(false);
    expect(statusFromCounts(0, 0).label).toBe("Brouillon - aucune question");
    expect(statusFromCounts(4, 1).label).toBe("Brouillon - 1 à compléter");
  });
});
