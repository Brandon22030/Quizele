"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Rubrique } from "@/components/ui/rubrique";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { fermerSession } from "@/app/session/[id]/session-actions";
import {
  fetchDashboardLeaderboard,
  fetchDashboardStats,
  downloadLeaderboardCsv,
  buildScoreDistribution,
  type DashboardEntry,
  type QuestionStat,
} from "@/lib/session-dashboard";

const REFRESH_INTERVAL_MS = 3000;

export function SessionDashboard({
  sessionId,
  quizTitre,
  sessionStatus,
  initialLeaderboard,
  initialStats,
}: {
  sessionId: string;
  quizTitre: string;
  sessionStatus: string;
  initialLeaderboard: DashboardEntry[];
  initialStats: QuestionStat[];
}) {
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [leaderboard, setLeaderboard] = useState<DashboardEntry[]>(
    initialLeaderboard
  );
  const [stats, setStats] = useState<QuestionStat[]>(initialStats);
  const [status, setStatus] = useState(sessionStatus);
  const [isClosing, setIsClosing] = useState(false);

  const lastRefreshRef = useRef<number>(0);
  const scheduledRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    lastRefreshRef.current = Date.now();
    try {
      const [entries, questionStats] = await Promise.all([
        fetchDashboardLeaderboard(sessionId),
        fetchDashboardStats(sessionId),
      ]);
      setLeaderboard(entries);
      setStats(questionStats);
    } catch (error) {
      addToast({
        title: "Actualisation impossible",
        description:
          error instanceof Error
            ? error.message
            : "Les données en direct n'ont pas pu être rechargées.",
        variant: "error",
      });
    }
  }, [sessionId, addToast]);

  const scheduleRefresh = useCallback(() => {
    if (scheduledRef.current) return;

    const delay = Math.max(
      0,
      REFRESH_INTERVAL_MS - (Date.now() - lastRefreshRef.current)
    );

    scheduledRef.current = setTimeout(() => {
      scheduledRef.current = null;
      void refresh();
    }, delay);
  }, [refresh]);

  useEffect(() => {
    lastRefreshRef.current = Date.now();

    const channel = supabase
      .channel(`session-dashboard-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participants",
          filter: `session_id=eq.${sessionId}`,
        },
        () => scheduleRefresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reponses",
        },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      if (scheduledRef.current) {
        clearTimeout(scheduledRef.current);
      }
      void supabase.removeChannel(channel);
    };
  }, [sessionId, supabase, scheduleRefresh]);

  async function handleClose() {
    setIsClosing(true);
    try {
      await fermerSession(sessionId);
      setStatus("fermee");
      addToast({
        title: "Session clôturée",
        description: "Les scores sont figés.",
        variant: "info",
      });
    } catch (error) {
      addToast({
        title: "Impossible de clôturer",
        description:
          error instanceof Error ? error.message : "Vérifie ta connexion.",
        variant: "error",
      });
    } finally {
      setIsClosing(false);
    }
  }

  function handleExport() {
    downloadLeaderboardCsv(leaderboard, quizTitre);
  }

  const distribution = useMemo(
    () => buildScoreDistribution(leaderboard),
    [leaderboard]
  );
  const maxDistribution = Math.max(
    ...distribution.map((bucket) => bucket.count),
    1
  );

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="flex flex-col gap-4 border-b border-adire pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Rubrique>Suivi de session</Rubrique>
            <h1 className="mt-2 font-display text-3xl">{quizTitre}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Statut : {status}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="secondary"
              size="md"
              onClick={handleExport}
              disabled={leaderboard.length === 0}
            >
              Exporter CSV
            </Button>
            <Button
              variant="destructive"
              size="md"
              loading={isClosing}
              disabled={status !== "ouverte"}
              onClick={handleClose}
            >
              Clôturer la session
            </Button>
          </div>
        </header>

        <section className="space-y-4" aria-live="polite" aria-atomic="false">
          <h2 className="font-display text-2xl">Classement</h2>
          {leaderboard.length === 0 ? (
            <p className="text-muted-foreground">Aucun participant pour le moment.</p>
          ) : (
            <div className="overflow-hidden rounded-sm border border-adire">
              <table className="w-full text-left text-sm">
                <thead className="bg-adire/10">
                  <tr>
                    <th className="px-4 py-3">Rang</th>
                    <th className="px-4 py-3">Pseudo</th>
                    <th className="px-4 py-3">Bonnes réponses</th>
                    <th className="px-4 py-3">Temps</th>
                    <th className="px-4 py-3">Terminé</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry) => (
                    <tr key={entry.rang} className="border-t border-adire/30">
                      <td className="px-4 py-3">{entry.rang}</td>
                      <td className="px-4 py-3">{entry.pseudo}</td>
                      <td className="px-4 py-3">{entry.score}</td>
                      <td className="px-4 py-3">
                        {Math.round(entry.temps_total_ms / 1000)}s
                      </td>
                      <td className="px-4 py-3">
                        {entry.termine ? "Oui" : "Non"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl">Distribution des bonnes réponses</h2>
          {distribution.length === 0 ? (
            <p className="text-muted-foreground">Pas assez de données.</p>
          ) : (
            <div className="flex items-end gap-2 rounded-sm border border-adire p-4">
              {distribution.map((bucket) => (
                <div
                  key={bucket.label}
                  className="flex flex-1 flex-col items-center gap-2"
                >
                  <div
                    className="w-full rounded-sm bg-indigo"
                    style={{
                      height: `${(bucket.count / maxDistribution) * 200}px`,
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {bucket.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl">À revoir ensemble</h2>
          <p className="text-sm text-muted-foreground">
            Taux de réussite par question, du plus raté au mieux réussi.
          </p>
          {stats.length === 0 ? (
            <p className="text-muted-foreground">Aucune statistique disponible.</p>
          ) : (
            <div className="space-y-3">
              {stats.map((stat) => (
                <div
                  key={stat.question_id}
                  className="rounded-sm border border-adire p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-display text-foreground">
                      {stat.ordre}. {stat.enonce}
                    </p>
                    <span className="shrink-0 text-lg font-medium text-or">
                      {Math.round(stat.taux_reussite * 100)}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full bg-adire/20">
                    <div
                      className="h-2 rounded-full bg-indigo"
                      style={{ width: `${stat.taux_reussite * 100}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {stat.nb_reponses} réponses
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
