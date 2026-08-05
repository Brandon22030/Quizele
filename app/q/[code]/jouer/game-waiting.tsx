"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type SessionStatus = "attente" | "ouverte" | "fermee";

export function GameWaiting({
  code,
  participantId,
}: {
  code: string;
  participantId: string;
}) {
  const [status, setStatus] = useState<SessionStatus | "introuvable">("attente");

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function check() {
      const { data, error } = await supabase
        .from("sessions")
        .select("statut")
        .eq("code_court", code.toUpperCase())
        .single();

      if (cancelled) return;

      if (error || !data) {
        setStatus("introuvable");
        return;
      }

      const statut = data.statut as SessionStatus;
      setStatus(statut);

      if (statut === "ouverte") {
        window.location.href = `/q/${code}/jouer?participant_id=${participantId}`;
      } else if (statut === "attente") {
        timer = setTimeout(check, 3000);
      }
    }

    void check();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, participantId]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-encre p-6 text-craie">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="font-display text-2xl">
          {status === "introuvable"
            ? "Session introuvable"
            : "En attente de l'animateur"}
        </h1>
        <p className="text-sm text-craie/80">
          {status === "fermee"
            ? "Cette session est terminée."
            : status === "introuvable"
              ? "Cette session n'existe pas ou n'est plus accessible."
              : "La session va démarrer. Reste sur cette page, la première question apparaîtra automatiquement."}
        </p>
      </div>
    </main>
  );
}
