import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LONG_TEXT_MAX, MAX_QUESTIONS, OPTION_LABEL_MAX, PROMPT_MAX } from "../../../src/shared/quiz-schema";
import {
  ajouterQuestion,
  ajouterReponse,
  basculerJuste,
  brouillonDepuisServeur,
  brouillonVierge,
  changerLibelle,
  changerType,
  dupliquerQuestion,
  majQuestion,
  nouvelleQuestion,
  ordonner,
  peutAjouterQuestion,
  problemeQuestion,
  retirerReponse,
  supprimerQuestion,
  validerQuestion,
  type Brouillon,
  type QuestionBrouillon,
} from "../../../src/islands/editeur/modele";
import { ChoixType } from "../../../src/islands/editeur/ChoixType";
import { PucesDuree } from "../../../src/islands/editeur/PucesDuree";

const question = (extra: Partial<QuestionBrouillon> = {}): QuestionBrouillon => ({
  key: "q1",
  id: "q1",
  type: "multiple",
  prompt: "Qui a construit l'arche ?",
  durationSec: 20,
  reference: "",
  explanation: "",
  options: [
    { label: "Abraham", isCorrect: true },
    { label: "Noé", isCorrect: true },
    { label: "Moïse", isCorrect: false },
  ],
  ...extra,
});

const brouillon = (questions: QuestionBrouillon[]): Brouillon => ({
  quizId: "quiz1",
  title: "Les héros",
  questions,
  sale: { titre: false, ordre: false, questions: [], supprimees: [] },
});

const correctes = (q: QuestionBrouillon) => q.options.filter((o) => o.isCorrect).length;
const premiere = (b: Brouillon) => b.questions[0];

describe("bascule de type", () => {
  it("vrai ou faux fige deux réponses Vrai et Faux sans bonne réponse", () => {
    const b = changerType(brouillon([question()]), "q1", "true_false");
    expect(premiere(b).options).toEqual([
      { label: "Vrai", isCorrect: false },
      { label: "Faux", isCorrect: false },
    ]);
    expect(validerQuestion(premiere(b)).ok).toBe(true);
  });

  it("passer de plusieurs à unique garde au plus une bonne réponse (la première)", () => {
    const b = changerType(brouillon([question()]), "q1", "single");
    expect(premiere(b).options.map((o) => o.isCorrect)).toEqual([true, false, false]);
    expect(validerQuestion(premiere(b)).ok).toBe(true);
  });

  it("de vrai ou faux vers unique, les libellés figés sont vidés et deux réponses restent", () => {
    const vf = changerType(brouillon([question()]), "q1", "true_false");
    const b = changerType(vf, "q1", "single");
    expect(premiere(b).options.map((o) => o.label)).toEqual(["", ""]);
    expect(premiere(b).options).toHaveLength(2);
  });

  it("le type inchangé ne marque rien à envoyer", () => {
    const b = brouillon([question()]);
    expect(changerType(b, "q1", "multiple")).toBe(b);
  });

  it("n'ajoute ni ne retire de réponse sur un vrai ou faux", () => {
    const vf = changerType(brouillon([question()]), "q1", "true_false");
    expect(ajouterReponse(vf, "q1")).toBe(vf);
    expect(retirerReponse(vf, "q1", 1)).toBe(vf);
  });

  it("cocher en mode unique décoche les autres, en mode plusieurs il les garde", () => {
    const unique = basculerJuste(brouillon([question({ type: "single", options: question().options.map((o) => ({ ...o, isCorrect: false })) })]), "q1", 1);
    const unique2 = basculerJuste(unique, "q1", 2);
    expect(premiere(unique2).options.map((o) => o.isCorrect)).toEqual([false, false, true]);
    expect(correctes(premiere(basculerJuste(brouillon([question()]), "q1", 2)))).toBe(3);
  });

  it("le tap sur la bonne réponse la décoche (un brouillon sans bonne réponse reste permis)", () => {
    const b = basculerJuste(brouillon([question({ type: "single", options: [{ label: "A", isCorrect: true }, { label: "B", isCorrect: false }] })]), "q1", 0);
    expect(correctes(premiere(b))).toBe(0);
    expect(validerQuestion(premiere(b)).ok).toBe(true);
  });
});

