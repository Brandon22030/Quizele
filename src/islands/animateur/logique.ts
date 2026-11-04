import type { SessionState } from "../../client/realtime/session-state";
import { cleHote } from "../tableau-de-bord/logique";

export { urlBilan, urlPilotage } from "../tableau-de-bord/logique";

export interface JetonHote {
  code: string;
  token: string;
}

type StockageLecture = Pick<Storage, "getItem">;
type StockageEffacement = Pick<Storage, "removeItem">;

// Le jeton reste en sessionStorage pour qu'un rechargement de l'onglet reprenne sans appel serveur ; il disparaît avec l'onglet.
// Un autre onglet n'y a pas accès et repart de l'action jetonHote, qui revérifie le propriétaire.
export function lireJetonHote(stockage: StockageLecture | null, sessionId: string): JetonHote | null {
  if (!stockage) return null;
  try {
    const brut = stockage.getItem(cleHote(sessionId));
    if (brut === null) return null;
    const valeur: unknown = JSON.parse(brut);
    if (typeof valeur !== "object" || valeur === null) return null;
    const { code, hostToken } = valeur as { code?: unknown; hostToken?: unknown };
    return typeof code === "string" && code !== "" && typeof hostToken === "string" && hostToken !== "" ? { code, token: hostToken } : null;
  } catch {
    return null;
  }
}

// Jeton refusé ou partie finie : il ne servira plus, autant ne pas le garder.
export function oublierJetonHote(stockage: StockageEffacement | null, sessionId: string): void {
  try {
    stockage?.removeItem(cleHote(sessionId));
  } catch {
    // Stockage inaccessible : rien à effacer.
  }
}

// Construit depuis l'origine de la page : fonctionne en local comme sur workers.dev, sans adresse écrite en dur.
export const urlJoueur = (origine: string, code: string): string => `${origine}/j/${code}`;

export type VueHote = "chargement" | "rejete" | "termine" | "salle" | "question" | "correction" | "libre" | "fin";

// Une partie terminée dont la socket vient de se fermer garde son classement : la fin prime sur le statut de connexion.
export function vueHote(state: SessionState): VueHote {
  if (state.connection === "rejected" || state.connection === "kicked") return "rejete";
  if (state.phase === "finished") return "fin";
  if (state.connection === "ended") return "termine";
  switch (state.phase) {
    case "lobby":
      return "salle";
    case "question":
      return state.question ? "question" : "chargement";
    case "revealed":
      return state.question ? "correction" : "chargement";
    case "running":
    case "waiting":
      return "libre";
    default:
      return "chargement";
  }
}

export interface Commandes {
  demarrer: boolean;
  reveler: boolean;
  suivante: boolean;
  terminer: boolean;
}

// Le serveur refuse une commande hors phase (wrong_phase) : les boutons n'offrent que celles qui passeront. Hors connexion,
// rien n'est envoyé, car la file de la socket rejouerait des commandes périmées à la reprise.
export function commandesDisponibles(state: SessionState): Commandes {
  const ouverte = state.connection === "open";
  const phase = state.phase;
  return {
    demarrer: ouverte && phase === "lobby",
    reveler: ouverte && phase === "question",
    suivante: ouverte && phase === "revealed",
    terminer: ouverte && phase !== null && phase !== "finished",
  };
}

export const estModeLibre = (state: SessionState): boolean => state.mode === "own_pace";

export function libelleDemarrer(state: SessionState): string {
  return estModeLibre(state) ? "Lancer la partie" : "Lancer la première question";
}

export function libelleSuivante(state: SessionState): string {
  const question = state.question;
  return question && question.index + 1 >= question.total ? "Afficher les résultats" : "Question suivante";
}

export function libelleTerminer(state: SessionState): string {
  return estModeLibre(state) ? "Terminer la partie" : "Terminer et afficher les résultats";
}

