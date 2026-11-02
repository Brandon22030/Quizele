import { CATEGORY_MAX, LONG_TEXT_MAX, type GameMode } from "../../shared/quiz-schema";

export { CATEGORY_MAX, LONG_TEXT_MAX };

export interface Reglages {
  mode: GameMode;
  showCorrectAnswer: boolean;
  shuffle: boolean;
  description: string;
  category: string;
}

export type PatchReglages = Partial<Reglages>;

export type EtatChargement<T> = { etat: "chargement" } | { etat: "erreur"; message: string; reessayable: boolean } | { etat: "pret"; donnees: T };

export type StatutEnregistrement =
  | { etat: "repos" }
  | { etat: "enregistrement" }
  | { etat: "enregistre" }
  | { etat: "echec"; message: string };

export const MESSAGE_RESEAU = "Connexion impossible. Vérifie ta connexion puis réessaie.";

export const urlEditeur = (quizId: string): string => `/quiz/${encodeURIComponent(quizId)}`;

export function libelleStatut(statut: StatutEnregistrement): string {
  switch (statut.etat) {
    case "enregistrement":
      return "Enregistrement…";
    case "enregistre":
      return "Enregistré";
    case "echec":
      return "Non enregistré";
    default:
      return "";
  }
}

// Résultat d'un envoi : null si réussi, sinon le message affichable.
export type Envoi = (patch: PatchReglages) => Promise<string | null>;

export interface FileEnregistrement {
  pousser(patch: PatchReglages): void;
  reessayer(): void;
  enEchec(): boolean;
  /** Résout quand plus rien n'est en attente ni en vol (succès ou échec). */
  attendre(): Promise<void>;
}

// Un seul envoi à la fois : les changements faits pendant un envoi sont fusionnés, le dernier gagne. Sans cette
// sérialisation, deux requêtes parallèles pourraient arriver dans le désordre et réécrire une ancienne valeur.
export function creerFileEnregistrement(envoyer: Envoi, surStatut: (statut: StatutEnregistrement) => void): FileEnregistrement {
  let enAttente: PatchReglages = {};
  let enVol = false;
  let echec = false;
  let attentes: Array<() => void> = [];

  const termine = () => {
    const resolues = attentes;
    attentes = [];
    resolues.forEach((resoudre) => resoudre());
  };

  async function vider(): Promise<void> {
    if (enVol || Object.keys(enAttente).length === 0) return;
    const patch = enAttente;
    enAttente = {};
    enVol = true;
    surStatut({ etat: "enregistrement" });
    let message: string | null;
    try {
      message = await envoyer(patch);
    } catch {
      message = MESSAGE_RESEAU;
    }
    enVol = false;
    if (message !== null) {
      // Les valeurs plus récentes saisies pendant l'envoi restent prioritaires sur celles qui ont échoué.
      enAttente = { ...patch, ...enAttente };
      echec = true;
      surStatut({ etat: "echec", message });
      termine();
      return;
    }
    echec = false;
    if (Object.keys(enAttente).length > 0) {
      await vider();
      return;
    }
    surStatut({ etat: "enregistre" });
    termine();
  }

  return {
    pousser(patch) {
      enAttente = { ...enAttente, ...patch };
      void vider();
    },
    reessayer() {
      if (echec) void vider();
    },
    enEchec: () => echec,
    attendre() {
      if (!enVol && Object.keys(enAttente).length === 0) return Promise.resolve();
      return new Promise((resolve) => {
        attentes.push(resolve);
        void vider();
      });
    },
  };
}

export interface DonneesReglages extends Reglages {
  quizId: string;
  title: string;
}

// Ce que la région persistante dit au lecteur d'écran : seuls « Non enregistré » et le retour à la normale comptent. La
// pilule change à chaque frappe ; l'annoncer à chaque fois couvrirait la saisie.
export interface EtatAnnonce {
  texte: string;
  echec: boolean;
}

export const ANNONCE_INITIALE: EtatAnnonce = { texte: "", echec: false };

export function annoncerStatut(etat: EtatAnnonce, statut: StatutEnregistrement): EtatAnnonce {
  if (statut.etat === "echec") return etat.echec ? etat : { texte: "Non enregistré", echec: true };
  if (statut.etat === "enregistre") return etat.echec ? { texte: "Enregistré", echec: false } : etat;
  return etat;
}

export const URL_MAJ_REGLAGES = "/_actions/quiz.majReglages";

// Envoi de dernier recours à la fermeture de la page : keepalive laisse la requête finir après le déchargement. Même
// endpoint et même corps JSON que le client des Actions Astro, donc mêmes contrôles d'origine et de session côté serveur.
export function envoyerALaSortie(quizId: string, patch: PatchReglages, envoyer: typeof fetch = fetch): void {
  if (Object.keys(patch).length === 0) return;
  void envoyer(URL_MAJ_REGLAGES, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quizId, ...patch }),
    keepalive: true,
  }).catch(() => {});
}
