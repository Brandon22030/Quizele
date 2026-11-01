/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import { MODELES } from "../../../src/contenu/modeles";
import { QuizLimitError } from "../../../src/server/db/quizzes";
import * as h from "../../../src/server/quiz/handlers";
import { QuizFailure, toQuizFailure } from "../../../src/server/quiz/handlers";
import { CATEGORY_MAX, MAX_QUESTIONS, quizActionInputs, questionSchema, settingsSchema, quizStatus } from "../../../src/shared/quiz-schema";
import { freshDb, insertUser } from "../db/helpers";

const alice = { id: "alice" };
const bob = { id: "bob" };
let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
  await insertUser(db, "bob");
});

const q = (over: object = {}) =>
  questionSchema.parse({
    type: "single",
    prompt: "Question ?",
    durationSec: 20,
    options: [
      { label: "A", isCorrect: true },
      { label: "B", isCorrect: false },
    ],
    ...over,
  });
const fail = async (p: Promise<unknown>): Promise<QuizFailure> => {
  try {
    await p;
  } catch (e) {
    return toQuizFailure(e);
  }
  throw new Error("aucune erreur levée");
};
const count = async (sql: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).first<{ n: number }>())!.n;
const issues = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message) ?? [];

describe("propriétaire : même réponse pour inconnu et étranger, sans fuite", () => {
  it("chaque action renvoie NOT_FOUND au même message pour un quiz ou une question d'un autre ou inexistant", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Secret" });
    const { questionId } = await h.ajouterQuestion(db, alice, { quizId, question: q({ prompt: "Confidentiel" }) });
    const calls: [string, (id: string, qid: string) => Promise<unknown>][] = [
      ["dupliquer", (id) => h.dupliquer(db, bob, { quizId: id })],
      ["supprimer", (id) => h.supprimer(db, bob, { quizId: id })],
      ["majReglages", (id) => h.majReglages(db, bob, { quizId: id, title: "x" })],
      ["ajouterQuestion", (id) => h.ajouterQuestion(db, bob, { quizId: id, question: q() })],
      ["majQuestion", (_i, qid) => h.majQuestion(db, bob, { questionId: qid, question: q() })],
      ["supprimerQuestion", (_i, qid) => h.supprimerQuestion(db, bob, { questionId: qid })],
      ["reordonner", (id, qid) => h.reordonner(db, bob, { quizId: id, questionIds: [qid] })],
      ["charger", (id) => h.charger(db, bob, { quizId: id })],
    ];
    for (const [name, call] of calls) {
      const foreign = await fail(call(quizId, questionId));
      const missing = await fail(call("inexistant", "inexistante"));
      expect([name, foreign.code]).toEqual([name, "NOT_FOUND"]);
      expect([name, foreign.message]).toEqual([name, missing.message]);
      expect(foreign.message).not.toMatch(/Secret|Confidentiel|alice/);
    }
    expect(await count("quizzes")).toBe(1);
    expect(await count("questions")).toBe(1);
  });
});

