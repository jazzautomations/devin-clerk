import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";
import { getProjectByTeamId } from "@/lib/archive";

// OG do projeto (spec 023) — /p/<teamId> compartilhado mostra o projeto:
// título grande + edição + colocação (ouro pro 1º). Fallback 200 genérico.

export const alt = "Projeto de hackathon — hackahub";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const page = /^\d+$/.test(teamId) ? getProjectByTeamId(Number(teamId)) : null;
  const title = page?.project.title ?? appConfig.name;
  const detail = page
    ? `${page.teamName} · ${page.hackathonName}`
    : "o que já nasceu aqui";
  const place =
    page && page.placement >= 1 && page.placement <= 3
      ? `${page.placement}º lugar`
      : null;

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
          border: `6px solid ${place === "1º lugar" ? "#f59e0b" : appConfig.accent}`,
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
          {"// hackahub · projeto"}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: title.length > 40 ? 64 : 84,
            fontWeight: 700,
            color: "#e7e5e0",
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#8b8f94",
            marginTop: 32,
            fontFamily: "monospace",
          }}
        >
          {detail}
          {place ? ` · ${place}` : ""}
        </div>
      </div>
    ),
    size,
  );
}
