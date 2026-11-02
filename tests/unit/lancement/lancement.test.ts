import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { quizStatus } from "../../../src/shared/quiz-schema";
import { VueLancement } from "../../../src/islands/lancement/VueLancement";
import {
  dureeEstimeeMinutes,
  resumeQuiz,
  verifications,
  type EtatLancement,
  type QuestionLancement,
  type QuizLancement,
} from "../../../src/islands/lancement/logique";

const complete = (id: string, extra: Partial<QuestionLancement> = {}): QuestionLancement => ({
  id,
  type: "single",
  prompt: "Qui a construit l'arche ?",
  durationSec: 20,
  explanation: "Genèse 6.",
  options: [
    { label: "Noé", isCorrect: true },
    { label: "Moïse", isCorrect: false },
  ],
  ...extra,
});

const incomplete = (id: string): QuestionLancement => complete(id, { prompt: "", explanation: null });

function quiz(questions: QuestionLancement[], extra: Partial<QuizLancement> = {}): QuizLancement {
  return { id: "q1", title: "Les héros de la foi", mode: "together", showCorrectAnswer: true, questions, ...extra };
}

const pret = (q: QuizLancement): EtatLancement => ({ etat: "pret", quiz: q, status: quizStatus(q.questions) });

function vue(etat: EtatLancement, extra: { lancementEnCours?: boolean; erreurLancement?: string | null } = {}): string {
  return renderToStaticMarkup(
    createElement(VueLancement, { quizId: "q1", etat, lancementEnCours: false, erreurLancement: null, onLancer: () => undefined, onReessayer: () => undefined, ...extra }),
  );
}

describe("points de vérification", () => {
  it("quiz complet : tout est vert, aucun lien", () => {
    const q = quiz([complete("a"), complete("b")]);
    const liste = verifications(q, quizStatus(q.questions));
    expect(liste.map((v) => [v.id, v.etat, v.texte])).toEqual([
      ["questions", "ok", "2 questions complètes"],
      ["correction", "ok", "Bonne réponse montrée après chaque question"],
    ]);
  });

  it("chaque question incomplète renvoie à l'éditeur avec un numéro à partir de 1", () => {
    const q = quiz([complete("a"), incomplete("b"), complete("c"), incomplete("d")]);
    const [questions] = verifications(q, quizStatus(q.questions));
    expect(questions).toMatchObject({ etat: "alerte", texte: "2 questions à compléter" });
    expect(questions!.liens).toEqual([
      { href: "/quiz/q1?question=2", libelle: "Aller à la question 2" },
      { href: "/quiz/q1?question=4", libelle: "Aller à la question 4" },
    ]);
  });

  it("quiz vide : renvoi vers l'éditeur", () => {
    const q = quiz([]);
    const [questions] = verifications(q, quizStatus(q.questions));
    expect(questions).toMatchObject({ etat: "alerte", texte: "Aucune question" });
    expect(questions!.liens[0]!.href).toBe("/quiz/q1");
  });

  it("signale sans bloquer les questions sans explication, vers la première", () => {
    const q = quiz([complete("a"), complete("b", { explanation: null }), complete("c", { explanation: "  " })]);
    const liste = verifications(q, quizStatus(q.questions));
    const explications = liste.find((v) => v.id === "explications");
    expect(explications).toMatchObject({ etat: "alerte", texte: "2 questions sans explication" });
    expect(explications!.liens).toEqual([{ href: "/quiz/q1?question=2", libelle: "Compléter" }]);
  });

  it("correction masquée : pas de rappel d'explication, la ligne le dit", () => {
    const q = quiz([complete("a", { explanation: null })], { showCorrectAnswer: false });
    const liste = verifications(q, quizStatus(q.questions));
    expect(liste.find((v) => v.id === "explications")).toBeUndefined();
    expect(liste.find((v) => v.id === "correction")!.texte).toBe("Bonne réponse non montrée pendant la partie");
  });

  it("durée estimée : temps de réponse plus une pause de correction", () => {
    expect(dureeEstimeeMinutes([{ durationSec: 20 }, { durationSec: 20 }])).toBe(1);
    expect(dureeEstimeeMinutes(Array.from({ length: 10 }, () => ({ durationSec: 20 })))).toBe(5);
    expect(resumeQuiz(quiz(Array.from({ length: 10 }, (_, i) => complete(`q${i}`))))).toBe("10 questions - environ 5 min");
    expect(resumeQuiz(quiz([]))).toBe("Aucune question");
  });
});

describe("écran de lancement (k7)", () => {
  it("quiz prêt : titre, mode rappelé, bouton actif", () => {
    const html = vue(pret(quiz([complete("a")])));
    expect(html).toContain("PRÊT ?");
    expect(html).toContain("Les héros de la foi");
    expect(html).toContain("Tout le monde ensemble");
    expect(html).toContain('href="/quiz/q1/reglages"');
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it("mode libre rappelé", () => {
    expect(vue(pret(quiz([complete("a")], { mode: "own_pace" })))).toContain("Chacun à son rythme");
  });

  it("quiz incomplet : bouton inactif, liens vers les questions, aide associée", () => {
    const html = vue(pret(quiz([complete("a"), incomplete("b")])));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="aide-lancement"/);
    expect(html).toContain('href="/quiz/q1?question=2"');
    expect(html).toContain("Aller à la question 2");
  });

  it("chargement, introuvable et erreur réseau", () => {
    expect(vue({ etat: "chargement" })).toContain('aria-busy="true"');
    const introuvable = vue({ etat: "erreur", message: "Quiz introuvable", introuvable: true });
    expect(introuvable).toContain("Quiz introuvable");
    expect(introuvable).not.toContain("Réessayer");
    expect(vue({ etat: "erreur", message: "Connexion impossible.", introuvable: false })).toContain("Réessayer");
  });

  it("erreur du serveur au lancement affichée en français", () => {
    const html = vue(pret(quiz([complete("a")])), { erreurLancement: "Trop de parties lancées en peu de temps. Réessaie dans une heure." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Trop de parties lancées");
  });

  it("lancement en cours : bouton occupé", () => {
    expect(vue(pret(quiz([complete("a")])), { lancementEnCours: true })).toContain('aria-busy="true"');
  });
});