describe("entrées invalides : messages zod en français", () => {
  const bad: [string, keyof typeof quizActionInputs, unknown][] = [
    ["creer sans rien", "creer", {}],
    ["creer titre nombre", "creer", { title: 12 }],
    ["creer titre blanc", "creer", { title: "   " }],
    ["creer titre 121", "creer", { title: "x".repeat(121) }],
    ["creer modèle vide", "creer", { title: "T", modele: "" }],
    ["dupliquer sans id", "dupliquer", {}],
    ["supprimer id null", "supprimer", { quizId: null }],
    ["charger id nombre", "charger", { quizId: 5 }],
    ["majReglages mode inconnu", "majReglages", { quizId: "q", mode: "solo" }],
    ["majReglages bool texte", "majReglages", { quizId: "q", shuffle: "oui" }],
    ["majReglages description 501", "majReglages", { quizId: "q", description: "d".repeat(501) }],
    ["majReglages catégorie 61", "majReglages", { quizId: "q", category: "c".repeat(CATEGORY_MAX + 1) }],
    ["ajouterQuestion sans question", "ajouterQuestion", { quizId: "q" }],
    ["ajouterQuestion type inconnu", "ajouterQuestion", { quizId: "q", question: { type: "text", prompt: "x", durationSec: 20, options: [] } }],
    ["majQuestion durée 15", "majQuestion", { questionId: "x", question: { type: "single", prompt: "x", durationSec: 15, options: [] } }],
    ["majQuestion options absentes", "majQuestion", { questionId: "x", question: { type: "single", prompt: "x", durationSec: 20 } }],
    ["majQuestion option sans isCorrect", "majQuestion", { questionId: "x", question: { type: "single", prompt: "x", durationSec: 20, options: [{ label: "a" }, { label: "b" }] } }],
    ["supprimerQuestion sans id", "supprimerQuestion", {}],
    ["reordonner pas un tableau", "reordonner", { quizId: "q", questionIds: "a" }],
    ["reordonner 51 ids", "reordonner", { quizId: "q", questionIds: Array.from({ length: 51 }, (_, i) => `q${i}`) }],
    ["reordonner id vide", "reordonner", { quizId: "q", questionIds: [""] }],
  ];
  it.each(bad)("%s : refusé, tous les messages en français", (_n, action, input) => {
    const result = quizActionInputs[action].safeParse(input);
    expect(result.success).toBe(false);
    const msgs = issues(result as never);
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) {
      expect(m).not.toMatch(/Invalid|Required|Expected|expected|received|String must|Too (big|small)|Unrecognized/);
      expect(m).toMatch(/[a-zéèà]/);
    }
  });
});

describe("bornes zod égales aux bornes SQL, valeurs limites écrites en base", () => {
  it("valeurs maximales acceptées par zod passent aussi les CHECK de la base", async () => {
    const { quizId } = await h.creer(db, alice, { title: "t".repeat(120) });
    await h.majReglages(db, alice, { quizId, ...settingsSchema.parse({ description: "d".repeat(500), category: "c".repeat(60) }) } as never);
    await h.ajouterQuestion(db, alice, {
      quizId,
      question: q({
        prompt: "p".repeat(300),
        reference: "r".repeat(500),
        explanation: "e".repeat(500),
        type: "multiple",
        options: ["a", "b", "c", "d"].map((x) => ({ label: x.repeat(200), isCorrect: true })),
      }),
    });
    const { quiz } = await h.charger(db, alice, { quizId });
    expect(quiz.title).toHaveLength(120);
    expect(quiz.category).toHaveLength(60);
    expect(quiz.questions[0]!.options).toHaveLength(4);
  });

  it("emojis : zod et la base comptent en points de code, 120 acceptés, 121 refusés", async () => {
    const title = "😀".repeat(120);
    expect(quizActionInputs.creer.safeParse({ title }).success).toBe(true);
    expect(quizActionInputs.creer.safeParse({ title: "😀".repeat(121) }).success).toBe(false);
    const { quizId } = await h.creer(db, alice, { title });
    expect((await h.charger(db, alice, { quizId })).quiz.title).toBe(title);
  });

  it("une valeur 1 au-dessus de la borne est refusée par zod ET par la base", async () => {
    const quizId = (await h.creer(db, alice, { title: "T" })).quizId;
    await expect(env.DB.prepare("UPDATE quizzes SET title = ? WHERE id = ?").bind("t".repeat(121), quizId).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare("UPDATE quizzes SET description = ? WHERE id = ?").bind("d".repeat(501), quizId).run()).rejects.toThrow(/CHECK/);
    expect(quizActionInputs.creer.safeParse({ title: "t".repeat(121) }).success).toBe(false);
    expect(settingsSchema.safeParse({ description: "d".repeat(501) }).success).toBe(false);
  });

  it("durées : seules 10, 20, 30, 60 passent ; 0, 5, 15, 61, 20.5, NaN, texte refusés", () => {
    for (const d of [10, 20, 30, 60]) expect(questionSchema.safeParse({ type: "single", prompt: "x", durationSec: d, options: [{ label: "a", isCorrect: true }, { label: "b", isCorrect: false }] }).success).toBe(true);
    for (const d of [0, 5, 15, 61, 20.5, NaN, "20", null, undefined])
      expect(questionSchema.safeParse({ type: "single", prompt: "x", durationSec: d, options: [{ label: "a", isCorrect: true }, { label: "b", isCorrect: false }] }).success).toBe(false);
  });

  it("vrai/faux, choix unique, multiple : combinaisons limites", () => {
    const o = (...f: boolean[]) => f.map((isCorrect, i) => ({ label: `R${i}`, isCorrect }));
    const p = (type: string, options: unknown) => questionSchema.safeParse({ type, prompt: "x", durationSec: 20, options }).success;
    expect(p("true_false", o(true, false))).toBe(true);
    expect(p("true_false", o(false, true))).toBe(true);
    expect(p("true_false", o(true, false, false))).toBe(false);
    expect(p("single", o(true, true))).toBe(false);
    expect(p("single", o(false, false))).toBe(false);
    expect(p("single", o(false, false, true, false))).toBe(true);
    expect(p("multiple", o(false, false))).toBe(false);
    expect(p("multiple", o(true, true, true, true))).toBe(true);
    expect(p("single", o(true))).toBe(false);
    expect(p("single", o(true, false, false, false, false))).toBe(false);
  });
});

