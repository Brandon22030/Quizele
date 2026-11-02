import { describe, expect, it } from "vitest";
import { annonceDeplacement, decalerCle, deplacer, indexSousPointeur } from "../../../src/islands/editeur/ordre";

describe("réordonnancement au clavier", () => {
  const cles = ["q1", "q2", "q3", "q4"];

  it("flèche bas descend la question d'un rang", () => {
    expect(decalerCle(cles, "q2", 1)).toEqual(["q1", "q3", "q2", "q4"]);
  });

  it("flèche haut la remonte d'un rang", () => {
    expect(decalerCle(cles, "q3", -1)).toEqual(["q1", "q3", "q2", "q4"]);
  });

  it("en butée, l'ordre ne change pas", () => {
    expect(decalerCle(cles, "q1", -1)).toEqual(cles);
    expect(decalerCle(cles, "q4", 1)).toEqual(cles);
  });

  it("une clé inconnue ne change rien", () => {
    expect(decalerCle(cles, "zz", 1)).toEqual(cles);
  });

  it("ne modifie jamais la liste d'origine", () => {
    const copie = [...cles];
    decalerCle(cles, "q1", 1);
    expect(cles).toEqual(copie);
  });

  it("annonce la nouvelle position pour les lecteurs d'écran", () => {
    expect(annonceDeplacement(2, 5)).toBe("Question déplacée en position 2 sur 5.");
  });
});

describe("glisser", () => {
  it("deplacer borne la destination", () => {
    expect(deplacer([1, 2, 3], 0, 9)).toEqual([2, 3, 1]);
    expect(deplacer([1, 2, 3], 2, -4)).toEqual([3, 1, 2]);
    expect(deplacer([1, 2, 3], 7, 0)).toEqual([1, 2, 3]);
  });

  it("trouve la ligne sous le pointeur et borne hors de la liste", () => {
    const bandes = [
      { top: 0, bottom: 60 },
      { top: 70, bottom: 130 },
      { top: 140, bottom: 200 },
    ];
    expect(indexSousPointeur(bandes, 30)).toBe(0);
    expect(indexSousPointeur(bandes, 100)).toBe(1);
    // L'espace entre deux lignes reste sur la ligne du dessus.
    expect(indexSousPointeur(bandes, 65)).toBe(0);
    expect(indexSousPointeur(bandes, 135)).toBe(1);
    expect(indexSousPointeur(bandes, -20)).toBe(0);
    expect(indexSousPointeur(bandes, 500)).toBe(2);
    expect(indexSousPointeur([], 10)).toBe(-1);
  });
});
