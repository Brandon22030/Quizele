/*
 * Types générés à la main depuis le schéma SQL fourni.
 * Pour les régénérer automatiquement : npm run gen:types
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type QuizMode = "libre" | "synchronise";
export type QuizVisibilite = "lien" | "public";
export type QuizStatut = "brouillon" | "publie" | "archive";
export type QuestionType = "unique" | "multiple" | "vrai_faux" | "texte";
export type SessionStatut = "attente" | "ouverte" | "fermee";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          pseudo: string;
          nom_groupe: string | null;
          avatar_url: string | null;
          cree_le: string;
        };
        Insert: {
          id: string;
          pseudo: string;
          nom_groupe?: string | null;
          avatar_url?: string | null;
          cree_le?: string;
        };
        Update: {
          id?: string;
          pseudo?: string;
          nom_groupe?: string | null;
          avatar_url?: string | null;
          cree_le?: string;
        };
      };
      quizzes: {
        Row: {
          id: string;
          auteur_id: string;
          titre: string;
          description: string | null;
          categorie: string | null;
          couverture_url: string | null;
          mode: QuizMode;
          aleatoire_questions: boolean;
          aleatoire_options: boolean;
          correction_immediate: boolean;
          bonus_rapidite: boolean;
          visibilite: QuizVisibilite;
          statut: QuizStatut;
          cree_le: string;
          maj_le: string;
        };
        Insert: {
          id?: string;
          auteur_id: string;
          titre: string;
          description?: string | null;
          categorie?: string | null;
          couverture_url?: string | null;
          mode?: QuizMode;
          aleatoire_questions?: boolean;
          aleatoire_options?: boolean;
          correction_immediate?: boolean;
          bonus_rapidite?: boolean;
          visibilite?: QuizVisibilite;
          statut?: QuizStatut;
          cree_le?: string;
          maj_le?: string;
        };
        Update: {
          id?: string;
          auteur_id?: string;
          titre?: string;
          description?: string | null;
          categorie?: string | null;
          couverture_url?: string | null;
          mode?: QuizMode;
          aleatoire_questions?: boolean;
          aleatoire_options?: boolean;
          correction_immediate?: boolean;
          bonus_rapidite?: boolean;
          visibilite?: QuizVisibilite;
          statut?: QuizStatut;
          cree_le?: string;
          maj_le?: string;
        };
      };
      questions: {
        Row: {
          id: string;
          quiz_id: string;
          ordre: number;
          type: QuestionType;
          enonce: string;
          image_url: string | null;
          duree_sec: number;
          points: number;
          reference_biblique: string | null;
          explication: string | null;
          indice: string | null;
          reponses_texte: string[] | null;
        };
        Insert: {
          id?: string;
          quiz_id: string;
          ordre?: number;
          type?: QuestionType;
          enonce: string;
          image_url?: string | null;
          duree_sec?: number;
          points?: number;
          reference_biblique?: string | null;
          explication?: string | null;
          indice?: string | null;
          reponses_texte?: string[] | null;
        };
        Update: {
          id?: string;
          quiz_id?: string;
          ordre?: number;
          type?: QuestionType;
          enonce?: string;
          image_url?: string | null;
          duree_sec?: number;
          points?: number;
          reference_biblique?: string | null;
          explication?: string | null;
          indice?: string | null;
          reponses_texte?: string[] | null;
        };
      };
      options: {
        Row: {
          id: string;
          question_id: string;
          libelle: string;
          est_correcte: boolean;
          ordre: number;
        };
        Insert: {
          id?: string;
          question_id: string;
          libelle: string;
          est_correcte?: boolean;
          ordre?: number;
        };
        Update: {
          id?: string;
          question_id?: string;
          libelle?: string;
          est_correcte?: boolean;
          ordre?: number;
        };
      };
      sessions: {
        Row: {
          id: string;
          quiz_id: string;
          code_court: string;
          statut: SessionStatut;
          mode: QuizMode;
          correction_immediate: boolean;
          bonus_rapidite: boolean;
          aleatoire_questions: boolean;
          aleatoire_options: boolean;
          question_courante_id: string | null;
          question_courante_debut: string | null;
          reponses_reveles_le: string | null;
          resultats_reveles: boolean;
          ouverte_le: string;
          fermee_le: string | null;
        };
        Insert: {
          id?: string;
          quiz_id: string;
          code_court: string;
          statut?: SessionStatut;
          mode: QuizMode;
          correction_immediate: boolean;
          bonus_rapidite: boolean;
          aleatoire_questions: boolean;
          aleatoire_options: boolean;
          question_courante_id?: string | null;
          question_courante_debut?: string | null;
          reponses_reveles_le?: string | null;
          resultats_reveles?: boolean;
          ouverte_le?: string;
          fermee_le?: string | null;
        };
        Update: {
          id?: string;
          quiz_id?: string;
          code_court?: string;
          statut?: SessionStatut;
          mode?: QuizMode;
          correction_immediate?: boolean;
          bonus_rapidite?: boolean;
          aleatoire_questions?: boolean;
          aleatoire_options?: boolean;
          question_courante_id?: string | null;
          question_courante_debut?: string | null;
          reponses_reveles_le?: string | null;
          resultats_reveles?: boolean;
          ouverte_le?: string;
          fermee_le?: string | null;
        };
      };
      participants: {
        Row: {
          id: string;
          session_id: string;
          user_id: string | null;
          pseudo: string;
          ordre_questions: string[];
          index_courant: number;
          question_servie_id: string | null;
          servie_le: string | null;
          score_total: number;
          temps_total_ms: number;
          termine_le: string | null;
          cree_le: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id?: string | null;
          pseudo: string;
          ordre_questions?: string[];
          index_courant?: number;
          question_servie_id?: string | null;
          servie_le?: string | null;
          score_total?: number;
          temps_total_ms?: number;
          termine_le?: string | null;
          cree_le?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          user_id?: string | null;
          pseudo?: string;
          ordre_questions?: string[];
          index_courant?: number;
          question_servie_id?: string | null;
          servie_le?: string | null;
          score_total?: number;
          temps_total_ms?: number;
          termine_le?: string | null;
          cree_le?: string;
        };
      };
      reponses: {
        Row: {
          id: string;
          participant_id: string;
          question_id: string;
          options_choisies: string[];
          texte_saisi: string | null;
          est_correcte: boolean;
          points_obtenus: number;
          temps_ms: number;
          hors_delai: boolean;
          repondu_le: string;
        };
        Insert: {
          id?: string;
          participant_id: string;
          question_id: string;
          options_choisies?: string[];
          texte_saisi?: string | null;
          est_correcte?: boolean;
          points_obtenus?: number;
          temps_ms?: number;
          hors_delai?: boolean;
          repondu_le?: string;
        };
        Update: {
          id?: string;
          participant_id?: string;
          question_id?: string;
          options_choisies?: string[];
          texte_saisi?: string | null;
          est_correcte?: boolean;
          points_obtenus?: number;
          temps_ms?: number;
          hors_delai?: boolean;
          repondu_le?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      normaliser: {
        Args: { t: string };
        Returns: string;
      };
      generer_code: {
        Args: Record<string, never>;
        Returns: string;
      };
      touch_maj_le: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      est_auteur_du_quiz: {
        Args: { p_quiz: string };
        Returns: boolean;
      };
      est_dans_session: {
        Args: { p_session: string };
        Returns: boolean;
      };
      ouvrir_session: {
        Args: { p_quiz: string };
        Returns: OuvrirSessionResult[];
      };
      rejoindre_session: {
        Args: { p_code: string; p_pseudo: string };
        Returns: Json;
      };
      question_courante: {
        Args: { p_participant: string };
        Returns: Json;
      };
      repondre: {
        Args: {
          p_participant: string;
          p_question: string;
          p_options?: string[];
          p_texte?: string;
        };
        Returns: Json;
      };
      mon_resultat: {
        Args: { p_participant: string };
        Returns: Json;
      };
      classement: {
        Args: { p_session: string; p_limite?: number };
        Returns: ClassementRow[];
      };
      pousser_question: {
        Args: { p_session: string; p_question: string };
        Returns: void;
      };
      valider_question: {
        Args: { p_session: string };
        Returns: void;
      };
      reinitialiser_revele: {
        Args: { p_session: string };
        Returns: void;
      };
      terminer_session: {
        Args: { p_session: string };
        Returns: void;
      };
      fermer_session: {
        Args: { p_session: string };
        Returns: void;
      };
      stats_session: {
        Args: { p_session: string };
        Returns: StatsSessionRow[];
      };
    };
    Enums: Record<string, never>;
  };
}

export type OuvrirSessionResult = {
  session_id: string;
  code_court: string;
};

export type RejoindreSessionResult = {
  participant_id: string;
  session_id: string;
  pseudo: string;
  reprise: boolean;
  index_courant: number;
  total: number;
};

export type QuestionOption = {
  id: string;
  libelle: string;
};

export type QuestionCouranteFini = {
  fini: true;
  total: number;
  score_total: number;
};

export type QuestionCouranteActive = {
  fini: false;
  index: number;
  total: number;
  question: {
    id: string;
    type: QuestionType;
    enonce: string;
    image_url: string | null;
    duree_sec: number;
    points: number;
    indice: string | null;
  };
  options: QuestionOption[];
  servie_le: string;
  expire_le: string;
  maintenant: string;
};

export type QuestionCouranteResult =
  | QuestionCouranteFini
  | QuestionCouranteActive;

export type RepondreResult = {
  points_obtenus: number;
  bonus: number;
  est_correcte: boolean;
  hors_delai: boolean;
  score_total: number;
  fini: boolean;
  correction?: {
    bonnes_options: string[];
    explication: string | null;
    reference_biblique: string | null;
  };
};

export type DetailReponse = {
  enonce: string;
  type: QuestionType;
  ma_reponse: string | string[];
  bonne_reponse: string | string[];
  est_correcte: boolean;
  points_obtenus: number;
  explication: string | null;
  reference_biblique: string | null;
};

export type MonResultatResult = {
  pseudo: string;
  score_total: number;
  temps_total_ms: number;
  rang: number;
  nb_participants: number;
  bonnes_reponses: number;
  total_questions: number;
  detail: DetailReponse[];
};

export type ClassementRow = {
  rang: number;
  pseudo: string;
  score_total: number;
  temps_total_ms: number;
  termine: boolean;
};

export type StatsSessionRow = {
  question_id: string;
  enonce: string;
  taux_reussite: number;
  nb_reponses: number;
};