export function libelleParticipants(n: number): string {
  if (n === 0) return "Aucun participant";
  return n === 1 ? "1 participant" : `${n} participants`;
}

export function libelleFinis(finis: number, total: number): string {
  return finis > 1 ? `${finis} joueurs sur ${total} ont fini` : `${finis} joueur sur ${total} a fini`;
}

export function titreVue(state: SessionState, vue: VueHote): string {
  switch (vue) {
    case "salle":
      return state.title;
    case "question":
    case "correction":
      return `Question ${(state.question?.index ?? 0) + 1} sur ${state.question?.total ?? 0}`;
    case "libre":
      return "Partie en cours";
    case "fin":
      return "Partie terminée";
    case "termine":
      return "Partie terminée";
    case "rejete":
      return "Pilotage impossible";
    default:
      return "Connexion à la partie";
  }
}

// Région persistante : le texte change à chaque phase, ce qui l'annonce sans que le focus ait à bouger.
export function annoncePhase(state: SessionState, vue: VueHote): string {
  switch (vue) {
    case "salle":
      return `En attente des joueurs. ${libelleParticipants(state.playerCount)}`;
    case "question":
      return titreVue(state, vue);
    case "correction":
      return "Correction affichée";
    case "libre":
      return `Partie en cours. ${libelleFinis(state.finishedCount, state.playerCount)}`;
    case "fin":
      return "Partie terminée, classement disponible";
    default:
      return "";
  }
}

export function lettre(index: number): string {
  return "ABCDEFGH"[index] ?? "?";
}

// Bonne(s) réponse(s) de la question en cours, sous la forme « B. Noé » (envoyées à l'hôte seulement à la révélation).
export function bonnesReponses(state: SessionState): string[] {
  const question = state.question;
  const justes = state.reveal?.correctOptionIds;
  if (!question || !justes) return [];
  return question.options.flatMap((option, index) => (justes.includes(option.id) ? [`${lettre(index)}. ${option.label}`] : []));
}

export const MESSAGES_ERREUR_SERVEUR: Record<string, string> = {
  save_failed: "La partie n'a pas pu être enregistrée. Réessaie de la terminer.",
  wrong_phase: "Cette action n'est plus possible à ce stade de la partie.",
  unknown_player: "Ce joueur a déjà quitté la partie.",
  forbidden: "Tu n'as pas le droit de piloter cette partie.",
};

export const messageErreurServeur = (code: string): string => MESSAGES_ERREUR_SERVEUR[code] ?? "Une erreur est survenue. Réessaie.";

export type EchecAcces = "introuvable" | "connexion" | "reseau" | "expire";

export interface MessageEchec {
  titre: string;
  texte: string;
  reessayer: boolean;
}

// Le serveur répond NOT_FOUND dans trois cas qu'il ne distingue volontairement pas : partie inconnue, partie d'un autre
// animateur, partie terminée. Le message les couvre tous plutôt que d'en confirmer un.
export function messageEchec(echec: EchecAcces): MessageEchec {
  switch (echec) {
    case "introuvable":
      return {
        titre: "Partie introuvable",
        texte: "Cette partie n'existe pas, est déjà terminée ou appartient à un autre animateur.",
        reessayer: false,
      };
    case "connexion":
      return { titre: "Connexion requise", texte: "Ta session a expiré. Connecte-toi de nouveau pour reprendre la partie.", reessayer: false };
    case "expire":
      return { titre: "Pilotage interrompu", texte: "Le lien de pilotage n'est plus valable. Recharge la page pour reprendre la main.", reessayer: true };
    case "reseau":
      return { titre: "Connexion impossible", texte: "Vérifie ta connexion puis réessaie.", reessayer: true };
  }
}

export function echecDepuisCode(code: string): EchecAcces {
  if (code === "NOT_FOUND") return "introuvable";
  if (code === "UNAUTHORIZED") return "connexion";
  return "reseau";
}
