import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";
import { OG_CACHE_HEADERS } from "@/lib/ogCache";
import { getProjectView } from "@/lib/entriesPublic";
import { parseId } from "@/lib/ids";

// OG do projeto (spec 023; spec 046 vitrine) — /p/<teamId> compartilhado
// mostra título grande, time · edição, colocação (ouro pro 1º) e até 4 tags
// de "Feito com". Mesma matriz de visibilidade da página pra quem não tem
// conta: tag só quando o conteúdo já é público. Nada de texto livre longo.
// Fallback 200 genérico.

export const alt = "Projeto de hackathon — hackahub";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const id = parseId(teamId);
  const page = id === null ? null : await getProjectView(id, null);
  const title = (page?.title ?? appConfig.name).slice(0, 90);
  const detail = page
    ? `${page.teamName} · ${page.hackathonName}`.slice(0, 80)
    : "o que já nasceu aqui";
  const place =
    page && page.placement >= 1 && page.placement <= 3
      ? `${page.placement}º lugar`
      : null;
  const tags = page?.openToPublic ? page.tech.slice(0, 4).map((t) => t.label.slice(0, 24)) : [];

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
          border: `10px solid ${place === "1º lugar" ? "#a8550a" : "#0c0c0c"}`,
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
          {"HACKAHUB · PROJETO"}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: title.length > 40 ? 64 : 84,
            fontWeight: 800,
            color: "#0c0c0c",
            letterSpacing: "-0.045em",
            lineHeight: 1.05,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#474747",
            marginTop: 32,
            fontFamily: "monospace",
          }}
        >
          {detail}
          {place ? ` · ${place}` : ""}
        </div>
        {tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
            {tags.map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  fontSize: 26,
                  fontFamily: "monospace",
                  color: "#0c0c0c",
                  border: "3px solid #0c0c0c",
                  padding: "4px 14px",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
