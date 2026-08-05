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
  const participantId = searchParams.get("participant_id");
  const code = searchParams.get("code");

  if (!participantId || !code) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("mon_resultat", {
    p_participant: participantId,
  });

  if (error || !data) {
    return NextResponse.json({ error: "Résultat introuvable" }, { status: 404 });
  }

  const row = data as Record<string, unknown>;
  const quizTitre = (row.quiz_titre as string) ?? "Quiz";
  const pseudo = (row.pseudo as string) ?? "Participant";
  const score = (row.score_total as number) ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "1080px",
          height: "1080px",
          backgroundColor: ENCRE,
          color: CRAIE,
          fontFamily: "Inter, sans-serif",
          padding: 80,
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            border: `4px solid ${INDIGO}`,
            borderRadius: 8,
            width: "100%",
            height: "100%",
            padding: 60,
          }}
        >
          <p
            style={{
              fontSize: 48,
              color: ADIRE,
              textTransform: "uppercase",
              letterSpacing: 4,
              marginBottom: 24,
            }}
          >
            Quizdeszeles
          </p>
          <p style={{ fontSize: 40, marginBottom: 24 }}>{quizTitre}</p>
          <p style={{ fontSize: 120, color: OR, marginBottom: 16 }}>
            {score}
          </p>
          <p style={{ fontSize: 36, marginBottom: 40 }}>pts</p>
          <p style={{ fontSize: 32, marginBottom: 16 }}>
            {pseudo}
          </p>
          <p style={{ fontSize: 28, color: ADIRE }}>
            Code : {code.toUpperCase()}
          </p>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1080,
    }
  );
}
