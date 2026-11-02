import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VueApercu, VueChargement, VueErreur } from "../../../src/islands/apercu/Vue";
import { estJuste, messageVerdict, type DonneesApercu, type QuestionApercu } from "../../../src/islands/apercu/logique";

const question: QuestionApercu = {
  id: "a",
  type: "multiple",
  prompt: "Qui a construit l'arche ?",
  durationSec: 20,
  reference: "Genèse 6",
  explanation: "Noé a obéi.",
  options: [
    { id: "o1", label: "Noé", isCorrect: true },
    { id: "o2", label: "Moïse", isCorrect: false },
    { id: "o3", label: "Sem", isCorrect: true },
  ],
};

describe("aperçu : correction", () => {
  it("juste seulement si l'ensemble choisi est exactement l'ensemble correct", () => {
    expect(estJuste(question, ["o3", "o1"])).toBe(true);
    expect(estJuste(question, ["o1"])).toBe(false);
    expect(estJuste(question, ["o1", "o3", "o2"])).toBe(false);
    expect(estJuste(question, [])).toBe(false);
  });

  it("une question sans bonne réponse n'est jamais juste", () => {
    const brouillon = { ...question, options: question.options.map((o) => ({ ...o, isCorrect: false })) };
    expect(estJuste(brouillon, [])).toBe(false);
  });

  it("messages sans mot « faux »", () => {
    expect(messageVerdict(true, ["o1"])).toContain("+1");
    expect(messageVerdict(false, [])).toContain("Temps écoulé");
    expect(messageVerdict(false, ["o2"]).toLowerCase()).not.toContain("faux");
  });
});

describe("aperçu : rendu", () => {
  const donnees: DonneesApercu = { quizId: "q1", title: "Héros", showCorrectAnswer: true, questions: [question] };

  it("bandeau Aperçu, chrono, énoncé, réponses, navigation", () => {
    const html = renderToStaticMarkup(createElement(VueApercu, { donnees }));
    expect(html).toContain("Aperçu : tes réponses ne comptent pas");
    expect(html).toContain('href="/quiz/q1"');
    expect(html).toContain("Retour à l&#x27;éditeur");
    expect(html).toContain('role="timer"');
    expect(html).toContain("Question 1 sur 1");
    expect(html).toContain("Qui a construit l&#x27;arche ?");
    expect(html).toContain("Noé");
    expect(html).toContain("Précédente");
    expect(html).toContain("Suivante");
    expect(html).toContain("Valider la sélection");
  });

  it("n'expose aucune bonne réponse avant le choix", () => {
    const html = renderToStaticMarkup(createElement(VueApercu, { donnees }));
    expect(html).not.toContain("Bonne réponse");
    expect(html).not.toContain("Noé a obéi");
  });

  it("état vide : lien vers l'éditeur, bandeau toujours là", () => {
    const html = renderToStaticMarkup(createElement(VueApercu, { donnees: { ...donnees, questions: [] } }));
    expect(html).toContain("Rien à prévisualiser");
    expect(html).toContain("Ajouter une question");
    expect(html).toContain("Aperçu : tes réponses ne comptent pas");
  });

  it("chargement et erreur gardent le bandeau", () => {
    expect(renderToStaticMarkup(createElement(VueChargement, { quizId: "q1" }))).toContain('aria-busy="true"');
    const erreur = renderToStaticMarkup(createElement(VueErreur, { quizId: "q1", message: "Ce quiz est introuvable." }));
    expect(erreur).toContain("Ce quiz est introuvable.");
    expect(erreur).toContain("Aperçu : tes réponses ne comptent pas");
  });
});
