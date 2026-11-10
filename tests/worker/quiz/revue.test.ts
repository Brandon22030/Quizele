/// <reference types="@cloudflare/vitest-plugin/types" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../src/server/db/client";
import { MODELES } from "../../../src/contenu/modeles";
import * as dbSchema from "../../../src/server/db/schema";
import { addQuestion, createQuiz, QuizLimitError, type QuestionInput } from "../../../src/server/db/quizzes";
import * as h from "../../../src/server/quiz/handlers";
import { actionFailure, toQuizFailure } from "../../../src/server/quiz/handlers";
import {
  GAME_MODES,
  PARTIR_DE_ZERO,
  QUESTION_DURATIONS,
  QUESTION_TYPES,
  isQuestionComplete,
  quizActionInputs,
  questionSchema,
} from "../../../src/shared/quiz-schema";
import { freshDb, insertUser } from "../db/helpers";

const alice = { id: "alice" };
let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
});

const ENGLISH = /Invalid|Required|Expected|expected|received|String must|Too (big|small)|Unrecognized/;
const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message) ?? [];
const opts = (...flags: boolean[]) => flags.map((isCorrect, i) => ({ label: `R${i}`, isCorrect }));
const draft = (over: object = {}) => ({ type: "single", prompt: "Q ?", durationSec: 20, options: opts(false, false), ...over });

describe("zod : messages en français pour toute entrée mal formée", () => {
  const actions = Object.keys(quizActionInputs) as (keyof typeof quizActionInputs)[];
  const notObjects: unknown[] = [undefined, null, 5, "texte", [], true];

  it.each(actions)("%s : une entrée qui n'est pas un objet est refusée en français", (action) => {
    for (const input of notObjects) {
      const result = quizActionInputs[action].safeParse(input);
      expect(result.success).toBe(false);
      const msgs = messages(result as never);
      expect(msgs.length).toBeGreaterThan(0);
      for (const m of msgs) expect(m).not.toMatch(ENGLISH);
    }
  });

  it.each([
    ["majQuestion sans question", "majQuestion", { questionId: "x" }],
    ["ajouterQuestion question nulle", "ajouterQuestion", { quizId: "q", question: null }],
    ["majQuestion question texte", "majQuestion", { questionId: "x", question: "texte" }],
    ["option qui n'est pas un objet", "majQuestion", { questionId: "x", question: { ...draft(), options: [5, null] } }],
    ["réglages en tableau", "majReglages", []],
  ] as const)("%s : refusé, tous les messages en français", (_n, action, input) => {
    const result = quizActionInputs[action].safeParse(input);
    expect(result.success).toBe(false);
    for (const m of messages(result as never)) expect(m).not.toMatch(ENGLISH);
  });
});

describe("brouillon : 0 bonne réponse enregistrée puis signalée", () => {
  it("une question remplie avant de cocher la réponse s'enregistre, reste à compléter, puis devient prête", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Brouillon" });
    for (const type of ["single", "multiple"] as const) {
      const input = quizActionInputs.ajouterQuestion.parse({ quizId, question: draft({ type }) });
      await h.ajouterQuestion(db, alice, input);
    }
    let loaded = await h.charger(db, alice, { quizId });
    expect(loaded.status).toMatchObject({ ready: false, incompleteCount: 2, label: "Brouillon - 2 à compléter" });
    expect((await h.lister(db, alice)).quizzes[0]!.status.incompleteCount).toBe(2);

    for (const q of loaded.quiz.questions) {
      const question = questionSchema.parse({ ...draft({ type: q.type }), options: opts(false, true) });
      await h.majQuestion(db, alice, quizActionInputs.majQuestion.parse({ questionId: q.id, question }));
    }
    loaded = await h.charger(db, alice, { quizId });
    expect(loaded.status.label).toBe("Prêt à jouer");
    expect((await h.lister(db, alice)).quizzes[0]!.status.ready).toBe(true);
  });

  it("passer de « plusieurs » à « unique » avec 2 bonnes réponses reste refusé, en français", () => {
    const result = quizActionInputs.majQuestion.safeParse({ questionId: "x", question: draft({ type: "single", options: opts(true, true, false) }) });
    expect(result.success).toBe(false);
    expect(messages(result as never)).toEqual(["Une question à choix unique a une seule bonne réponse."]);
  });

  it("vrai/faux : exactement 2 réponses et au plus 1 bonne ; 0 permis en brouillon", () => {
    expect(questionSchema.safeParse(draft({ type: "true_false", options: opts(false, false) })).success).toBe(true);
    expect(messages(questionSchema.safeParse(draft({ type: "true_false", options: opts(true, true) })))).toEqual([
      "Une question vrai ou faux a une seule bonne réponse.",
    ]);
    expect(messages(questionSchema.safeParse(draft({ type: "true_false", options: opts(true, false, false) })))).toContain(
      "Une question vrai ou faux a exactement 2 réponses.",
    );
  });
});

