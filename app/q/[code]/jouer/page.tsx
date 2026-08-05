import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { GameScreen } from "@/app/q/[code]/jouer/game-screen";
import { GameWaiting } from "@/app/q/[code]/jouer/game-waiting";
import type { GameQuestion } from "@/lib/game";

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ participant_id?: string }>;
}) {
  const { code } = await params;
  const { participant_id: participantId } = await searchParams;

  if (!participantId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-encre p-4 text-craie">
        <p className="text-center">
          Lien incomplet. Reviens via la page d&apos;accueil du quiz.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, statut, mode, correction_immediate")
    .eq("code_court", code.toUpperCase())
    .in("statut", ["attente", "ouverte"])
    .single();

  if (sessionError || !session) {
    console.error("Play page session lookup failed for code", code, sessionError);
    throw new Error(sessionError?.message ?? "Session introuvable.");
  }

  if (session.statut === "attente") {
    return (
      <GameWaiting code={code} participantId={participantId} />
    );
  }

  const { data, error } = await supabase.rpc("question_courante", {
    p_participant: participantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const initialQuestion: GameQuestion | null = data
    ? parseQuestion(data as Record<string, unknown>)
    : null;

  if (!initialQuestion) {
    redirect(`/q/${code}/resultat?participant_id=${participantId}`);
  }

  return (
    <GameScreen
      code={code}
      sessionId={session.id as string}
      mode={session.mode as "libre" | "synchronise"}
      correctionImmediate={session.correction_immediate as boolean}
      participantId={participantId}
      initialQuestion={initialQuestion}
    />
  );
}

function parseQuestion(row: Record<string, unknown>): GameQuestion | null {
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
    indice: (question.indice as string | null) ?? null,
    options: options.map((o) => ({
      id: o.id as string,
      libelle: (o.libelle as string) ?? "",
    })),
    started_at: (row.servie_le as string) ?? new Date().toISOString(),
    server_now: (row.maintenant as string) ?? new Date().toISOString(),
  };
}
