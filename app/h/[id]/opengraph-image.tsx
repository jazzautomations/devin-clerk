import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";
import { getHackathon } from "@/lib/hackathons";
import { getCardRarity } from "@/lib/xp";

// OG da edição (spec 023) — compartilhar /h/<id> mostra o card da edição:
// borda na cor da raridade da carta colecionável + nome + data + local.
// Id fantasma cai no fallback genérico (200, nunca 500) — crawlers primeiro.

export const alt = "Edição de hackathon — hackahub";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const RARITY_HEX: Record<string, string> = {
  comum: "#565b60",
  raro: "#38bdf8",
  epico: "#a78bfa",
  lendario: "#f59e0b",
};

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" });

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = getHackathon(id);
  const rarity = h ? getCardRarity(id) : "comum";
  const accent = h ? RARITY_HEX[rarity] : appConfig.accent;
  const title = h?.name ?? appConfig.name;
  const detail = h
    ? [
        fmt.format(new Date(h.startsAt)),
        h.location,
        h.format,
      ]
        .filter(Boolean)
        .join(" · ")
    : "a rede social dos hackathons";

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
          border: `6px solid ${accent}`,
          padding: "72px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: accent,
            fontFamily: "monospace",
            marginBottom: 32,
          }}
        >
          {`// hackahub · ${rarity}`}
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
        </div>
      </div>
    ),
    size,
  );
}
