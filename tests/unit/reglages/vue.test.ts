import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VueChargement, VueErreur, VueReglages } from "../../../src/islands/reglages/Vue";
import type { DonneesReglages, StatutEnregistrement } from "../../../src/islands/reglages/logique";

const noop = () => {};
const donnees: DonneesReglages = {
  quizId: "q1",
  title: "Les héros de la foi",
  mode: "together",
  showCorrectAnswer: true,
  shuffle: false,
  description: "",
  category: "",
};

function rendre(statut: StatutEnregistrement = { etat: "repos" }, extra: Partial<DonneesReglages> = {}) {
  const d = { ...donnees, ...extra };
  return renderToStaticMarkup(
    createElement(VueReglages, {
      donnees: d,
      valeurs: d,
      statut,
      annonce: "",
      onChange: noop,
      onTexte: noop,
      onTexteTermine: noop,
      onReessayer: noop,
      onRetour: noop,
    }),
  );
}

describe("réglages : rendu", () => {
  it("propose les deux modes, les deux interrupteurs et le repli, rien d'autre", () => {
    const html = rendre();
    expect(html).toContain("Tout le monde ensemble");
    expect(html).toContain("Chacun à son rythme");
    expect(html).toContain("Montrer la bonne réponse");
    expect(html).toContain("Mélanger l&#x27;ordre");
    expect(html).toContain("Plus d&#x27;options");
    expect(html).toContain("Description (visible par les joueurs)");
    expect(html).toContain("Catégorie");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).not.toContain("Supprimer");
  });

  it("borne la description à 500 et la catégorie à 60 caractères", () => {
    const html = rendre();
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('maxLength="60"');
  });

  it("lien de retour vers l'éditeur", () => {
    expect(rendre()).toContain('href="/quiz/q1"');
    expect(rendre()).toContain("Retour à l&#x27;éditeur");
  });

  it("statuts : enregistré, en cours, échec avec nouvelle tentative", () => {
    expect(rendre({ etat: "enregistre" })).toContain("Enregistré");
    expect(rendre({ etat: "enregistrement" })).toContain("Enregistrement…");
    const echec = rendre({ etat: "echec", message: "Une erreur est survenue." });
    expect(echec).toContain("Non enregistré");
    expect(echec).toContain("Une erreur est survenue.");
    expect(echec).toContain("Réessayer");
    expect(echec).toContain("Quitter sans enregistrer");
  });

  it("séparateur entre les interrupteurs : bordure réellement déclarée", () => {
    expect(rendre()).toContain("border-trait border-x-0 border-b-0 border-dashed");
    expect(rendre()).not.toContain("border-t-trait");
  });

  it("chargement et erreur", () => {
    expect(renderToStaticMarkup(createElement(VueChargement, { quizId: "q1" }))).toContain('aria-busy="true"');
    const erreur = renderToStaticMarkup(createElement(VueErreur, { quizId: "q1", message: "Ce quiz est introuvable." }));
    expect(erreur).toContain("Ce quiz est introuvable.");
    expect(erreur).not.toContain("Réessayer");
    expect(renderToStaticMarkup(createElement(VueErreur, { quizId: "q1", message: "m", onRetry: noop }))).toContain("Réessayer");
  });
});
