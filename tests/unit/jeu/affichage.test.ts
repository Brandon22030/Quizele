import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDuree, initiale, libelleJustes } from "../../../src/components/jeu/formats";
import { Podium } from "../../../src/components/jeu/Podium";
import { Classement } from "../../../src/components/jeu/Classement";
import { Jauge } from "../../../src/components/jeu/Jauge";
import { ListeJoueurs } from "../../../src/components/jeu/PuceJoueur";
import { Explication } from "../../../src/components/jeu/Explication";

describe("formats", () => {
  it("formate la durée en minutes et secondes", () => {
    expect(formatDuree(252_000)).toBe("4 min 12 s");
    expect(formatDuree(42_400)).toBe("42 s");
    expect(formatDuree(-5)).toBe("0 s");
  });

  it("accorde « juste » au pluriel", () => {
    expect(libelleJustes(0)).toBe("0 juste");
    expect(libelleJustes(1)).toBe("1 juste");
    expect(libelleJustes(2)).toBe("2 justes");
  });

  it("prend la première lettre du pseudo, accents compris", () => {
    expect(initiale("Élodie")).toBe("É");
    expect(initiale("  grâce")).toBe("G");
    expect(initiale("")).toBe("?");
  });
});

describe("Jauge", () => {
  it("expose la valeur et borne le remplissage", () => {
    const html = renderToStaticMarkup(createElement(Jauge, { value: 7, max: 12, label: "Réponses reçues" }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="7"');
    expect(html).toContain('aria-valuemax="12"');
    expect(html).toContain("width:58.33");
    expect(renderToStaticMarkup(createElement(Jauge, { value: 99, max: 12, label: "x" }))).toContain("width:100%");
    expect(renderToStaticMarkup(createElement(Jauge, { value: 1, max: 0, label: "x" }))).toContain("width:0%");
  });
});

describe("Podium et classement", () => {
  it("garde l'ordre de lecture 1, 2, 3 et place le premier au centre à l'affichage", () => {
    const html = renderToStaticMarkup(
      createElement(Podium, {
        places: [
          { playerId: "c", rank: 3, pseudo: "Grâce", isYou: true },
          { playerId: "a", rank: 1, pseudo: "Esther" },
          { playerId: "b", rank: 2, pseudo: "David" },
        ],
      }),
    );
    expect(html.indexOf("Esther")).toBeLessThan(html.indexOf("David"));
    expect(html.indexOf("David")).toBeLessThan(html.indexOf("Grâce"));
    expect(html).toContain("Grâce (toi)");
    expect(html).toContain("order-2");
  });

  it("n'affiche que les places existantes", () => {
    const html = renderToStaticMarkup(createElement(Podium, { places: [{ playerId: "a", rank: 1, pseudo: "Seul" }] }));
    expect(html.match(/<li/g)).toHaveLength(1);
  });

  it("classement vide : message au lieu d'une liste vide", () => {
    const html = renderToStaticMarkup(createElement(Classement, { rows: [], total: 10 }));
    expect(html).toContain("Personne d&#x27;autre au classement");
    expect(html).not.toContain("<ol");
  });

  it("classement : rang, pseudo et score sur le total", () => {
    const html = renderToStaticMarkup(
      createElement(Classement, { rows: [{ playerId: "r", rank: 4, pseudo: "Ruth", score: 6, isYou: true }], total: 10 }),
    );
    expect(html).toContain("Ruth (toi)");
    expect(html).toContain("6 / 10");
  });

  it("sépare les lignes par un filet pointillé tiré d'un jeton, sans style inline", () => {
    const html = renderToStaticMarkup(
      createElement(Classement, {
        rows: [
          { playerId: "a", rank: 1, pseudo: "A", score: 1 },
          { playerId: "b", rank: 2, pseudo: "B", score: 0 },
        ],
        total: 1,
      }),
    );
    expect(html).toContain("divide-y-2 divide-dashed divide-separateur");
    expect(html).not.toContain("style=");
  });
});

describe("ListeJoueurs", () => {
  const players = Array.from({ length: 10 }, (_, i) => ({ id: String(i), pseudo: `J${i}` }));

  it("résume le débordement en « + n autres »", () => {
    const html = renderToStaticMarkup(createElement(ListeJoueurs, { players, max: 7 }));
    expect(html).toContain("+ 3 autres");
    expect(html).not.toContain("J7");
  });

  it("met le dernier arrivé en avant", () => {
    const html = renderToStaticMarkup(createElement(ListeJoueurs, { players, newestId: "2" }));
    expect(html.match(/animate-pop/g)).toHaveLength(1);
  });
});

describe("Explication", () => {
  it("ne rend rien sans explication ni référence", () => {
    expect(renderToStaticMarkup(createElement(Explication, {}))).toBe("");
  });

  it("affiche l'explication et la référence", () => {
    const html = renderToStaticMarkup(createElement(Explication, { explanation: "Parce que.", reference: "Genèse 6:14-22" }));
    expect(html).toContain("Parce que.");
    expect(html).toContain("Genèse 6:14-22");
  });
});
