import { redirect, notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { QuizEditor } from "@/app/quiz/[id]/quiz-editor";

export default async function QuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/connexion");
  }

  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .select("*")
    .eq("id", id)
    .eq("auteur_id", user.id)
    .single();

  if (quizError || !quiz) {
    notFound();
  }

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("*, options(*)")
    .eq("quiz_id", id)
    .order("ordre", { ascending: true });

  if (questionsError) {
    throw new Error(questionsError.message);
  }

  return (
    <QuizEditor
      quiz={quiz as Record<string, unknown>}
      questions={(questions ?? []) as Record<string, unknown>[]}
      quizId={id}
      userId={user.id}
    />
  );
}
