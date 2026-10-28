import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SupportersAdmin } from "@/components/CommunitySupportActions";
import { canManageCommunity, getCommunityBySlug } from "@/lib/communities";
import { listSupporters } from "@/lib/communitySupporters";
import { leadMailto, listCommunityLeads } from "@/lib/leads";
import { currentMember } from "@/lib/session";
import { SUPPORT_KIND_LABELS } from "@/lib/supportKinds";

export const metadata: Metadata = { title: "apoio da comunidade", robots: { index: false } };

// Painel de apoio da comunidade (migration 028): quem apoia (cadastrar,
// ordenar, remover) e os pedidos de "quero apoiar" que chegaram pela página.
// Só dono, organizador ou admin global; pros outros a página não existe.

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default async function ApoioComunidadePage({ params }: PageProps<"/comunidade/[slug]/apoio">) {
  const { slug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  if (!(await canManageCommunity(member, c.id))) notFound();
  const [supporters, rawLeads] = await Promise.all([listSupporters(c.id), listCommunityLeads(c.id)]);
  // e-mail fora do padrão seguro (lead antigo) aparece sem link de resposta
  const leads = rawLeads.map((l) => ({ ...l, mailto: leadMailto(l.email) }));

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-12 overflow-x-clip px-4 py-10 sm:px-6 sm:py-14" data-testid="community-support-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {c.name}
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Apoio</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">
          Quem apoia a comunidade aparece em &quot;Quem apoia&quot;, na página dela. Os pedidos chegam pelo botão &quot;quero apoiar&quot; e
          só a organização vê.
        </p>
      </header>

      <section aria-labelledby="apoiadores-title" className="flex flex-col gap-4">
        <h2 id="apoiadores-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
          Quem apoia <span className="font-mono text-[15px] font-normal text-muted">{supporters.length}</span>
        </h2>
        <SupportersAdmin
          slug={c.slug}
          supporters={supporters.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            url: s.url,
            logoUrl: s.logoUrl,
            description: s.description,
          }))}
        />
      </section>

      <section id="pedidos" aria-labelledby="pedidos-title" className="flex scroll-mt-24 flex-col gap-4">
        <h2 id="pedidos-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
          Pedidos de apoio <span className="font-mono text-[15px] font-normal text-muted">{leads.length}</span>
        </h2>
        {leads.length > 0 ? (
          <ul className="flex flex-col border-b border-line" data-testid="support-leads">
            {leads.map((l) => (
              <li key={l.id} className="flex flex-col gap-1.5 border-t border-line py-3" data-testid="support-lead">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 font-bold break-words">{l.company}</span>
                  <span className="font-mono text-[12px] text-muted">{fmt.format(new Date(l.createdAt))}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {l.supportKind && <span className="chip bare">{SUPPORT_KIND_LABELS[l.supportKind]}</span>}
                  {l.mailto ? (
                    <a href={l.mailto} className="font-mono text-[13px] break-all text-accent underline-offset-4 hover:underline">
                      {l.email}
                    </a>
                  ) : (
                    <span className="font-mono text-[13px] break-all">{l.email}</span>
                  )}
                </span>
                {l.message && <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-line text-[#2b2b2b]">{l.message}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-[1.5px] border-line px-4 py-4 text-[15px] text-muted" data-testid="support-leads-empty">
            Nenhum pedido ainda. Quem abre a página da comunidade vê o botão &quot;quero apoiar esta comunidade&quot;.
          </p>
        )}
      </section>
    </section>
  );
}
