import { describe, expect, it } from "vitest";
import { brouillonVierge, changerTitre } from "../../../src/islands/editeur/modele";
import { brouillonsNouveaux, cleStockage, ecrireBrouillon, effacerBrouillon, lireBrouillon, type Stockage } from "../../../src/islands/editeur/stockage";

function stockageComplet(): Stockage & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>();
  return {
    donnees,
    getItem: (c) => donnees.get(c) ?? null,
    setItem: (c, v) => void donnees.set(c, v),
    removeItem: (c) => void donnees.delete(c),
    get length() {
      return donnees.size;
    },
    key: (i) => [...donnees.keys()][i] ?? null,
  };
}

describe("brouillons de nouveaux quiz, un par onglet", () => {
  it("deux sessions sur /quiz/nouveau ne s'écrasent pas", () => {
    const stockage = stockageComplet();
    ecrireBrouillon(stockage, changerTitre(brouillonVierge(), "Onglet A"), "sa");
    ecrireBrouillon(stockage, changerTitre(brouillonVierge(), "Onglet B"), "sb");
    expect(cleStockage(null, "sa")).not.toBe(cleStockage(null, "sb"));
    expect(lireBrouillon(stockage, null, "sa")?.title).toBe("Onglet A");
    expect(lireBrouillon(stockage, null, "sb")?.title).toBe("Onglet B");
    effacerBrouillon(stockage, null, "sa");
    expect(lireBrouillon(stockage, null, "sa")).toBeNull();
    expect(lireBrouillon(stockage, null, "sb")?.title).toBe("Onglet B");
  });

  it("liste les brouillons de nouveaux quiz du plus récent au plus ancien, sans les quiz existants ni les entrées illisibles", () => {
    const stockage = stockageComplet();
    const ecrire = (session: string, titre: string, t: number) =>
      stockage.setItem(cleStockage(null, session), JSON.stringify({ v: 1, brouillon: changerTitre(brouillonVierge(), titre), t }));
    ecrire("ancien", "Ancien", 100);
    ecrire("recent", "Récent", 300);
    ecrire("milieu", "Milieu", 200);
    stockage.setItem(cleStockage(null, "casse"), "{pas du json");
    ecrireBrouillon(stockage, { ...changerTitre(brouillonVierge(), "Existant"), quizId: "quiz1" });
    stockage.setItem("autre-application", "x");
    expect(brouillonsNouveaux(stockage).map((e) => [e.session, e.brouillon.title])).toEqual([
      ["recent", "Récent"],
      ["milieu", "Milieu"],
      ["ancien", "Ancien"],
    ]);
  });

  it("un stockage sans énumération (ou absent) ne trouve aucun brouillon, sans lever", () => {
    expect(brouillonsNouveaux(null)).toEqual([]);
    const partiel: Stockage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(brouillonsNouveaux(partiel)).toEqual([]);
  });
});
