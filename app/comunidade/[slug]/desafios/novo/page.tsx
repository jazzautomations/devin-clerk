import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageCommunity, getCommunityBySlug } from "@/lib/communities";
import { toBrtInput } from "@/lib/eventTime";
import { formatDeadline, getOpenChallenge, listDrafts } from "@/lib/openChallenges";
import { currentMember } from "@/lib/session";
import { ChallengeForm } from "./ChallengeForm";

export const metadata: Metadata = { title: "novo desafio", robots: { index: false } };

// Criar desafio aberto (migration 053): dono, organizador ou admin. Com
// ?rascunho=id continua um rascunho desta comunidade. Pros outros a página
// não existe.

export default async function NovoDesafioPage({ params, searchParams }: PageProps<"/comunidade/[slug]/desafios/novo">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  if (!(await canManageCommunity(member, c.id))) notFound();

  const draftId = typeof sp.rascunho === "string" && /^\d{1,9}$/.test(sp.rascunho) ? Number(sp.rascunho) : null;
  const draft = draftId ? await getOpenChallenge(draftId) : null;
  const editing = draft && draft.communityId === c.id && draft.status === "rascunho" ? draft : null;
  const drafts = (await listDrafts(c.id)).filter((d) => d.id !== editing?.id);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 overflow-x-clip px-4 py-10 sm:px-6 sm:py-14" data-testid="desafio-novo-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href="/desafios" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← desafios
        </Link>
        <p className="font-mono text-[13px] text-muted">{c.name}</p>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
          {editing ? "Continuar desafio" : "Novo desafio"}
        </h1>
        <p className="max-w-[60ch] text-[15px] text-muted">
          Quem tem conta entrega até o prazo. Você escolhe os três primeiros e o resultado fica na página do desafio. Ao publicar, membros
          e seguidores da comunidade recebem um aviso.
        </p>
      </header>

      {drafts.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="desafio-rascunhos">
          <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">rascunhos</h2>
          <ul className="border-b border-line">
            {drafts.map((d) => (
              <li key={d.id} className="border-t border-line">
                <Link
                  href={`/comunidade/${c.slug}/desafios/novo?rascunho=${d.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 hover:bg-mint sm:px-2"
                >
                  <span className="min-w-0 font-bold break-words">{d.title}</span>
                  <span className="font-mono text-[12px] text-muted">prazo {formatDeadline(d.deadline)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ChallengeForm
        key={editing?.id ?? "novo"}
        community={{ slug: c.slug, name: c.name }}
        draftId={editing?.id ?? null}
        initial={
          editing
            ? {
                title: editing.title,
                sponsorName: editing.sponsorName ?? "",
                prize: editing.prize ?? "",
                deadline: toBrtInput(editing.deadline),
                brief: editing.brief,
                rules: editing.rules ?? "",
              }
            : undefined
        }
      />
    </section>
  );
}
