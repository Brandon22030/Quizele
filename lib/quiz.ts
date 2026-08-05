import { createClient } from "@/lib/supabase/client";
import type {
  ClassementRow,
  MonResultatResult,
  OuvrirSessionResult,
  QuestionCouranteResult,
  RejoindreSessionResult,
  RepondreResult,
  StatsSessionRow,
} from "@/types/database";

const supabase = createClient();

export async function ouvrirSession(
  quizId: string
): Promise<OuvrirSessionResult> {
  const { data, error } = await supabase.rpc("ouvrir_session", {
    p_quiz: quizId,
  });

  if (error) throw error;

  const rows = data as unknown as OuvrirSessionResult[];
  if (!rows || rows.length === 0) {
    throw new Error("Aucune session retournée");
  }

  return rows[0];
}

export async function rejoindreSession(
  code: string,
  pseudo: string
): Promise<RejoindreSessionResult> {
  const { data, error } = await supabase.rpc("rejoindre_session", {
    p_code: code,
    p_pseudo: pseudo,
  });

  if (error) throw error;
  return data as unknown as RejoindreSessionResult;
}

export async function questionCourante(
  participantId: string
): Promise<QuestionCouranteResult> {
  const { data, error } = await supabase.rpc("question_courante", {
    p_participant: participantId,
  });

  if (error) throw error;
  return data as unknown as QuestionCouranteResult;
}

export async function repondre(
  participantId: string,
  questionId: string,
  options: string[] = [],
  texte: string | null = null
): Promise<RepondreResult> {
  const { data, error } = await supabase.rpc("repondre", {
    p_participant: participantId,
    p_question: questionId,
    p_options: options,
    p_texte: texte,
  });

  if (error) throw error;
  return data as unknown as RepondreResult;
}

export async function monResultat(
  participantId: string
): Promise<MonResultatResult> {
  const { data, error } = await supabase.rpc("mon_resultat", {
    p_participant: participantId,
  });

  if (error) throw error;
  return data as unknown as MonResultatResult;
}

export async function classement(
  sessionId: string,
  limite = 20
): Promise<ClassementRow[]> {
  const { data, error } = await supabase.rpc("classement", {
    p_session: sessionId,
    p_limite: limite,
  });

  if (error) throw error;
  return (data as unknown as ClassementRow[]) ?? [];
}

export async function pousserQuestion(
  sessionId: string,
  questionId: string
): Promise<void> {
  const { error } = await supabase.rpc("pousser_question", {
    p_session: sessionId,
    p_question: questionId,
  });

  if (error) throw error;
}

export async function fermerSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("fermer_session", {
    p_session: sessionId,
  });

  if (error) throw error;
}

export async function statsSession(
  sessionId: string
): Promise<StatsSessionRow[]> {
  const { data, error } = await supabase.rpc("stats_session", {
    p_session: sessionId,
  });

  if (error) throw error;
  return (data as unknown as StatsSessionRow[]) ?? [];
}
