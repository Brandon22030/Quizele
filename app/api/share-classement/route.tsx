import * as React from "react";
import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const ENCRE = "#0e1626";
const INDIGO = "#2b3f8c";
const ADIRE = "#6b7fd1";
const CRAIE = "#f3f0e7";
const OR = "#c8963e";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("quiz_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
  }

  const { data: quiz } = await supabase
    .from("quizzes")
    .select("titre")
    .eq("id", session.quiz_id as string)
    .single();

  const quizTitre = (quiz?.titre as string) ?? "Quiz";

  const { count: totalQuestions } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", session.quiz_id as string);

  const { data, error } = await supabase.rpc("classement", {
    p_session: sessionId,
    p_limite: 10,
  });

  if (error) {
    return NextResponse.json({ error: "Classement introuvable" }, { status: 404 });
  }

  const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    rang: (row.rang as number) ?? 0,
    pseudo: (row.pseudo as string) ?? "",
    score_total: (row.score_total as number) ?? 0,
  }));

  const medal = (rang: number) => {
    if (rang === 1) return "🥇";
    if (rang === 2) return "🥈";
    if (rang === 3) return "🥉";
    return null;
  };

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "1080px",
          height: "1350px",
          backgroundColor: ENCRE,
          color: CRAIE,
          fontFamily: "Inter, sans-serif",
          padding: 70,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            height: "100%",
            border: `4px solid ${INDIGO}`,
            borderRadius: 8,
            padding: 50,
          }}
        >
          <p
            style={{
              fontSize: 40,
              color: ADIRE,
              textTransform: "uppercase",
              letterSpacing: 4,
              marginBottom: 8,
            }}
          >
            Quizdeszeles
          </p>
          <p
            style={{
              fontSize: 44,
              fontWeight: 700,
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            {quizTitre}
          </p>
          <p style={{ fontSize: 28, color: OR, marginBottom: 40 }}>
            Classement final
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              gap: 14,
            }}
          >
            {rows.length === 0 ? (
              <p style={{ fontSize: 32, color: ADIRE }}>Aucun participant</p>
            ) : (
              rows.map((row) => (
                <div
                  key={row.rang}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    borderRadius: 6,
                    border: `2px solid ${ADIRE}55`,
                    padding: "18px 28px",
                    backgroundColor:
                      row.rang <= 3 ? `${OR}1a` : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <span
                      style={{
                        fontSize: 32,
                        fontFamily: "monospace",
                        color: CRAIE,
                        width: 60,
                      }}
                    >
                      {medal(row.rang) ?? `#${row.rang}`}
                    </span>
                    <span style={{ fontSize: 34, color: CRAIE }}>
                      {row.pseudo}
                    </span>
                  </div>
                  <span style={{ fontSize: 32, color: OR, fontFamily: "monospace" }}>
                    {row.score_total} / {totalQuestions ?? 0} bonnes réponses
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
    }
  );
}
