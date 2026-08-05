import { createClient } from "@/lib/supabase/client";

export type DashboardEntry = {
  rang: number;
  pseudo: string;
  score: number;
  temps_total_ms: number;
  termine: boolean;
};

export type QuestionStat = {
  question_id: string;
  ordre: number;
  enonce: string;
  taux_reussite: number;
  nb_reponses: number;
};

export function parseLeaderboard(data: unknown): DashboardEntry[] {
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    rang: (row.rang as number) ?? 0,
    pseudo: (row.pseudo as string) ?? "",
    score: (row.score_total as number) ?? 0,
    temps_total_ms: (row.temps_total_ms as number) ?? 0,
    termine: (row.termine as boolean) ?? false,
  }));
}

export function parseStats(data: unknown): QuestionStat[] {
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    question_id: (row.question_id as string) ?? "",
    ordre: (row.ordre as number) ?? 0,
    enonce: (row.enonce as string) ?? "",
    taux_reussite: (row.taux_reussite as number) ?? 0,
    nb_reponses: (row.nb_reponses as number) ?? 0,
  }));
}

export async function fetchDashboardLeaderboard(
  sessionId: string
): Promise<DashboardEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("classement", {
    p_session: sessionId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return parseLeaderboard(data);
}

export async function fetchDashboardStats(
  sessionId: string
): Promise<QuestionStat[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("stats_session", {
    p_session_id: sessionId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return parseStats(data).sort((a, b) => a.taux_reussite - b.taux_reussite);
}

export function downloadLeaderboardCsv(
  entries: DashboardEntry[],
  quizTitre: string
): void {
  const rows = [
    ["Rang", "Pseudo", "Score", "Temps (ms)", "Terminé"],
    ...entries.map((entry) => [
      entry.rang,
      entry.pseudo,
      entry.score,
      entry.temps_total_ms,
      entry.termine ? "Oui" : "Non",
    ]),
  ];

  const csv = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `classement-${quizTitre.replace(/\s+/g, "-").toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function buildScoreDistribution(
  entries: DashboardEntry[],
  bucketSize = 10
): { label: string; count: number }[] {
  if (entries.length === 0) return [];

  const maxScore = Math.max(...entries.map((e) => e.score), bucketSize);
  const bucketCount = Math.ceil(maxScore / bucketSize);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    label: `${index * bucketSize}-${(index + 1) * bucketSize - 1}`,
    count: 0,
  }));

  for (const entry of entries) {
    const index = Math.min(
      Math.floor(entry.score / bucketSize),
      bucketCount - 1
    );
    buckets[index].count += 1;
  }

  return buckets;
}
