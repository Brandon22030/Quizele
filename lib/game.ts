import { createClient } from "@/lib/supabase/client";

export type GameQuestion = {
  id: string;
  ordre: number;
  total_questions: number;
  enonce: string;
  type: "unique" | "multiple" | "vrai_faux" | "texte";
  duree_sec: number;
  points: number;
  indice: string | null;
  options: {
    id: string;
    libelle: string;
  }[];
  started_at: string;
  server_now: string;
};

export async function fetchCurrentQuestion(
  participantId: string
): Promise<GameQuestion | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("question_courante", {
    p_participant: participantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = data as Record<string, unknown> | null;
  if (!row) {
    return null;
  }

  if (row.fini === true) {
    return null;
  }

  const question = (row.question as Record<string, unknown>) ?? {};
  const options = (row.options as Record<string, unknown>[]) ?? [];

  return {
    id: question.id as string,
    ordre: (row.index as number) ?? 0,
    total_questions: (row.total as number) ?? 0,
    enonce: (question.enonce as string) ?? "",
    type: (question.type as GameQuestion["type"]) ?? "unique",
    duree_sec: (question.duree_sec as number) ?? 20,
    points: (question.points as number) ?? 0,
    indice: (question.indice as string | null) ?? null,
    options: options.map((o) => ({
      id: o.id as string,
      libelle: (o.libelle as string) ?? "",
    })),
    started_at: (row.servie_le as string) ?? new Date().toISOString(),
    server_now: (row.maintenant as string) ?? new Date().toISOString(),
  };
}

export type AnswerResult = {
  is_correct: boolean;
  points_gagnes: number;
  bonnes_reponses: string[];
  explication: string | null;
  reference_biblique: string | null;
  is_finished: boolean;
};

export async function submitAnswer(
  participantId: string,
  questionId: string,
  optionIds: string[],
  questionOptions: GameQuestion["options"]
): Promise<AnswerResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("repondre", {
    p_participant: participantId,
    p_question: questionId,
    p_options: optionIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const correction = (row.correction as Record<string, unknown> | null) ?? null;
  const correctIds = (correction?.bonnes_options as string[]) ?? [];

  const optionsById = Object.fromEntries(
    questionOptions.map((o) => [o.id, o.libelle])
  );

  return {
    is_correct: (row.est_correcte as boolean) ?? false,
    points_gagnes: (row.points_obtenus as number) ?? 0,
    bonnes_reponses: correctIds.map((id) => optionsById[id] ?? id),
    explication: (correction?.explication as string | null) ?? null,
    reference_biblique: (correction?.reference_biblique as string | null) ?? null,
    is_finished: (row.fini as boolean) ?? false,
  };
}

export async function submitEmptyAnswer(
  participantId: string,
  questionId: string,
  questionOptions: GameQuestion["options"]
): Promise<AnswerResult> {
  return submitAnswer(participantId, questionId, [], questionOptions);
}

export async function fetchSessionIdByCode(code: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("id")
    .eq("code_court", code.toUpperCase())
    .eq("statut", "ouverte")
    .single();

  if (error || !data) {
    return null;
  }

  return data.id as string;
}
