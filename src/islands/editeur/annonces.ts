import type { StatutEnreg } from "./file-enregistrement";

// Ce que la région persistante dit au lecteur d'écran. La pilule change à chaque frappe (« Enregistrement… », « Enregistré ») :
// l'annoncer à chaque fois couvrirait la saisie. Seuls comptent un échec, une attente, et le retour à la normale après un échec.
export interface EtatAnnonce {
  texte: string;
  // Dernier problème annoncé : évite de répéter « Non enregistré » à chaque reprise automatique hors ligne.
  probleme: "echec" | "attente" | null;
}

export const ANNONCE_INITIALE: EtatAnnonce = { texte: "", probleme: null };

export function annoncerStatut(etat: EtatAnnonce, statut: StatutEnreg): EtatAnnonce {
  switch (statut) {
    case "echec":
      return etat.probleme === "echec" ? etat : { texte: "Non enregistré", probleme: "echec" };
    case "attente":
      return etat.probleme === "attente" ? etat : { texte: "En attente", probleme: "attente" };
    case "enregistre":
      if (etat.probleme === "echec") return { texte: "Enregistré", probleme: null };
      // Attente levée (titre rempli) : rien à annoncer, mais le texte périmé ne doit pas rester lisible dans la région.
      return etat.probleme === "attente" ? ANNONCE_INITIALE : etat;
    case "en_cours":
      return etat;
  }
}
