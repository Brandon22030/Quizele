import { describe, expect, it } from "vitest";
import { ANNONCE_INITIALE, annoncerStatut, type EtatAnnonce } from "../../../src/islands/editeur/annonces";
import type { StatutEnreg } from "../../../src/islands/editeur/file-enregistrement";

// Rejoue une suite de statuts et relève chaque texte nouveau, comme un lecteur d'écran qui n'annonce qu'un changement.
function annonces(statuts: StatutEnreg[]): string[] {
  const dites: string[] = [];
  let etat: EtatAnnonce = ANNONCE_INITIALE;
  for (const s of statuts) {
    const suivant = annoncerStatut(etat, s);
    if (suivant.texte !== etat.texte && suivant.texte !== "") dites.push(suivant.texte);
    etat = suivant;
  }
  return dites;
}

describe("annonces du statut d'enregistrement", () => {
  it("un enregistrement normal n'annonce rien, même répété à chaque frappe", () => {
    expect(annonces(["en_cours", "enregistre", "en_cours", "enregistre", "en_cours", "enregistre"])).toEqual([]);
  });

  it("un échec est annoncé une fois, malgré les reprises automatiques, puis « Enregistré » une seule fois au retour", () => {
    expect(annonces(["en_cours", "echec", "en_cours", "echec", "en_cours", "echec", "en_cours", "enregistre", "en_cours", "enregistre"])).toEqual([
      "Non enregistré",
      "Enregistré",
    ]);
  });

  it("une attente est annoncée une fois ; sa levée n'annonce rien et efface le texte périmé", () => {
    let etat = annoncerStatut(ANNONCE_INITIALE, "attente");
    expect(etat.texte).toBe("En attente");
    expect(annoncerStatut(annoncerStatut(etat, "en_cours"), "attente")).toBe(etat);
    etat = annoncerStatut(etat, "enregistre");
    expect(etat).toEqual(ANNONCE_INITIALE);
  });

  it("un nouvel échec après un retour à la normale est de nouveau annoncé", () => {
    expect(annonces(["echec", "enregistre", "en_cours", "echec", "enregistre"])).toEqual(["Non enregistré", "Enregistré", "Non enregistré", "Enregistré"]);
  });

  it("échec puis attente : les deux sont annoncés, et pas de « Enregistré » après l'attente seule", () => {
    expect(annonces(["echec", "en_cours", "attente", "en_cours", "enregistre"])).toEqual(["Non enregistré", "En attente"]);
  });
});
