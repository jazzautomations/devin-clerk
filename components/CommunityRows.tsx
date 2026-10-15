import Link from "next/link";
import { CommunityLogo } from "@/components/CommunityLogo";
import type { CommunityListItem } from "@/lib/communities";
import { parseEventTime } from "@/lib/eventTime";

const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });

/** onde a comunidade está: cidade, "online" ou as duas coisas */
export function communityPlace(c: { city: string | null; online: boolean }): string {
  if (c.city && c.online) return `${c.city} e online`;
  return c.city ?? "online";
}

// lista de comunidades (/comunidades, landing): só número do banco —
// membros e hackathons; próximo hackathon quando existe
export function CommunityRows({
  communities,
  testId,
  near,
}: {
  communities: CommunityListItem[];
  testId?: string;
  near?: Map<number, "cidade" | "estado">;
}) {
  return (
    <ul className="border-b-2 border-line" data-testid={testId}>
      {communities.map((c) => {
        const match = near?.get(c.id);
        return (
          <li key={c.id} className="border-t-2 border-line" data-testid="community-row">
            <Link
              href={`/comunidade/${c.slug}`}
              className="group grid grid-cols-[56px_1fr] items-center gap-x-4 gap-y-2 py-4 hover:bg-mint sm:grid-cols-[56px_1fr_auto] sm:gap-x-6 sm:px-2"
            >
              <CommunityLogo name={c.name} logoUrl={c.logoUrl} />
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[clamp(1.05rem,2.2vw,1.35rem)] leading-tight font-extrabold tracking-[-0.025em] group-hover:underline">
                    {c.name}
                  </span>
                  {c.verified && (
                    <span className="chip bare shrink-0 border-accent! bg-mint! text-accent!" title="verificada pelo HackaHub">
                      verificada
                    </span>
                  )}
                </span>
                <span className="mt-1 block truncate font-mono text-[12.5px] text-muted">
                  {communityPlace(c)}
                  {c.members > 0 && ` · ${c.members} ${c.members === 1 ? "membro" : "membros"}`}
                  {c.hackathons > 0 && ` · ${c.hackathons} ${c.hackathons === 1 ? "hackathon" : "hackathons"}`}
                </span>
              </span>
              <span className="col-start-2 flex flex-wrap gap-1.5 sm:col-start-3 sm:justify-end">
                {match && <span className="chip bare bg-foreground! text-band!">{match === "cidade" ? "na sua cidade" : "no seu estado"}</span>}
                {c.nextId && parseEventTime(c.nextStartsAt) && (
                  <span className="chip bare max-w-[220px] truncate">
                    próximo hackathon: {fmtDia.format(parseEventTime(c.nextStartsAt)!).replace(".", "")}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
