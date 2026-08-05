import { ImageResponse } from "next/og";
import * as React from "react";

const ENCRE = "#0e1626";
const INDIGO = "#2b3f8c";
const ADIRE = "#6b7fd1";
const CRAIE = "#f3f0e7";
const OR = "#c8963e";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "1200px",
          height: "630px",
          backgroundColor: CRAIE,
          color: ENCRE,
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
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 12,
              height: "100%",
              backgroundColor: INDIGO,
            }}
          />
          <p
            style={{
              fontSize: 36,
              color: ADIRE,
              textTransform: "uppercase",
              letterSpacing: 6,
              marginBottom: 24,
            }}
          >
            Quizdeszeles
          </p>
          <p style={{ fontSize: 72, fontWeight: 700, marginBottom: 24 }}>
            Quiz bibliques en direct
          </p>
          <p style={{ fontSize: 32, color: OR }}>
            Crée, partage et joue avec ta salle — sans installation.
          </p>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
