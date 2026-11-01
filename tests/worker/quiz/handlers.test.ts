/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import { MODELES, trouverModele } from "../../../src/contenu/modeles";
import { questionSchema, quizActionInputs, quizStatus } from "../../../src/shared/quiz-schema";
import * as h from "../../../src/server/quiz/handlers";
import { QuizFailure, toQuizFailure } from "../../../src/server/quiz/handlers";
import { NotFoundError, QuizLimitError } from "../../../src/server/db/quizzes";
import { freshDb, insertUser } from "../db/helpers";

const alice = { id: "alice" };
const bob = { id: "bob" };

const question = (overrides: object = {}) =>
  questionSchema.parse({
    type: "single",
    prompt: "Combien de jours ?",
    durationSec: 20,
    options: [
      { label: "Trois", isCorrect: false },
      { label: "Six", isCorrect: true },
    ],
    ...overrides,
  });

async function failure(promise: Promise<unknown>): Promise<QuizFailure> {
  try {
    await promise;
  } catch (error) {
    return toQuizFailure(error);
  }
  throw new Error("aucune erreur levée");
}

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
  await insertUser(db, "bob");
});

describe("non connecté", () => {
  it("chaque action renvoie UNAUTHORIZED", async () => {
    const calls: Promise<unknown>[] = [
      h.creer(db, null, { title: "T" }),
      h.dupliquer(db, null, { quizId: "q" }),
      h.supprimer(db, null, { quizId: "q" }),
      h.majReglages(db, null, { quizId: "q" }),
      h.ajouterQuestion(db, null, { quizId: "q", question: question() }),
      h.majQuestion(db, null, { questionId: "x", question: question() }),
      h.supprimerQuestion(db, null, { questionId: "x" }),
      h.reordonner(db, null, { quizId: "q", questionIds: [] }),
      h.lister(db, null),
      h.charger(db, null, { quizId: "q" }),
    ];
    for (const call of calls) {
      const f = await failure(call);
      expect(f.code).toBe("UNAUTHORIZED");
      expect(f.message).toBe("Connecte-toi pour continuer.");
    }
  });
});

describe("creer", () => {
  it("crée un quiz vide avec un titre", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Mon quiz" });
    const { quiz, status } = await h.charger(db, alice, { quizId });
    expect(quiz.title).toBe("Mon quiz");
    expect(quiz.mode).toBe("together");
    expect(quiz.showCorrectAnswer).toBe(true);
    expect(quiz.shuffle).toBe(false);
    expect(quiz.questions).toEqual([]);
    expect(status.ready).toBe(false);
  });

  it("crée « Partir de zéro » comme un quiz vide", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Vide", modele: "zero" });
    expect((await h.charger(db, alice, { quizId })).quiz.questions).toEqual([]);
  });

  it.each(MODELES.map((m) => [m.id] as const))("crée depuis le modèle %s, prêt à jouer", async (id) => {
    const modele = trouverModele(id)!;
    const { quizId } = await h.creer(db, alice, { modele: id });
    const { quiz, status } = await h.charger(db, alice, { quizId });
    expect(quiz.title).toBe(modele.title);
    expect(quiz.category).toBe("Bible");
    expect(quiz.questions).toHaveLength(modele.questions.length);
    expect(quiz.questions.map((q) => q.prompt)).toEqual(modele.questions.map((q) => q.prompt));
    expect(status).toMatchObject({ ready: true, label: "Prêt à jouer" });
  });

  it("garde le titre choisi à la place de celui du modèle", async () => {
    const { quizId } = await h.creer(db, alice, { title: "Ma version", modele: "vie-de-jesus" });
    expect((await h.charger(db, alice, { quizId })).quiz.title).toBe("Ma version");
  });

  it("refuse un modèle inconnu", async () => {
    const f = await failure(h.creer(db, alice, { modele: "inconnu" }));
    expect(f).toMatchObject({ code: "BAD_REQUEST", message: "Ce modèle n'existe pas." });
  });

  it("refuse une entrée invalide", () => {
    expect(quizActionInputs.creer.safeParse({}).success).toBe(false);
  });
});

describe("modèles", () => {
  it("sont valides, génériques et limités aux 3 types", () => {
    expect(MODELES).toHaveLength(3);
    for (const modele of MODELES) {
      expect(modele.questions.length).toBeGreaterThanOrEqual(5);
      expect(modele.questions.length).toBeLessThanOrEqual(50);
      expect(quizStatus(modele.questions.map((q, i) => ({ id: String(i), ...q }))).ready).toBe(true);
      expect(JSON.stringify(modele).toLowerCase()).not.toMatch(/association|eglise|église|paroisse/);
      for (const q of modele.questions) {
        expect(["single", "multiple", "true_false"]).toContain(q.type);
        expect(questionSchema.safeParse(q).success).toBe(true);
        expect(q.reference).toMatch(/\d/);
      }
    }
  });
});