describe("brouillons et quizStatus cohérents avec le SQL de listQuizzes", () => {
  const blanks = ["", "   ", "A", "B", "C"];
  const prompts = ["", "  ", "Énoncé"];

  it("énoncé et libellés vides acceptés à l'enregistrement ; mêmes comptes par les deux voies, sur toutes les combinaisons", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Brouillon" });
    let n = 0;
    for (const prompt of prompts)
      for (const l1 of blanks)
        for (const l2 of blanks)
          for (const [c1, c2] of [[true, false], [true, true], [false, true]] as const) {
            if (n >= 50) break;
            const question = questionSchema.parse({ type: "multiple", prompt, durationSec: 20, options: [{ label: l1, isCorrect: c1 }, { label: l2, isCorrect: c2 }] });
            await h.ajouterQuestion(db, alice, { quizId, question });
            n++;
          }
    expect(n).toBe(50);
    const { quizzes } = await h.lister(db, alice);
    const { status, quiz } = await h.charger(db, alice, { quizId });
    expect(quizzes[0]!.status.incompleteCount).toBe(status.incompleteCount);
    expect(quizzes[0]!.status.label).toBe(status.label);
    expect(quizzes[0]!.status.ready).toBe(status.ready);
    expect(status.incomplete).toHaveLength(status.incompleteCount);
    expect(status.incompleteCount).toBeGreaterThan(0);
    // Même résultat que le calcul sur chaque question isolée.
    const solo = quiz.questions.filter((x) => !quizStatus([x]).ready).length;
    expect(solo).toBe(status.incompleteCount);
  });

  it("quiz vide : brouillon sans question, identique par les deux voies", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Vide" });
    const { quizzes } = await h.lister(db, alice);
    const { status } = await h.charger(db, alice, { quizId });
    expect(status.ready).toBe(false);
    expect(quizzes[0]!.status.label).toBe(status.label);
  });

  it("énoncé blanc enregistré tel quel (vide) et signalé", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    await h.ajouterQuestion(db, alice, { quizId, question: q({ prompt: "   ", options: [{ label: "", isCorrect: true }, { label: "", isCorrect: false }] }) });
    const { quiz, status } = await h.charger(db, alice, { quizId });
    expect(quiz.questions[0]!.prompt).toBe("");
    expect(status).toMatchObject({ ready: false, incompleteCount: 1, label: "Brouillon - 1 à compléter" });
  });
});

