import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { QuizWelcome } from "@/app/q/[code]/quiz-welcome";

export default async function QuizWelcomePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, quiz_id, code_court, statut")
    .eq("code_court", code.toUpperCase())
    .in("statut", ["attente", "ouverte"])
    .single();

  if (sessionError || !session) {
    console.error("Session lookup failed for code", code, sessionError);
    throw new Error(sessionError?.message ?? "Ce code ne correspond à aucune session.");
  }

  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .select("titre, description, auteur_id")
    .eq("id", session.quiz_id as string)
    .single();

  if (quizError || !quiz) {
    notFound();
  }

  const [{ data: author }, { data: questions, error: questionsError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("pseudo")
        .eq("id", quiz.auteur_id as string)
        .single(),
      supabase
        .from("questions")
        .select("duree_sec")
        .eq("quiz_id", session.quiz_id as string),
    ]);

  if (questionsError) {
    throw new Error(questionsError.message);
  }

  const questionsCount = (questions ?? []).length;
  const estimatedDuration = (questions ?? []).reduce(
    (sum, q) => sum + ((q.duree_sec as number) ?? 0),
    0
  );

  return (
    <QuizWelcome
      code={session.code_court as string}
      statut={session.statut as "attente" | "ouverte"}
      titre={(quiz.titre as string) ?? "Quiz"}
      description={(quiz.description as string) ?? ""}
      animateur={(author?.pseudo as string) ?? "Anonyme"}
      questionsCount={questionsCount}
      estimatedDuration={estimatedDuration}
    />
  );
}
