import { createClient } from "@/lib/supabase/client";

export type CorrectionItem = {
  question_id: string;
  ordre: number;
  enonce: string;
  is_correct: boolean;
  ma_reponse: string[];
  bonne_reponse: string[];
  explication: string | null;
  reference_biblique: string | null;
};

export type ResultData = {
  participant_id: string;
  pseudo: string;
  score: number;
  bonnes_reponses: number;
  total_questions: number;
  temps_total_ms: number;
  rang: number;
  total_participants: number;
  session_id: string;
  quiz_titre: string;
  quiz_description: string | null;
  corrections: CorrectionItem[];
};

export type LeaderboardEntry = {
  rang: number;
  pseudo: string;
  score: number;
};

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === null || value === undefined) return [];
  return [String(value)];
}

export function parseResultData(
  participantId: string,
  row: Record<string, unknown>
): ResultData {
  const detail = ((row.detail as Record<string, unknown>[]) ?? []).map(
    (item, index) => ({
      question_id: String(index),
      ordre: index + 1,
      enonce: (item.enonce as string) ?? "",
      is_correct: (item.est_correcte as boolean) ?? false,
      ma_reponse: toStringArray(item.ma_reponse),
      bonne_reponse: toStringArray(item.bonne_reponse),
      explication: (item.explication as string | null) ?? null,
      reference_biblique: (item.reference_biblique as string | null) ?? null,
    })
  );

  return {
    participant_id: participantId,
    pseudo: (row.pseudo as string) ?? "Participant",
    score: (row.score_total as number) ?? 0,
    bonnes_reponses: (row.bonnes_reponses as number) ?? 0,
    total_questions: (row.total_questions as number) ?? 0,
    temps_total_ms: (row.temps_total_ms as number) ?? 0,
    rang: (row.rang as number) ?? 0,
    total_participants: (row.nb_participants as number) ?? 0,
    session_id: (row.session_id as string) ?? "",
    quiz_titre: (row.quiz_titre as string) ?? "Quiz",
    quiz_description: (row.quiz_description as string | null) ?? null,
    corrections: detail,
  };
}

export async function fetchResult(
  participantId: string
): Promise<ResultData | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("mon_resultat", {
    p_participant: participantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return parseResultData(participantId, data as Record<string, unknown>);
}

export async function fetchLeaderboard(
  sessionId: string
): Promise<LeaderboardEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("classement", {
    p_session: sessionId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    rang: (row.rang as number) ?? 0,
    pseudo: (row.pseudo as string) ?? "",
    score: (row.score_total as number) ?? 0,
  }));
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes === 0) return `${remaining}s`;
  return `${minutes} min ${remaining.toString().padStart(2, "0")}s`;
}

export function getEncouragement(percentage: number): string {
  if (percentage >= 80) {
    return "Excellente connaissance ! Tu as brillé sur ce quiz.";
  }
  if (percentage >= 60) {
    return "Très solide ! Tu maîtrises vraiment le sujet.";
  }
  if (percentage >= 40) {
    return "Beau progrès ! Tu connais déjà pas mal de choses.";
  }
  if (percentage >= 20) {
    return "Tu as déjà quelques repères. La prochaine fois sera plus forte !";
  }
  return "Chaque question est une occasion d'apprendre. Continue d'explorer !";
}
