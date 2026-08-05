import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { QuizList } from "@/app/tableau-de-bord/quiz-list";
import type { QuizSummary } from "@/app/tableau-de-bord/quiz-card";

export async function QuizzesLoader() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/connexion");
  }

  const { data, error } = await supabase
    .from("quizzes")
    .select("*, questions(count), sessions(count)")
    .eq("auteur_id", user.id)
    .order("maj_le", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const quizzes: QuizSummary[] = (data ?? []).map((quiz: Record<string, unknown>) => ({
    id: quiz.id as string,
    titre: quiz.titre as string,
    categorie: (quiz.categorie as string | null) ?? null,
    statut: quiz.statut as QuizSummary["statut"],
    maj_le: quiz.maj_le as string,
    questions_count: Array.isArray(quiz.questions)
      ? (quiz.questions[0] as { count: number })?.count ?? 0
      : 0,
    sessions_count: Array.isArray(quiz.sessions)
      ? (quiz.sessions[0] as { count: number })?.count ?? 0
      : 0,
  }));

  return <QuizList quizzes={quizzes} />;
}
