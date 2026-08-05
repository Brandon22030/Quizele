export type QuestionType = "unique" | "multiple" | "vrai_faux";

export type EditableOption = {
  id: string;
  libelle: string;
  est_correcte: boolean;
  ordre: number;
  isNew?: boolean;
};

export type EditableQuestion = {
  id: string;
  enonce: string;
  type: QuestionType;
  duree_sec: number;
  points: number;
  reference_biblique: string | null;
  explication: string | null;
  indice: string | null;
  ordre: number;
  options: EditableOption[];
  isNew?: boolean;
};

export type EditableQuiz = {
  id: string;
  titre: string;
  description: string;
  categorie: string;
  mode: "libre" | "synchronise";
  aleatoire_questions: boolean;
  aleatoire_options: boolean;
  correction_immediate: boolean;
  bonus_rapidite: boolean;
  statut: "brouillon" | "publie" | "archive";
};

export type ValidationError = {
  questionId: string;
  message: string;
};
