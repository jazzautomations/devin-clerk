import Link from "next/link";
import { getSession } from "@/lib/stage";

// Modo palco — chamada na página da edição: com a final ao vivo, leva pro
// voto e pro telão; encerrada, pro resultado. Antes da final não aparece.
export async function StageCta({ hackathonId }: { hackathonId: string }) {
  const s = await getSession(hackathonId);
  if (s.status === "idle") return null;
  const live = s.status === "live";
  return (
    <div className="window dark hard" data-testid="stage-cta">
      <div className="tbar">
        <span className="title">{live ? "FINAL_AO_VIVO.exe" : "RESULTADO.exe"}</span>
        <span className="dots" aria-hidden>
          <b />
          <b />
        </span>
      </div>
      <div className="tbody gap-3 p-5!">
        <p className={`pix text-[30px] leading-none ${live ? "animate-pulse" : ""}`}>
          {live ? "● FINAL AO VIVO" : "ESCOLHA DO PÚBLICO"}
        </p>
        {live ? (
          <>
            <p className="text-[13px] leading-snug text-mint">
              Fez check-in? Dá nota de 1 a 5 em cada pitch, do celular.
            </p>
            <Link href={`/h/${hackathonId}/votar`} className="btn w-full rounded-[6px]">
              votar agora →
            </Link>
          </>
        ) : (
          <p className="text-[13px] leading-snug text-mint">A plateia votou pitch a pitch na final.</p>
        )}
        <Link href={`/h/${hackathonId}/telao`} className="font-mono text-[13px] text-band underline-offset-4 hover:underline">
          {live ? "ver o telão ↗" : "ver o ranking ↗"}
        </Link>
      </div>
    </div>
  );
}
