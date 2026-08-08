import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { SessionDashboard } from "@/app/sessions/[id]/session-dashboard";

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p>Connexion requise.</p>
      </main>
    );
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .select("id, quiz_id, statut")
    .eq("id", id)
    .single();

  if (error || !session) {
    notFound();
  }

  const { data: quiz } = await supabase
    .from("quizzes")
    .select("titre, auteur_id")
    .eq("id", session.quiz_id as string)
    .single();

  if (!quiz || quiz.auteur_id !== user.id) {
    notFound();
  }

  const [{ data: leaderboardData }, { data: statsData }, { count: totalQuestions }] =
    await Promise.all([
      supabase.rpc("classement", { p_session: id }),
      supabase.rpc("stats_session", { p_session_id: id }),
      supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("quiz_id", session.quiz_id as string),
    ]);

  const initialLeaderboard = ((leaderboardData ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      rang: (row.rang as number) ?? 0,
      pseudo: (row.pseudo as string) ?? "",
      score: (row.score_total as number) ?? 0,
      temps_total_ms: (row.temps_total_ms as number) ?? 0,
      termine: (row.termine as boolean) ?? false,
    })
  );

  const initialStats = ((statsData ?? []) as Record<string, unknown>[])
    .map((row) => ({
      question_id: (row.question_id as string) ?? "",
      ordre: (row.ordre as number) ?? 0,
      enonce: (row.enonce as string) ?? "",
      taux_reussite: (row.taux_reussite as number) ?? 0,
      nb_reponses: (row.nb_reponses as number) ?? 0,
    }))
    .sort((a, b) => a.taux_reussite - b.taux_reussite);

  return (
    <SessionDashboard
      sessionId={id}
      quizTitre={(quiz.titre as string) ?? "Quiz"}
      sessionStatus={(session.statut as string) ?? "ouverte"}
      initialLeaderboard={initialLeaderboard}
      initialStats={initialStats}
      totalQuestions={totalQuestions ?? 0}
    />
  );
}
