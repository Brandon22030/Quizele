"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Rubrique } from "@/components/ui/rubrique";
import {
  fetchLeaderboard,
  formatDuration,
  getEncouragement,
  type ResultData,
  type LeaderboardEntry,
} from "@/lib/result";

export function ResultScreen({
  code,
  sessionId,
  initialResult,
}: {
  code: string;
  sessionId: string;
  initialResult: ResultData;
}) {
  const [result] = useState<ResultData>(initialResult);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [shareStatus, setShareStatus] = useState<"idle" | "loading" | "done">(
    "idle"
  );

  const percentage =
    result.total_questions > 0
      ? Math.round((result.bonnes_reponses / result.total_questions) * 100)
      : 0;

  useEffect(() => {
    async function load() {
      try {
        const entries = await fetchLeaderboard(sessionId);
        setLeaderboard(entries);
      } catch {
        // Silencieux : le classement n'est pas bloquant.
      }
    }

    void load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [sessionId]);

  async function handleShare() {
    if (shareStatus === "loading") return;
    setShareStatus("loading");

    try {
      const imageUrl = `/api/share?participant_id=${encodeURIComponent(
        result.participant_id
      )}&code=${encodeURIComponent(code)}`;
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], "quizdeszeles-score.png", { type: blob.type });
      const shareUrl = `${window.location.origin}/q/${code}`;

      const shareApi = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data?: ShareData) => Promise<void>;
      };

      if (shareApi.canShare?.({ files: [file] })) {
        await shareApi.share({
          title: `Mon score sur ${result.quiz_titre}`,
          text: `${result.pseudo} a obtenu ${result.bonnes_reponses}/${result.total_questions} bonnes réponses sur ${result.quiz_titre} !`,
          files: [file],
        });
      } else if (shareApi.share) {
        await shareApi.share({
          title: `Mon score sur ${result.quiz_titre}`,
          text: `${result.pseudo} a obtenu ${result.bonnes_reponses}/${result.total_questions} bonnes réponses sur ${result.quiz_titre} !`,
          url: shareUrl,
        });
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "quizdeszeles-score.png";
        link.click();
        URL.revokeObjectURL(link.href);
      }

      setShareStatus("done");
    } catch {
      setShareStatus("idle");
    }
  }

  return (
    <main className="min-h-screen bg-encre p-4 pb-24 text-craie sm:p-6">
      <div className="mx-auto max-w-2xl space-y-12">
        <header className="space-y-2 text-center">
          <Rubrique>{result.quiz_titre}</Rubrique>
          <p className="text-sm text-adire">Résultat</p>
        </header>

        <section className="space-y-4 text-center">
          <p className="text-5xl font-display text-or sm:text-7xl md:text-8xl">
            {result.bonnes_reponses} / {result.total_questions}
          </p>
          <p className="text-xl text-craie">bonnes réponses</p>
          <div className="flex justify-center gap-6 text-sm text-adire">
            <span>Temps : {formatDuration(result.temps_total_ms)}</span>
            <span>
              Rang : {result.rang} / {result.total_participants}
            </span>
          </div>
          <p className="mx-auto max-w-md text-lg text-craie">
            {getEncouragement(percentage)}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl text-craie">Corrections</h2>
          {result.corrections.length === 0 ? (
            <p className="text-sm text-adire">Aucune correction disponible.</p>
          ) : (
            <div className="space-y-3">
              {result.corrections.map((item) => (
                <details
                  key={item.question_id}
                  className="group rounded-sm border border-adire/40 bg-encre"
                >
                  <summary className="flex cursor-pointer items-center justify-between p-4">
                    <span className="font-display text-craie">
                      {item.ordre}. {item.enonce}
                    </span>
                    <span
                      className={`ml-4 shrink-0 text-sm ${
                        item.is_correct ? "text-or" : "text-rubrique"
                      }`}
                    >
                      {item.is_correct ? "Juste" : "Faux"}
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-adire/40 p-4 text-sm">
                    <div>
                      <p className="text-adire">Ma réponse</p>
                      <p className="text-craie">
                        {item.ma_reponse.join(", ") || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-adire">Bonne réponse</p>
                      <p className="text-craie">
                        {item.bonne_reponse.join(", ")}
                      </p>
                    </div>
                    {item.explication && (
                      <div>
                        <p className="text-adire">Explication</p>
                        <p className="text-craie">{item.explication}</p>
                      </div>
                    )}
                    {item.reference_biblique && (
                      <p className="font-mono uppercase tracking-widest text-adire">
                        {item.reference_biblique}
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-4 sm:flex-row">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={handleShare}
            loading={shareStatus === "loading"}
          >
            Partager mon score
          </Button>
        </div>

        <p className="text-center text-sm text-adire">
          <Link
            href="/connexion"
            className="underline hover:text-craie focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Crée ton propre quiz
          </Link>
        </p>

        <section className="space-y-3" aria-live="polite" aria-atomic="false">
          <h2 className="font-display text-xl text-craie">Classement</h2>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-adire">Chargement du classement…</p>
          ) : (
            <ol className="space-y-2">
              {leaderboard.map((entry) => (
                <li
                  key={entry.rang}
                  className={`flex items-center justify-between rounded-sm border border-adire/40 p-3 ${
                    entry.pseudo === result.pseudo ? "bg-indigo/20" : ""
                  }`}
                >
                  <span className="text-craie">
                    {entry.rang}. {entry.pseudo}
                  </span>
                  <span className="text-or">{entry.bonnes_reponses} bonnes réponses</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