describe("complétude : isQuestionComplete et le SQL de listQuizzes concordent", () => {
  // Combinaisons écrites sans passer par zod, y compris ce qu'il refuse (1 option, 2 bonnes en choix unique) : la règle
  // doit concorder sur tout ce que la base peut contenir.
  const prompts = ["", "  ", "Énoncé"];
  const layouts: QuestionInput["options"][] = [[]];
  for (let n = 1; n <= 4; n++) {
    const correctSets = [[], [0], [0, 1], Array.from({ length: n }, (_, i) => i)]
      .filter((set) => set.every((i) => i < n))
      .filter((set, i, all) => all.findIndex((s) => s.join() === set.join()) === i);
    for (const blankLast of ["", " ", null])
      for (const set of correctSets)
        layouts.push(
          Array.from({ length: n }, (_, i) => ({ label: i === n - 1 && blankLast !== null ? blankLast : `R${i}`, isCorrect: set.includes(i) })),
        );
  }
  const cases = QUESTION_TYPES.flatMap((type) => prompts.flatMap((prompt) => layouts.map((options) => ({ type, prompt, durationSec: 20 as const, options }))));

  it("une question par quiz : même verdict par la règle partagée, lister et charger", async () => {
    let owner = 0;
    let ownerId = "";
    const created: { quizId: string; ownerId: string; question: QuestionInput }[] = [];
    for (const [i, question] of cases.entries()) {
      // lister renvoie au plus 100 quiz par propriétaire.
      if (i % 100 === 0) {
        ownerId = `o${owner++}`;
        await insertUser(db, ownerId);
      }
      created.push({ quizId: await createQuiz(db, ownerId, { title: "C", questions: [question] }), ownerId, question });
    }
    const listed = new Map<string, number>();
    for (let o = 0; o < owner; o++) for (const q of (await h.lister(db, { id: `o${o}` })).quizzes) listed.set(q.id, q.status.incompleteCount);

    let complete = 0;
    for (const { quizId, ownerId: id, question } of created) {
      const expected = isQuestionComplete(question) ? 0 : 1;
      complete += 1 - expected;
      expect([question, listed.get(quizId)]).toEqual([question, expected]);
      expect([question, (await h.charger(db, { id }, { quizId })).status.incompleteCount]).toEqual([question, expected]);
    }
    expect(cases.length).toBeGreaterThan(200);
    expect(complete).toBeGreaterThan(0);
  }, 30_000);

  it("règles explicites", () => {
    const base = { type: "single" as const, prompt: "Q", options: opts(true, false) };
    expect(isQuestionComplete(base)).toBe(true);
    expect(isQuestionComplete({ ...base, options: [...opts(true, false), { label: " ", isCorrect: false }] })).toBe(false);
    expect(isQuestionComplete({ ...base, options: opts(false, false) })).toBe(false);
    expect(isQuestionComplete({ ...base, options: opts(true, true) })).toBe(false);
    expect(isQuestionComplete({ ...base, type: "multiple", options: opts(true, true) })).toBe(true);
    expect(isQuestionComplete({ ...base, type: "multiple", options: opts(false, false) })).toBe(false);
    expect(isQuestionComplete({ ...base, type: "true_false", options: opts(true, false, false) })).toBe(false);
    expect(isQuestionComplete({ ...base, type: "true_false", options: opts(false, true) })).toBe(true);
    expect(isQuestionComplete({ ...base, options: opts(true) })).toBe(false);
  });
});