describe("validation des bornes", () => {
  it("accepte un brouillon vide : énoncé et libellés vides, aucune bonne réponse", () => {
    expect(validerQuestion(nouvelleQuestion()).ok).toBe(true);
  });

  it("borne l'énoncé, les libellés et les textes", () => {
    const bornes = (patch: Partial<QuestionBrouillon>) => validerQuestion(question({ ...patch })).ok;
    expect(bornes({ prompt: "a".repeat(PROMPT_MAX) })).toBe(true);
    expect(bornes({ prompt: "a".repeat(PROMPT_MAX + 1) })).toBe(false);
    expect(bornes({ options: [{ label: "a".repeat(OPTION_LABEL_MAX), isCorrect: false }, { label: "b", isCorrect: false }] })).toBe(true);
    expect(bornes({ options: [{ label: "a".repeat(OPTION_LABEL_MAX + 1), isCorrect: false }, { label: "b", isCorrect: false }] })).toBe(false);
    expect(bornes({ reference: "r".repeat(LONG_TEXT_MAX) })).toBe(true);
    expect(bornes({ reference: "r".repeat(LONG_TEXT_MAX + 1) })).toBe(false);
    expect(bornes({ explanation: "e".repeat(LONG_TEXT_MAX + 1) })).toBe(false);
  });

  it("refuse plus de 4 réponses, moins de 2, et deux bonnes réponses en mode unique", () => {
    const cinq = Array.from({ length: 5 }, () => ({ label: "x", isCorrect: false }));
    expect(validerQuestion(question({ options: cinq })).ok).toBe(false);
    expect(validerQuestion(question({ options: [{ label: "x", isCorrect: false }] })).ok).toBe(false);
    expect(validerQuestion(question({ type: "single" })).ok).toBe(false);
  });

  it("limite le nombre de réponses éditables à 4 et à 2 minimum", () => {
    let b = brouillon([question({ options: [{ label: "", isCorrect: false }, { label: "", isCorrect: false }] })]);
    b = ajouterReponse(ajouterReponse(b, "q1"), "q1");
    expect(premiere(b).options).toHaveLength(4);
    expect(ajouterReponse(b, "q1")).toBe(b);
    b = retirerReponse(retirerReponse(b, "q1", 3), "q1", 2);
    expect(premiere(b).options).toHaveLength(2);
    expect(retirerReponse(b, "q1", 1)).toBe(b);
  });

  it("au plus 50 questions", () => {
    let b = brouillon([]);
    for (let i = 0; i < MAX_QUESTIONS; i++) b = ajouterQuestion(b);
    expect(b.questions).toHaveLength(MAX_QUESTIONS);
    expect(peutAjouterQuestion(b)).toBe(false);
    expect(ajouterQuestion(b)).toBe(b);
  });

  it("dit ce qu'il reste à faire sur une question", () => {
    expect(problemeQuestion(nouvelleQuestion())).toBe("Écris la question");
    expect(problemeQuestion(question({ prompt: "Q", options: [{ label: "", isCorrect: true }, { label: "b", isCorrect: false }] }))).toBe("Remplis les réponses");
    expect(problemeQuestion(question({ type: "single", options: [{ label: "a", isCorrect: false }, { label: "b", isCorrect: false }] }))).toBe("Choisis la bonne réponse");
    expect(problemeQuestion(question())).toBeNull();
  });
});

describe("marques à envoyer", () => {
  it("chaque modification marque sa question, une seule fois", () => {
    let b = brouillon([question()]);
    b = changerLibelle(majQuestion(b, "q1", { prompt: "Nouveau" }), "q1", 0, "Autre");
    expect(b.sale.questions).toEqual(["q1"]);
  });

  it("supprimer une question enregistrée la met en file de suppression, une locale disparaît sans trace", () => {
    const b = brouillon([question(), question({ key: "n-1", id: null })]);
    const sans = supprimerQuestion(supprimerQuestion(b, "n-1"), "q1");
    expect(sans.sale.supprimees).toEqual(["q1"]);
    expect(sans.questions).toHaveLength(0);
    expect(sans.sale.questions).toEqual([]);
  });

  it("dupliquer place la copie après l'original, sans identifiant, et réclame un nouvel ordre", () => {
    const b = dupliquerQuestion(brouillon([question(), question({ key: "q2", id: "q2" })]), "q1");
    expect(b.questions.map((q) => q.id)).toEqual(["q1", null, "q2"]);
    expect(b.sale.ordre).toBe(true);
    expect(b.sale.questions).toHaveLength(1);
  });

  it("ordonner refuse une liste incomplète et ignore l'ordre identique", () => {
    const b = brouillon([question(), question({ key: "q2", id: "q2" })]);
    expect(ordonner(b, ["q1"])).toBe(b);
    expect(ordonner(b, ["q1", "q2"])).toBe(b);
    expect(ordonner(b, ["q2", "q1"]).sale.ordre).toBe(true);
  });

  it("le brouillon vierge porte la question 1 à créer", () => {
    const b = brouillonVierge();
    expect(b.questions).toHaveLength(1);
    expect(b.sale.questions).toEqual([b.questions[0].key]);
  });

  it("reprend un quiz serveur dans l'ordre des positions, textes absents vides", () => {
    const b = brouillonDepuisServeur({
      id: "z",
      title: "T",
      questions: [
        { id: "b", position: 1, type: "single", prompt: "Deux", durationSec: 30, reference: null, explanation: null, options: [{ position: 1, label: "y", isCorrect: true }, { position: 0, label: "x", isCorrect: false }] },
        { id: "a", position: 0, type: "single", prompt: "Un", durationSec: 20, reference: "Gn 1", explanation: null, options: [] },
      ],
    });
    expect(b.questions.map((q) => q.id)).toEqual(["a", "b"]);
    expect(b.questions[1].options.map((o) => o.label)).toEqual(["x", "y"]);
    expect(b.questions[1].reference).toBe("");
  });
});

describe("tuiles de choix", () => {
  it("ChoixType propose exactement trois types, aucune réponse écrite", () => {
    const html = renderToStaticMarkup(createElement(ChoixType, { valeur: "single", onChange: () => {}, nom: "t" }));
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain("Une bonne réponse");
    expect(html).toContain("Plusieurs bonnes");
    expect(html).toContain("Vrai ou faux");
    expect(html).not.toMatch(/écrire|texte libre/i);
  });

  it("PucesDuree propose 10, 20, 30 et 60 s, la valeur reçue est cochée", () => {
    const html = renderToStaticMarkup(createElement(PucesDuree, { valeur: 20, onChange: () => {}, nom: "d" }));
    expect([...html.matchAll(/value="(\d+)"/g)].map((m) => m[1])).toEqual(["10", "20", "30", "60"]);
    expect(html).toMatch(/value="20"[^>]*checked|checked[^>]*value="20"/);
  });
});
