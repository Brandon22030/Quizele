import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { SessionScreen } from "@/app/session/[id]/session-screen";

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { id: sessionId } = await params;
  const { code } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/connexion");
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    notFound();
  }

  const quizId = session.quiz_id as string;

  const [{ data: quiz, error: quizError }, { data: isAuthor, error: authorError }] =
    await Promise.all([
      supabase.from("quizzes").select("titre").eq("id", quizId).single(),
      supabase.rpc("est_auteur_du_quiz", { p_quiz: quizId }),
    ]);

  if (quizError || !quiz || authorError || !isAuthor) {
    redirect("/tableau-de-bord");
  }

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("id, ordre, enonce, type, options(id, libelle, est_correcte, ordre)")
    .eq("quiz_id", quizId)
    .order("ordre", { ascending: true });

  if (questionsError) {
    throw new Error(questionsError.message);
  }

  const currentQuestionId =
    (session.question_courante_id as string | null) ?? null;

  const [{ data: participants }, { count: answersCount }] = await Promise.all([
    supabase
      .from("participants")
      .select("id, pseudo, score_total, cree_le")
      .eq("session_id", sessionId)
      .order("score_total", { ascending: false }),
    currentQuestionId
      ? supabase
          .from("reponses")
          .select("id", { count: "exact", head: true })
          .eq("question_id", currentQuestionId)
      : Promise.resolve({ count: 0 }),
  ]);

  const sortedQuestions = (questions ?? []).map((q) => ({
    id: q.id as string,
    enonce: q.enonce as string,
    type: q.type as string,
    options: ((q.options as { id: string; libelle: string; est_correcte: boolean; ordre: number }[] | null) ?? [])
      .slice()
      .sort((a, b) => a.ordre - b.ordre)
      .map((o) => ({
        id: o.id,
        libelle: o.libelle,
        est_correcte: o.est_correcte,
      })),
  }));

  return (
    <SessionScreen
      sessionId={sessionId}
      code={code ?? (session.code_court as string)}
      quizTitle={(quiz.titre as string) ?? "Quiz"}
      mode={session.mode as "libre" | "synchronise"}
      correctionImmediate={session.correction_immediate as boolean}
      questions={sortedQuestions}
      currentQuestionId={currentQuestionId}
      initialReponsesRevelesLe={
        (session.reponses_reveles_le as string | null) ?? null
      }
      initialResultatsReveles={(session.resultats_reveles as boolean) ?? false}
      initialParticipants={
        (participants ?? []).map((p) => ({
          id: p.id as string,
          pseudo: p.pseudo as string,
          score_total: p.score_total as number,
          cree_le: p.cree_le as string,
        }))
      }
      initialAnswersCount={answersCount ?? 0}
    />
  );
}
