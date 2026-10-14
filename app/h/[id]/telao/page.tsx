import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { StageScreen } from "@/components/StageScreen";
import { getHackathon } from "@/lib/hackathons";
import { absoluteUrl } from "@/lib/seo";
import { getStageSnapshot } from "@/lib/stage";

// Modo palco — o telão da final. Público (roda num notebook ligado no
// projetor, sem login), tela cheia, tudo legível do fundo do auditório.
// O QR aponta pra /h/[id]/votar; o estado chega por SSE.

export const metadata: Metadata = {
  title: "telão da final",
  robots: { index: false },
};

export default async function StageScreenPage({ params }: PageProps<"/h/[id]/telao">) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) notFound();
  const voteUrl = absoluteUrl(`/h/${h.id}/votar`);
  const [snapshot, qrSvg] = await Promise.all([
    getStageSnapshot(h.id),
    QRCode.toString(voteUrl, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0c0c0c", light: "#fefefe" },
    }),
  ]);
  return (
    <StageScreen
      hackathonId={h.id}
      editionName={h.name}
      voteUrl={voteUrl.replace(/^https?:\/\//, "")}
      qrSvg={qrSvg}
      initial={snapshot}
    />
  );
}
