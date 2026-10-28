import type { Metadata } from "next";
import Link from "next/link";
import { CommunityRows } from "@/components/CommunityRows";
import { listCommunities, nearby } from "@/lib/communities";
import { followStates } from "@/lib/follows";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "comunidades",
  description: "As comunidades de hackathon no HackaHub: quem organiza na sua cidade, os membros e os próximos hackathons.",
  robots: { index: false },
};

// /comunidades (logado): busca por nome ou cidade, "perto de você" pela
// cidade do perfil e o resto pela atividade real (o que aconteceu por último).
export default async function ComunidadesPage({ searchParams }: PageProps<"/comunidades">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const [member, list] = await Promise.all([currentMember(), listCommunities({ q })]);
  const near = q ? [] : nearby(list, member?.city);
  const nearIds = new Set(near.map((n) => n.item.id));
  const rest = list.filter((c) => !nearIds.has(c.id));
  const nearMap = new Map(near.map((n) => [n.item.id, n.match] as const));
  const follow = member ? await followStates(member.id) : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-5 border-b-2 border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="tag self-start">COMUNIDADES</p>
          <h1 className="text-[clamp(2.3rem,6vw,3.75rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
            Quem faz hackathon por aí.
          </h1>
          <p className="max-w-[52ch] text-[16px] leading-relaxed text-[#2b2b2b]">
            Entre na comunidade da sua cidade, da sua faculdade ou do seu tema. É lá que saem os próximos hackathons. A de
            outra cidade dá pra só seguir: o que ela publica aparece no seu feed.
          </p>
        </div>
        <Link href="/comunidades/nova" className="btn shrink-0 self-start sm:self-auto" data-testid="comunidades-criar">
          criar comunidade →
        </Link>
      </header>

      <form action="/comunidades" role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="nome ou cidade"
          aria-label="buscar comunidade por nome ou cidade"
          className="w-full max-w-md rounded-[6px] border-[1.5px] border-line bg-background px-4 py-2.5 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button type="submit" className="btn-ghost shrink-0 rounded-[6px]">
          buscar
        </button>
      </form>

      {near.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="comunidades-perto">
          <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">perto de você</h2>
          <CommunityRows communities={near.map((n) => n.item)} near={nearMap} follow={follow} />
        </div>
      )}

      {!q && !member?.city && (
        <p className="font-mono text-[13px] text-muted">
          Ponha sua cidade no{" "}
          <Link href="/perfil" className="text-accent underline underline-offset-4">
            perfil
          </Link>{" "}
          pra ver as comunidades perto de você primeiro.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">
          {q ? `resultado pra “${q}”` : near.length > 0 ? "outras comunidades" : "todas"}
        </h2>
        {rest.length > 0 ? (
          <CommunityRows communities={rest} testId="comunidades-lista" follow={follow} />
        ) : (
          <div className="flex flex-col items-start gap-3 border-[1.5px] border-line p-5" data-testid="comunidades-vazio">
            <p className="text-[17px] font-bold">
              {q ? "Nenhuma comunidade com esse nome ou cidade." : "Ainda não tem outra comunidade por aqui."}
            </p>
            <Link href="/comunidades/nova" className="cta-link go text-[16px]">
              Criar a primeira
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
