import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";
import { OG_CACHE_HEADERS } from "@/lib/ogCache";
import { getMemberByUsername } from "@/lib/members";
import { openProfile, profileNumbers } from "@/lib/profileFacts";

// OG do perfil (spec 046, perfil-rico): nome, headline cortada em 80 e os
// quatro números de fato. Só monta o cartão com nome quando a pessoa abriu o
// perfil (publicProfile) e passa em canNetwork; senão o card é genérico, sem
// nome — o OG de perfil fechado não pode trazer nome (risco da spec 046).

export const alt = "Perfil no HackaHub — quem constrói em hackathon";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NUMBERS: { key: "presenca" | "entrega" | "premio" | "papel"; label: string }[] = [
  { key: "presenca", label: "edições" },
  { key: "entrega", label: "entregas" },
  { key: "premio", label: "prêmios" },
  { key: "papel", label: "organizou/mentorou" },
];

const frame = (children: React.ReactNode) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      background: "#fefefe",
      border: "10px solid #0c0c0c",
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
      }}
    >
      <span>HACKAHUB</span>
      <span>PERFIL</span>
    </div>
    {children}
  </div>
);

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const member = await getMemberByUsername(decodeURIComponent(username).toLowerCase());
  const open = !!member && (await openProfile(member.id, member.publicProfile ?? 0));

  if (!member || !open) {
    return new ImageResponse(
      frame(
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", padding: "0 72px" }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 0.95, color: "#0c0c0c" }}>
            A comunidade de hackathon
          </div>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 0.95, color: appConfig.accent }}>
            do Brasil.
          </div>
        </div>,
      ),
      { ...size, headers: OG_CACHE_HEADERS },
    );
  }

  const numbers = await profileNumbers(member.id);
  const name = (member.name ?? `@${member.username}`).slice(0, 70);
  const headline = (member.headline ?? `@${member.username}`).slice(0, 80);

  return new ImageResponse(
    frame(
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", padding: "0 72px", gap: 18 }}>
        <div
          style={{
            display: "flex",
            fontSize: name.length > 26 ? 60 : 80,
            fontWeight: 800,
            letterSpacing: "-0.045em",
            lineHeight: 1,
            color: "#0c0c0c",
          }}
        >
          {name}
        </div>
        <div style={{ display: "flex", fontSize: 30, fontFamily: "monospace", color: "#474747" }}>{headline}</div>
        <div style={{ display: "flex", borderTop: "3px solid #0c0c0c", marginTop: 26 }}>
          {NUMBERS.map((n, i) => (
            <div
              key={n.key}
              style={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: 4,
                padding: "18px 0 4px 20px",
                borderLeft: i === 0 ? "none" : "2px solid #0c0c0c",
              }}
            >
              <span style={{ fontSize: 44, fontWeight: 800, color: numbers[n.key] > 0 ? appConfig.accent : "#8a8a8a" }}>
                {numbers[n.key] > 0 ? String(numbers[n.key]) : "—"}
              </span>
              <span style={{ fontSize: 20, fontFamily: "monospace", color: "#0c0c0c" }}>{n.label}</span>
            </div>
          ))}
        </div>
      </div>,
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
