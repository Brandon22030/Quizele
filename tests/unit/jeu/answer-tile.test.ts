import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerTile, type AnswerTileState } from "../../../src/components/jeu/AnswerTile";
import { Verdict } from "../../../src/components/jeu/Verdict";
import { ReponseEnregistree } from "../../../src/components/jeu/MessagesJeu";
import { StatutConnexion } from "../../../src/components/jeu/StatutConnexion";

const tuile = (state: AnswerTileState, withSelect = true) =>
  renderToStaticMarkup(createElement(AnswerTile, { letter: "B", label: "Noé", state, onSelect: withSelect ? () => undefined : undefined }));

describe("AnswerTile", () => {
  it("au repos : bouton non pressé", () => {
    const html = tuile("repos");
    expect(html).toContain("<button");
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("Ton choix");
  });

  it("choisie : bouton pressé avec la pastille « Ton choix »", () => {
    const html = tuile("choisie");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Ton choix");
  });

  it("juste : restitution non interactive avec « Bonne réponse »", () => {
    const html = tuile("juste");
    expect(html).not.toContain("<button");
    expect(html).toContain("Bonne réponse");
    expect(html).toContain("bg-vert-eclat");
  });

  it("ta réponse : contour pointillé et pastille piment, sans bouton", () => {
    const html = tuile("taReponse");
    expect(html).not.toContain("<button");
    expect(html).toContain("border-dashed");
    expect(html).toContain("Ta réponse");
    expect(html).toContain("bg-piment");
  });

  it("désactivée : bouton désactivé, contour pointillé, aucun texte atténué par l'opacité", () => {
    const html = tuile("desactivee");
    expect(html).toContain("disabled");
    expect(html).toContain("border-dashed");
    expect(html).not.toMatch(/opacity/);
  });

  it("sans onSelect, une tuile au repos n'est pas un bouton", () => {
    expect(tuile("repos", false)).not.toContain("<button");
  });

  it("cache la lettre aux lecteurs d'écran mais garde le libellé", () => {
    const html = tuile("repos");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Noé");
  });
});

describe("Verdict", () => {
  it("affiche « JUSTE ! » ou « PAS CETTE FOIS ! », jamais « Faux » dans le badge", () => {
    const juste = renderToStaticMarkup(createElement(Verdict, { correct: true, message: "Bien joué" }));
    const faux = renderToStaticMarkup(createElement(Verdict, { correct: false, message: "On retient" }));
    expect(juste).toContain("JUSTE !");
    expect(faux).toContain("PAS CETTE");
    expect(faux).toContain("FOIS !");
    expect(faux).not.toMatch(/>FAUX/i);
  });
});

describe("correction masquée", () => {
  it("la réponse enregistrée ne contient aucun indice de justesse", () => {
    const html = renderToStaticMarkup(createElement(ReponseEnregistree));
    expect(html).toContain("Réponse enregistrée");
    expect(html).not.toMatch(/JUSTE|Juste|Bonne réponse|Pas cette fois|bg-vert-eclat|bg-piment/);
  });
});

describe("StatutConnexion", () => {
  const rendre = (status: Parameters<typeof StatutConnexion>[0]["status"]) =>
    renderToStaticMarkup(createElement(StatutConnexion, { status }));

  it("ne rend rien quand la connexion est ouverte", () => {
    expect(rendre("open")).toBe("");
  });

  it("affiche « Connexion… » pendant la connexion", () => {
    expect(rendre("connecting")).toContain("Connexion…");
  });

  it("affiche la reprise en cours quand la connexion est perdue", () => {
    expect(rendre("reconnecting")).toContain("reprise en cours");
  });

  it("couvre les trois statuts terminaux avec un message et une action", () => {
    expect(rendre("kicked")).toContain("Tu as été retiré de la partie");
    expect(rendre("ended")).toContain("Partie terminée");
    expect(rendre("rejected")).toContain("Lien invalide");
    expect(rendre("rejected")).toContain('role="alert"');
    expect(rendre("kicked")).toContain("<a ");
  });
});
