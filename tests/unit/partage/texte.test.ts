import { describe, expect, it } from "vitest";
import { fitText, graphemes, truncateGraphemes, wrapLines } from "../../../src/client/partage/texte";

// Mesure simulée : 10 unités par code point, sans canvas.
const mesure = (texte: string) => Array.from(texte).length * 10;

describe("partage : découpe du texte", () => {
  it("garde un texte qui tient", () => {
    expect(fitText(mesure, "Esther", 100)).toBe("Esther");
  });

  it("coupe avec une ellipse sans dépasser la largeur", () => {
    const coupe = fitText(mesure, "Ruth-Marie-Joséphine", 100);
    expect(coupe.endsWith("…")).toBe(true);
    expect(mesure(coupe)).toBeLessThanOrEqual(100);
  });

  it("normalise les espaces et ne laisse pas d'espace avant l'ellipse", () => {
    expect(fitText(mesure, "  Marie    Ange   Grâce  ", 100)).not.toMatch(/ …$/);
  });

  it("ne sépare jamais un emoji composé", () => {
    const famille = "👨‍👩‍👧‍👦";
    expect(graphemes(famille)).toHaveLength(1);
    expect(truncateGraphemes(`${famille}${famille}${famille}`, 2)).toBe(`${famille}…`);
    const coupe = fitText((t) => graphemes(t).length * 10, `${famille}${famille}${famille}${famille}`, 30);
    expect(coupe).toBe(`${famille}${famille}…`);
  });

  it("tronque par nombre de graphèmes", () => {
    expect(truncateGraphemes("abc", 5)).toBe("abc");
    expect(truncateGraphemes("abcdef", 4)).toBe("abc…");
    expect(truncateGraphemes("abc", 0)).toBe("");
  });

  it("retourne l'ellipse seule quand rien ne tient", () => {
    expect(fitText(mesure, "Grâce", 10)).toBe("…");
  });

  it("renvoie à la ligne et borne le nombre de lignes", () => {
    const lignes = wrapLines(mesure, "un deux trois quatre cinq six sept huit", 80, 2);
    expect(lignes).toHaveLength(2);
    for (const ligne of lignes) expect(mesure(ligne)).toBeLessThanOrEqual(80);
    expect(lignes[1].endsWith("…")).toBe(true);
  });
});
