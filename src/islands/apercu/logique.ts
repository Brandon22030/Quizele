import type { QuestionKind } from "../../shared/protocol";

export interface OptionApercu {
  id: string;
  label: string;
  isCorrect: boolean;
}

export interface QuestionApercu {
  id: string;
  type: QuestionKind;
  prompt: string;
  durationSec: number;
  reference: string | null;
  explanation: string | null;
  options: OptionApercu[];
}

export interface DonneesApercu {
  quizId: string;
  title: string;
  showCorrectAnswer: boolean;
  questions: QuestionApercu[];
}

export type EtatApercu =
  | { etat: "chargement" }
  | { etat: "erreur"; message: string; reessayable: boolean }
  | { etat: "pret"; donnees: DonneesApercu };

export const MESSAGE_RESEAU = "Connexion impossible. Vérifie ta connexion puis réessaie.";

export const LETTRES = "ABCDEFGH";

export const urlEditeur = (quizId: string): string => `/quiz/${encodeURIComponent(quizId)}`;

// Une question sans bonne réponse cochée (brouillon) n'est jamais juste : l'aperçu le montre tel que la salle le vivrait.
export function estJuste(question: QuestionApercu, choix: readonly string[]): boolean {
  const justes = question.options.filter((o) => o.isCorrect).map((o) => o.id);
  return justes.length > 0 && justes.length === choix.length && justes.every((id) => choix.includes(id));
}

export function messageVerdict(juste: boolean, choix: readonly string[]): string {
  if (juste) return "+1 bonne réponse. Rien n'est compté dans l'aperçu.";
  if (choix.length === 0) return "Temps écoulé sans réponse. La bonne réponse est affichée ci-dessous.";
  return "Pas de panique, la bonne réponse est affichée ci-dessous.";
}

export const PROMPT_VIDE = "Cette question n'a pas encore d'énoncé.";
export const LIBELLE_VIDE = "Réponse à compléter";
