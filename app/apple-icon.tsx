import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

const ENCRE = "#0e1626";
const INDIGO = "#2b3f8c";
const OR = "#c8963e";
const CRAIE = "#f3f0e7";

export default function AppleIcon() {
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
        }}
      >
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 96,
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
