import Link from "next/link";
import { listMyCommunities } from "@/lib/communities";

// Comunidade como crachá no perfil (spec 046, perfil-rico; estudo 044 §1.1).
// Mostra as comunidades em que a pessoa é MEMBRO (seguir comunidade não é
// crachá), com dono e organizador na frente — a ordem de listMyCommunities,
// que também já esconde comunidade escondida.
export async function CommunityBadges({ memberId }: { memberId: number }) {
  const all = await listMyCommunities(memberId);
  const mine = all.filter((c) => c.role !== "segue");
  if (mine.length === 0) return null;
  return (
    <section aria-labelledby="crachas-title" className="flex flex-col gap-3" data-testid="community-badges">
      <h2 id="crachas-title" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
        comunidades
      </h2>
      <ul className="flex flex-wrap gap-2">
        {mine.map((c) => (
          <li key={c.id} className="min-w-0">
            <Link
              href={`/comunidade/${c.slug}`}
              className="flex max-w-[15rem] items-center gap-1.5 border-[1.5px] border-line px-2 py-1 font-mono text-[12px] transition hover:border-accent hover:text-accent"
            >
              <span className="truncate">{c.name}</span>
              {c.role !== "membro" && (
                <span className="shrink-0 border border-line bg-mint px-1 text-[10px] text-accent">
                  {c.role}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