describe("dupliquer", () => {
  it("copie quiz, questions et bonnes réponses", async () => {
    const { quizId } = await h.creer(db, alice, { modele: "vie-de-jesus" });
    const copy = await h.dupliquer(db, alice, { quizId });
    expect(copy.quizId).not.toBe(quizId);
    const original = await h.charger(db, alice, { quizId });
    const result = await h.charger(db, alice, { quizId: copy.quizId });
    expect(result.quiz.title).toBe(`${original.quiz.title} (copie)`);
    expect(result.quiz.questions.map((q) => q.options.map((o) => o.isCorrect))).toEqual(
      original.quiz.questions.map((q) => q.options.map((o) => o.isCorrect)),
    );
  });

  it("garde le titre de la copie sous 120 caractères", async () => {
    const { quizId } = await h.creer(db, alice, { title: "a".repeat(120) });
    const copy = await h.dupliquer(db, alice, { quizId });
    expect((await h.charger(db, alice, { quizId: copy.quizId })).quiz.title).toHaveLength(120);
  });

  it("refuse un quiz d'un autre", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    expect(await failure(h.dupliquer(db, bob, { quizId }))).toMatchObject({ code: "NOT_FOUND", message: "Ce quiz est introuvable." });
  });
});

describe("supprimer", () => {
  it("supprime son quiz", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    await h.supprimer(db, alice, { quizId });
    expect((await h.lister(db, alice)).quizzes).toEqual([]);
  });

  it("refuse le quiz d'un autre sans le supprimer", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    expect((await failure(h.supprimer(db, bob, { quizId }))).code).toBe("NOT_FOUND");
    expect((await h.lister(db, alice)).quizzes).toHaveLength(1);
  });
});

describe("majReglages", () => {
  it("met à jour les réglages visibles et repliés", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    await h.majReglages(db, alice, { quizId, mode: "own_pace", showCorrectAnswer: false, shuffle: true, description: "Desc", category: "Bible" });
    const { quiz } = await h.charger(db, alice, { quizId });
    expect(quiz).toMatchObject({ mode: "own_pace", showCorrectAnswer: false, shuffle: true, description: "Desc", category: "Bible", title: "T" });
  });

  it("un champ absent ne change rien, un champ vidé repasse à null", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    await h.majReglages(db, alice, { quizId, description: "Desc" });
    await h.majReglages(db, alice, { quizId, shuffle: true });
    expect((await h.charger(db, alice, { quizId })).quiz.description).toBe("Desc");
    const cleared = quizActionInputs.majReglages.parse({ quizId, description: "  " });
    await h.majReglages(db, alice, cleared);
    expect((await h.charger(db, alice, { quizId })).quiz.description).toBeNull();
  });

  it("refuse le quiz d'un autre", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    expect((await failure(h.majReglages(db, bob, { quizId, title: "Piraté" }))).code).toBe("NOT_FOUND");
    expect((await h.charger(db, alice, { quizId })).quiz.title).toBe("T");
  });
});