describe("majReglages : champs supprimés et pirates ignorés", () => {
  it("points, indice, visibilité, couverture, statut, ownerId, id : rien n'est écrit", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Avant" });
    const raw = { quizId, title: "Après", points: 5, indice: "x", visibilite: "public", couverture: "u.png", statut: "publie", ownerId: "bob", id: "pirate", createdAt: new Date(0) };
    const parsed = quizActionInputs.majReglages.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(["quizId", "title"]);
    await h.majReglages(db, alice, raw as never);
    const row = await env.DB.prepare("SELECT id, owner_id, title, created_at FROM quizzes").first<{ id: string; owner_id: string; title: string; created_at: number }>();
    expect(row).toMatchObject({ id: quizId, owner_id: "alice", title: "Après" });
    expect(row!.created_at).toBeGreaterThan(0);
    expect(await count("quizzes")).toBe(1);
  });

  it("question : champs supprimés ignorés par zod", () => {
    const parsed = questionSchema.parse({ type: "single", prompt: "x", durationSec: 20, points: 10, indice: "i", options: [{ label: "a", isCorrect: true, points: 3 }, { label: "b", isCorrect: false }] });
    expect(parsed).not.toHaveProperty("points");
    expect(parsed).not.toHaveProperty("indice");
    expect(parsed.options[0]).not.toHaveProperty("points");
  });

  it("réglages vides : ne change rien", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Garde" });
    await h.majReglages(db, alice, { quizId });
    expect((await h.charger(db, alice, { quizId })).quiz.title).toBe("Garde");
  });
});

describe("reordonner : ordre obsolète ou en double", () => {
  it.each([
    ["doublon", (ids: string[]) => [ids[0]!, ids[0]!, ids[1]!]],
    ["manquant", (ids: string[]) => [ids[0]!, ids[1]!]],
    ["identifiant étranger", (ids: string[]) => [ids[0]!, ids[1]!, "inconnu"]],
    ["liste vide", () => []],
  ])("%s : BAD_REQUEST en français, ordre inchangé", async (_n, make) => {
    const { quizId } = await h.creer(db, alice, { title: "R" });
    const ids: string[] = [];
    for (const p of ["Un", "Deux", "Trois"]) ids.push((await h.ajouterQuestion(db, alice, { quizId, question: q({ prompt: p }) })).questionId);
    const f = await fail(h.reordonner(db, alice, { quizId, questionIds: make(ids) }));
    expect(f.code).toBe("BAD_REQUEST");
    expect(f.message).toBe("L'ordre des questions n'est plus à jour. Recharge la page.");
    expect((await h.charger(db, alice, { quizId })).quiz.questions.map((x) => x.prompt)).toEqual(["Un", "Deux", "Trois"]);
  });
});

describe("QuizLimitError et plafonds via les handlers", () => {
  it("traduction des deux messages", () => {
    expect(toQuizFailure(new QuizLimitError("Un quiz compte au plus 50 questions")).message).toBe("Un quiz ne peut pas dépasser 50 questions.");
    expect(toQuizFailure(new QuizLimitError("Une question compte au plus 4 options")).message).toBe("Une question ne peut pas dépasser 4 options.");
    expect(toQuizFailure(new QuizLimitError("x")).code).toBe("BAD_REQUEST");
  });

  it("50 questions acceptées, la 51e donne BAD_REQUEST français sans écrire", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Plein" });
    for (let i = 0; i < MAX_QUESTIONS; i++) await h.ajouterQuestion(db, alice, { quizId, question: q({ prompt: `Q${i}` }) });
    const f = await fail(h.ajouterQuestion(db, alice, { quizId, question: q() }));
    expect(f).toMatchObject({ code: "BAD_REQUEST", message: "Un quiz ne peut pas dépasser 50 questions." });
    expect(await count("questions")).toBe(50);
  });

  it("dupliquer un quiz plein : 50 questions copiées ; erreur interne jamais détaillée", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Plein" });
    for (let i = 0; i < MAX_QUESTIONS; i++) await h.ajouterQuestion(db, alice, { quizId, question: q({ prompt: `Q${i}` }) });
    const { quizId: copy } = await h.dupliquer(db, alice, { quizId });
    expect((await h.charger(db, alice, { quizId: copy })).quiz.questions).toHaveLength(50);
    const generic = toQuizFailure(new Error("D1_ERROR: SELECT secret FROM user"));
    expect(generic.code).toBe("INTERNAL_SERVER_ERROR");
    expect(generic.message).not.toMatch(/D1|secret|SELECT/);
  });
});

