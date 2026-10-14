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
  comum: "#0c0c0c",
  raro: "#0369a1",
  epico: "#6d28d9",
  lendario: "#a8550a",
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
        h.prize, // spec 024 — prêmio vende o clique também no card social
      ]
        .filter(Boolean)
        .join(" · ")
    : "a plataforma da Hack Inova";

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
          border: `10px solid ${accent}`,
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
          {`HACKAHUB · CARTA ${rarity.toUpperCase()}`}
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
        </div>
      </div>
    ),
    size,
  );
}