describe("questions", () => {
  it("ajoute, modifie, supprime et réordonne", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    const a = (await h.ajouterQuestion(db, alice, { quizId, question: question({ prompt: "A" }) })).questionId;
    const b = (await h.ajouterQuestion(db, alice, { quizId, question: question({ prompt: "B" }) })).questionId;
    await h.majQuestion(db, alice, { questionId: a, question: question({ prompt: "A2", reference: "Genèse 1:1" }) });
    await h.reordonner(db, alice, { quizId, questionIds: [b, a] });
    let { quiz } = await h.charger(db, alice, { quizId });
    expect(quiz.questions.map((q) => q.prompt)).toEqual(["B", "A2"]);
    expect(quiz.questions[1]!.reference).toBe("Genèse 1:1");
    expect(quiz.questions[1]!.options.map((o) => o.isCorrect)).toEqual([false, true]);

    await h.supprimerQuestion(db, alice, { questionId: b });
    ({ quiz } = await h.charger(db, alice, { quizId }));
    expect(quiz.questions.map((q) => q.prompt)).toEqual(["A2"]);
  });

  it("refuse l'ajout, la modification et la suppression sur le quiz d'un autre", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    const { questionId } = await h.ajouterQuestion(db, alice, { quizId, question: question() });
    expect((await failure(h.ajouterQuestion(db, bob, { quizId, question: question() }))).code).toBe("NOT_FOUND");
    expect(await failure(h.majQuestion(db, bob, { questionId, question: question({ prompt: "X" }) }))).toMatchObject({
      code: "NOT_FOUND",
      message: "Cette question est introuvable.",
    });
    expect((await failure(h.supprimerQuestion(db, bob, { questionId }))).code).toBe("NOT_FOUND");
    expect((await failure(h.reordonner(db, bob, { quizId, questionIds: [questionId] }))).code).toBe("NOT_FOUND");
    expect((await h.charger(db, alice, { quizId })).quiz.questions[0]!.prompt).toBe("Combien de jours ?");
  });

  it("refuse la 51e question avec un message français", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    for (let i = 0; i < 50; i++) await h.ajouterQuestion(db, alice, { quizId, question: question() });
    expect(await failure(h.ajouterQuestion(db, alice, { quizId, question: question() }))).toMatchObject({
      code: "BAD_REQUEST",
      message: "Un quiz ne peut pas dépasser 50 questions.",
    });
  });

  it("refuse un ordre périmé", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    const { questionId } = await h.ajouterQuestion(db, alice, { quizId, question: question() });
    const f = await failure(h.reordonner(db, alice, { quizId, questionIds: [questionId, "autre"] }));
    expect(f.code).toBe("BAD_REQUEST");
    expect(f.message).toBe("L'ordre des questions n'est plus à jour. Recharge la page.");
  });

  it("refuse une question invalide avant la base", () => {
    expect(quizActionInputs.ajouterQuestion.safeParse({ quizId: "q", question: { type: "text", prompt: "?", durationSec: 20, options: [] } }).success).toBe(false);
    expect(quizActionInputs.majQuestion.safeParse({ questionId: "x", question: { ...question(), durationSec: 15 } }).success).toBe(false);
  });
});

describe("lister et charger", () => {
  it("liste uniquement ses quiz avec le statut calculé", async () => {
    const draft = (await h.creer(db, alice, { title: "Brouillon" })).quizId;
    await h.ajouterQuestion(db, alice, { quizId: draft, question: question({ prompt: "" }) });
    const ready = (await h.creer(db, alice, { modele: "creation-et-exode" })).quizId;
    await h.creer(db, bob, { title: "Autre" });

    const { quizzes } = await h.lister(db, alice);
    expect(quizzes).toHaveLength(2);
    const byId = new Map(quizzes.map((q) => [q.id, q]));
    expect(byId.get(draft)!.status).toEqual({ ready: false, label: "Brouillon - 1 à compléter", incompleteCount: 1 });
    expect(byId.get(ready)!.status).toMatchObject({ ready: true, label: "Prêt à jouer" });
    expect(byId.get(ready)!.questionCount).toBe(trouverModele("creation-et-exode")!.questions.length);
  });

  it("charger renvoie is_correct au propriétaire, la liste des incomplètes, et jamais ownerId", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    await h.ajouterQuestion(db, alice, { quizId, question: question() });
    const second = (await h.ajouterQuestion(db, alice, { quizId, question: question({ prompt: "" }) })).questionId;
    const result = await h.charger(db, alice, { quizId });
    expect(result.quiz.questions[0]!.options.some((o) => o.isCorrect)).toBe(true);
    expect(result.status.incomplete).toEqual([{ questionId: second, position: 1 }]);
    expect(JSON.stringify(result)).not.toContain("ownerId");
  });

  it("charger refuse un autre propriétaire et un quiz inconnu", async () => {
    const { quizId } = await h.creer(db, alice, { title: "T" });
    expect((await failure(h.charger(db, bob, { quizId }))).code).toBe("NOT_FOUND");
    expect((await failure(h.charger(db, alice, { quizId: "inconnu" }))).code).toBe("NOT_FOUND");
  });
});

describe("toQuizFailure", () => {
  it("traduit les erreurs de la base et masque les inconnues", () => {
    expect(toQuizFailure(new QuizLimitError("options", "Une question compte au plus 4 options")).message).toBe("Une question ne peut pas dépasser 4 options.");
    expect(toQuizFailure(new NotFoundError("Quiz introuvable")).code).toBe("NOT_FOUND");
    const unknown = toQuizFailure(new Error("SQLITE_CONSTRAINT: secret interne"));
    expect(unknown.code).toBe("INTERNAL_SERVER_ERROR");
    expect(unknown.message).not.toContain("SQLITE");
  });
});
