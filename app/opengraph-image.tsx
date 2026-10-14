import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";

// OG image padrão do site (spec 009) — papel + moldura de tinta (sistema Hack Inova).
// Otimizada em build; fonte Geist vem bundled no next/og.

export const alt = `${appConfig.name} — a plataforma da Hack Inova`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#fefefe",
          border: "10px solid #0c0c0c",
          padding: "72px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontFamily: "monospace",
            marginBottom: 36,
            background: "#0c0c0c",
            color: "#3ecf8e",
            padding: "6px 16px",
            alignSelf: "flex-start",
          }}
        >
          {"HACKAHUB · HACK INOVA"}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 96,
            fontWeight: 800,
            color: "#0c0c0c",
            letterSpacing: "-0.045em",
          }}
        >
          HACKAHUB
          <span style={{ color: appConfig.accent }}>.</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#474747",
            marginTop: 32,
          }}
        >
          Hackathon sem Forms e sem grupo de zap.
        </div>
      </div>
    ),
    size,
  );
}
