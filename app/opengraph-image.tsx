import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";

// OG image padrão do site (spec 009) — fundo escuro + borda accent.
// Otimizada em build; fonte Geist vem bundled no next/og.

export const alt = `${appConfig.name} — a rede social dos hackathons`;
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
          background: "#0b0d0e",
          border: `6px solid ${appConfig.accent}`,
          padding: "72px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: appConfig.accent,
            fontFamily: "monospace",
            marginBottom: 32,
          }}
        >
          {"// a rede social dos hackathons"}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 96,
            fontWeight: 700,
            color: "#e7e5e0",
            letterSpacing: "-0.03em",
          }}
        >
          HACKAHUB
          <span style={{ color: appConfig.accent }}>_</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#8b8f94",
            marginTop: 32,
          }}
        >
          Um perfil. Todos os hackathons.
        </div>
      </div>
    ),
    size,
  );
}
