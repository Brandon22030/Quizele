import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ResultScreen } from "@/app/q/[code]/resultat/result-screen";
import { parseResultData, type ResultData } from "@/lib/result";

export default async function ResultatPage({
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
          Lien incomplet. Reviens via la page de jeu du quiz.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id")
    .eq("code_court", code.toUpperCase())
    .single();

  if (sessionError || !session) {
    notFound();
  }

  const { data, error } = await supabase.rpc("mon_resultat", {
    p_participant: participantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    redirect(`/q/${code}/jouer?participant_id=${participantId}`);
  }

  const result: ResultData = parseResultData(
    participantId,
    data as Record<string, unknown>
  );

  return (
    <ResultScreen
      code={code}
      sessionId={session.id as string}
      initialResult={result}
    />
  );
}
