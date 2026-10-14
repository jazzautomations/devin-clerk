import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";

// OG image padrão do site (spec 009, redesenhada na 039): mesma hierarquia
// da landing — selo, "Sua comunidade de hackathon." e a jornada em mono.
// Papel, tinta, verde; fio de tinta, sem sombra nem gradiente.

export const alt = `${appConfig.name} — sua comunidade de hackathon, da Hack Inova`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const JORNADA = ["inscrição", "time", "entrega", "certificado", "portfólio"];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "#fefefe",
          border: "8px solid #0c0c0c",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            background: "#0c0c0c",
            color: "#3ecf8e",
            fontFamily: "monospace",
            fontSize: 26,
            padding: "12px 48px",
            borderBottom: "4px solid #3ecf8e",
          }}
        >
          <span>HACKAHUB · HACK INOVA</span>
          <span>COMUNIDADE DE HACKATHON</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", padding: "0 72px" }}>
          <div style={{ display: "flex", fontSize: 104, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 0.92, color: "#0c0c0c" }}>
            Sua comunidade
          </div>
          <div style={{ display: "flex", fontSize: 104, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 0.92, color: appConfig.accent }}>
            de hackathon.
          </div>
        </div>
        <div style={{ display: "flex", borderTop: "3px solid #0c0c0c" }}>
          {JORNADA.map((j, i) => (
            <div
              key={j}
              style={{
                display: "flex",
                flex: 1,
                gap: 10,
                padding: "22px 0 24px 24px",
                borderLeft: i === 0 ? "none" : "2px solid #0c0c0c",
                fontFamily: "monospace",
                fontSize: 24,
                color: "#0c0c0c",
              }}
            >
              <span style={{ color: appConfig.accent }}>{String(i + 1).padStart(2, "0")}</span>
              <span>{j}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
