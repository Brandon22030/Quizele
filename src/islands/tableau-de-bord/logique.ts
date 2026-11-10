export interface QuizCarte {
  id: string;
  title: string;
  updatedAt: Date;
  questionCount: number;
  status: { ready: boolean; label: string; incompleteCount: number };
}

export interface PartieJouee {
  id: string;
  quizTitle: string;
  /** ISO 8601 : la page serveur sérialise la date, l'îlot la formate dans le fuseau du navigateur. */
  jouee: string;
  playerCount: number;
}

export interface ModeleCarte {
  id: string;
  title: string;
  category: string | null;
  questionCount: number;
}

export type EtatListe<T> = { etat: "chargement" } | { etat: "erreur"; message: string } | { etat: "pret"; elements: T[] };

export interface ErreurLancement {
  quizId: string;
  message: string;
  /** Le quiz est incomplet : le message renvoie à l'éditeur plutôt qu'à une nouvelle tentative. */
  incomplet: boolean;
}

export type OngletId = "quiz" | "parties";

// Clé lue par la page de pilotage (QZ-002-16) : le jeton hôte ne passe jamais par l'URL.
export const cleHote = (sessionId: string): string => `quizdeszeles:hote:${sessionId}`;

export interface LancementReussi {
  sessionId: string;
  code: string;
  hostToken: string;
}

type StockageEcriture = Pick<Storage, "setItem">;

// Stockage refusé (navigation privée stricte) : la page de pilotage redemande un jeton hôte à l'action jetonHote.
export function memoriserHote(stockage: StockageEcriture | null, lancement: LancementReussi): void {
  try {
    stockage?.setItem(cleHote(lancement.sessionId), JSON.stringify({ code: lancement.code, hostToken: lancement.hostToken }));
  } catch {
    // Le repli par jetonHote couvre ce cas.
  }
}

export const urlPilotage = (sessionId: string): string => `/partie/${encodeURIComponent(sessionId)}`;
export const urlBilan = (sessionId: string): string => `/partie/${encodeURIComponent(sessionId)}/bilan`;
export const urlEditeur = (quizId: string): string => `/quiz/${encodeURIComponent(quizId)}`;

export function erreurLancement(quizId: string, code: string, message: string): ErreurLancement {
  return { quizId, message, incomplet: code === "BAD_REQUEST" };
}

export function libelleQuestions(n: number): string {
  if (n === 0) return "Aucune question";
  return n === 1 ? "1 question" : `${n} questions`;
}

export function libelleJoueurs(n: number): string {
  if (n === 0) return "Aucun joueur";
  return n === 1 ? "1 joueur" : `${n} joueurs`;
}

const formatCourt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const formatLong = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export const dateCourte = (date: Date): string => formatCourt.format(date);
export const dateLongue = (date: Date): string => formatLong.format(date);

/** Jour et mois abrégé affichés dans la pastille d'une partie jouée : « 08 » et « nov. ». */
export function jourMois(date: Date): { jour: string; mois: string } {
  const [jour = "", mois = ""] = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(date).split(" ");
  return { jour, mois };
}

export function titreOnglet(onglet: OngletId, nbQuiz: number | null): string {
  if (onglet === "parties") return "Parties jouées";
  return nbQuiz === null ? "Mes quiz" : `Mes quiz (${nbQuiz})`;
}

export function descriptionModele(modele: ModeleCarte): string {
  const questions = libelleQuestions(modele.questionCount);
  return modele.category ? `${questions}, ${modele.category}` : questions;
}
