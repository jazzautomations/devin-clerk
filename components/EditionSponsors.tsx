import { TIER_LABEL, type EditionSponsor } from "@/lib/editionSponsors";

// Patrocinadores na página pública da edição (roadmap 037 #8): logo (ou o
// nome, sem logo cadastrado) por nível — master primeiro. Server component.
export function EditionSponsors({ sponsors }: { sponsors: EditionSponsor[] }) {
  if (sponsors.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 border-t border-l border-line sm:grid-cols-3" data-testid="edition-sponsors">
      {sponsors.map((s) => {
        const mark = s.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo remoto da marca; next/image exigiria remotePatterns
          <img src={s.logoUrl} alt={`logo de ${s.name}`} className="h-12 w-full max-w-[160px] object-contain" />
        ) : (
          <span className="text-[17px] font-extrabold tracking-[-0.02em] break-words">{s.name}</span>
        );
        return (
          <li key={s.sponsorId} className="flex min-w-0 flex-col items-center justify-center gap-2 border-r border-b border-line p-4">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener" className="flex w-full justify-center" title={s.name}>
                {mark}
              </a>
            ) : (
              mark
            )}
            <span className="font-mono text-[11px] tracking-[0.06em] text-muted uppercase">{TIER_LABEL[s.tier]}</span>
          </li>
        );
      })}
    </ul>
  );
}
