import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Rejoindre from "../../../src/islands/rejoindre/Rejoindre";
import CodeAccueil from "../../../src/islands/rejoindre/CodeAccueil";
import { JOIN_MESSAGES } from "../../../src/islands/rejoindre/inscription";

const rendu = (props: Parameters<typeof Rejoindre>[0]) => renderToString(createElement(Rejoindre, props));

describe("encart de la partie", () => {
  it("montre le titre et l'animateur", () => {
    const html = rendu({
      initialCode: "K7Q2MB",
      apercu: { titre: "Les héros de la foi", animateur: "Sarah" },
    });
    expect(html).toContain("Les héros de la foi");
    expect(html).toContain("Animé par");
    expect(html).toContain("Sarah");
  });
  it("n'affiche que le titre sans nom d'animateur", () => {
    const html = rendu({
      initialCode: "K7Q2MB",
      apercu: { titre: "Les héros de la foi" },
    });
    expect(html).toContain("Les héros de la foi");
    expect(html).not.toContain("Animé par");
  });
  it("n'affiche rien sans aperçu", () => {
    expect(rendu({ initialCode: "K7Q2MB" })).not.toContain("Animé par");
  });
});

describe("état annoncé dès l'arrivée", () => {
  it("code inconnu : message présent dans le rendu serveur, avant toute saisie", () => {
    const html = rendu({
      initialCode: "K7Q2MB",
      echecInitial: "game_not_found",
    });
    expect(html).toContain(JOIN_MESSAGES.game_not_found.replace("'", "&#x27;"));
  });
  it("partie terminée : message affiché", () => {
    const html = rendu({
      initialCode: "K7Q2MB",
      echecInitial: "game_finished",
    });
    expect(html).toContain("Cette partie est terminée");
  });
});

describe("accueil", () => {
  it("le formulaire a un repli GET sans JavaScript et le thème forêt", () => {
    const html = renderToString(createElement(CodeAccueil));
    expect(html).toContain('data-theme="foret"');
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/"');
    expect(html).toContain('name="code"');
    expect(html).toContain('placeholder="ABC234"');
  });
});