describe("modèles : bonnes réponses variées et affirmations fausses", () => {
  it("la bonne réponse unique n'est pas toujours au même rang", () => {
    const ranks = MODELES.flatMap((m) => m.questions.filter((q) => q.type === "single").map((q) => q.options.findIndex((o) => o.isCorrect)));
    expect(new Set(ranks).size).toBeGreaterThanOrEqual(3);
    for (const m of MODELES) {
      const own = m.questions.filter((q) => q.type === "single").map((q) => q.options.findIndex((o) => o.isCorrect));
      expect([m.id, own.every((r) => r === 0)]).toEqual([m.id, false]);
    }
  });

  it("les bonnes réponses multiples ne sont pas toujours en tête", () => {
    const multiples = MODELES.flatMap((m) => m.questions.filter((q) => q.type === "multiple"));
    expect(multiples.length).toBeGreaterThan(0);
    const leading = (flags: boolean[]) => flags.every((f, i) => !f || flags.slice(0, i).every(Boolean));
    expect(multiples.every((q) => leading(q.options.map((o) => o.isCorrect)))).toBe(false);
  });

  it("au moins 2 affirmations fausses par modèle contenant des vrai/faux, chacun prêt à jouer", () => {
    for (const m of MODELES) {
      const tf = m.questions.filter((q) => q.type === "true_false");
      if (tf.length === 0) continue;
      const fausses = tf.filter((q) => q.options.find((o) => o.label === "Faux")!.isCorrect);
      expect([m.id, fausses.length >= 2]).toEqual([m.id, true]);
      expect(m.questions.every(isQuestionComplete)).toBe(true);
      expect(JSON.stringify(m)).not.toMatch(/[—–]/);
    }
  });
});

describe("QuizLimitError : traduite par son kind, pas par son texte", () => {
  it("la couche D1 pose le kind ; le texte n'influe plus sur la traduction", async () => {
    const tooMany = Array.from({ length: 51 }, () => ({ type: "multiple" as const, prompt: "Q", durationSec: 20 as const, options: opts(true, false) }));
    await expect(createQuiz(db, "alice", { title: "T", questions: tooMany })).rejects.toMatchObject({ kind: "questions" });
    const { quizId } = await h.creer(db, alice, { title: "T" });
    const five = { type: "multiple" as const, prompt: "Q", durationSec: 20 as const, options: opts(true, false, false, false, false) };
    await expect(addQuestion(db, "alice", quizId, five)).rejects.toMatchObject({ kind: "options" });
    expect(toQuizFailure(new QuizLimitError("options", "questions")).message).toBe("Une question ne peut pas dépasser 4 options.");
    expect(toQuizFailure(new QuizLimitError("questions", "options")).message).toBe("Un quiz ne peut pas dépasser 50 questions.");
  });
});

describe("actionFailure : journalise les erreurs internes sans l'entrée", () => {
  afterEach(() => vi.restoreAllMocks());

  it("erreur interne : nom de l'action et message seulement ; erreur attendue : rien", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = actionFailure("majQuestion", new Error("D1_ERROR: panne"));
    expect(failure.code).toBe("INTERNAL_SERVER_ERROR");
    expect(spy).toHaveBeenCalledExactlyOnceWith("quiz.majQuestion", "D1_ERROR: panne");
    actionFailure("ajouterQuestion", new QuizLimitError("questions", "plein"));
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("constantes partagées", () => {
  it("PARTIR_DE_ZERO vient de shared : sans titre il est refusé, avec titre il crée un quiz vide", async () => {
    expect(MODELES.some((m) => m.id === PARTIR_DE_ZERO)).toBe(false);
    expect(messages(quizActionInputs.creer.safeParse({ modele: PARTIR_DE_ZERO }))).toEqual(["Le titre est obligatoire."]);
    const { quizId } = await h.creer(db, alice, { title: "Vide", modele: PARTIR_DE_ZERO });
    expect((await h.charger(db, alice, { quizId })).quiz.questions).toEqual([]);
  });

  it("la base et l'éditeur partagent les mêmes listes, définies une seule fois", () => {
    expect(dbSchema.QUESTION_TYPES).toBe(QUESTION_TYPES);
    expect(dbSchema.QUESTION_DURATIONS).toBe(QUESTION_DURATIONS);
    expect(dbSchema.GAME_MODES).toBe(GAME_MODES);
  });
});

describe("dupliquer : coupe par points de code", () => {
  it("un titre de 120 emojis donne 112 emojis entiers suivis de (copie)", async () => {
    const { quizId } = await h.creer(db, alice, { title: "😀".repeat(120) });
    const { quizId: copy } = await h.dupliquer(db, alice, { quizId });
    const title = (await h.charger(db, alice, { quizId: copy })).quiz.title;
    expect(title).toBe("😀".repeat(112) + " (copie)");
    expect(title.isWellFormed()).toBe(true);
  });
});