describe("dupliquer : titre tronqué à 120 avec (copie)", () => {
  it.each([[120], [118], [109], [110], [5]])("titre de %i caractères", async (len) => {
    const { quizId } = await h.creer(db, alice, { title: "t".repeat(len) });
    const { quizId: copy } = await h.dupliquer(db, alice, { quizId });
    const title = (await h.charger(db, alice, { quizId: copy })).quiz.title;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith(" (copie)")).toBe(true);
    expect(title).toBe("t".repeat(Math.min(len, 112)) + " (copie)");
  });

  it("copier une copie reste valide et sous 120", async () => {
    let { quizId } = await h.creer(db, alice, { title: "t".repeat(120) });
    for (let i = 0; i < 3; i++) ({ quizId } = await h.dupliquer(db, alice, { quizId }));
    const title = (await h.charger(db, alice, { quizId })).quiz.title;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith(" (copie)")).toBe(true);
  });
});

describe("charger : pas de fuite", () => {
  it("aucune clé ownerId / owner_id, is_correct (isCorrect) seulement pour le propriétaire", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    await h.ajouterQuestion(db, alice, { quizId, question: q() });
    const own = await h.charger(db, alice, { quizId });
    expect(JSON.stringify(own)).not.toMatch(/owner/i);
    expect(JSON.stringify(own)).toMatch(/isCorrect/);
    const foreign = await fail(h.charger(db, bob, { quizId }));
    expect(foreign.code).toBe("NOT_FOUND");
    const list = await h.lister(db, alice);
    expect(JSON.stringify(list)).not.toMatch(/owner|isCorrect|is_correct/i);
    expect((await h.lister(db, bob)).quizzes).toEqual([]);
  });
});

describe("modèles : contraintes complètes", () => {
  it("ids uniques, bornes de base respectées, aucun tiret cadratin ni mention d'association", () => {
    expect(new Set(MODELES.map((m) => m.id)).size).toBe(MODELES.length);
    for (const m of MODELES) {
      expect(m.id).not.toBe("zero");
      expect(m.title.length).toBeLessThanOrEqual(120);
      expect(m.description.length).toBeLessThanOrEqual(500);
      expect((m.category ?? "").length).toBeLessThanOrEqual(CATEGORY_MAX);
      expect(m.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
      const text = JSON.stringify(m);
      expect(text).not.toMatch(/[—–]/);
      expect(text.toLowerCase()).not.toMatch(/association|\basso\b|fij|gbedjromede|paroisse|église|eglise/);
      for (const question of m.questions) {
        expect(["single", "multiple", "true_false"]).toContain(question.type);
        expect(questionSchema.safeParse(question).success).toBe(true);
        expect(question.options.length).toBeGreaterThanOrEqual(2);
        expect(question.options.length).toBeLessThanOrEqual(4);
        expect(new Set(question.options.map((o) => o.label)).size).toBe(question.options.length);
        if (question.type === "true_false") expect(question.options.map((o) => o.label)).toEqual(["Vrai", "Faux"]);
      }
    }
  });

  it("créer depuis chaque modèle donne un quiz « Prêt à jouer » via lister ET charger", async () => {
    for (const m of MODELES) {
      const { quizId } = await h.creer(db, alice, { modele: m.id });
      const loaded = await h.charger(db, alice, { quizId });
      expect(loaded.status.label).toBe("Prêt à jouer");
      expect(loaded.quiz.questions).toHaveLength(m.questions.length);
    }
    const { quizzes } = await h.lister(db, alice);
    expect(quizzes.every((x) => x.status.ready)).toBe(true);
  });

  it("modèle d'un titre trop long côté utilisateur refusé ; modèle sans titre utilise celui du modèle", async () => {
    expect(quizActionInputs.creer.safeParse({ modele: MODELES[0]!.id, title: "x".repeat(121) }).success).toBe(false);
    const { quizId } = await h.creer(db, alice, { modele: MODELES[0]!.id });
    expect((await h.charger(db, alice, { quizId })).quiz.title).toBe(MODELES[0]!.title);
    expect(quizActionInputs.creer.safeParse({ modele: "zero" }).success).toBe(false);
    expect(quizActionInputs.creer.safeParse({ modele: MODELES[0]!.id }).success).toBe(true);
  });
});
