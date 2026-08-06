import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};
export const contentType = "image/png";

const ENCRE = "#0e1626";
const INDIGO = "#2b3f8c";
const OR = "#c8963e";
const CRAIE = "#f3f0e7";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ENCRE,
          borderRadius: 12,
          border: `3px solid ${INDIGO}`,
        }}
      >
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 38,
            fontWeight: 700,
            color: CRAIE,
          }}
        >
          Q
          <span style={{ color: OR }}>z</span>
        </span>
      </div>
    ),
    size
  );
}
