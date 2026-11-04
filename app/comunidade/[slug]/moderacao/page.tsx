import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { DeletePostButton, RemoveMemberButton, TransferOwnership, DeleteCommunity, UnbanButton } from "@/components/CommunityModActions";
import { ReportQueue, reportTypeParam } from "@/components/ReportQueue";
import { canManageCommunity, getCommunityBySlug, getMembership, listCommunityMembers } from "@/lib/communities";
import {
  listCommunityBans,
  listCommunityLog,
  modLogLine,
  usernamesByIds,
} from "@/lib/communityModeration";
import { formatDbTime } from "@/lib/format";
import { listPosts } from "@/lib/posts";
import { countOpenByType, listReports } from "@/lib/reports";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "moderação da comunidade", robots: { index: false } };

// /comunidade/[slug]/moderacao (migration 046): o dono e os organizadores
// moderam o próprio espaço sem o admin global. Três blocos — denúncias
// abertas do mural, posts recentes (apagar o post ou remover o autor) e o
// log — mais a área do dono: passar a posse e excluir a comunidade.

const TRECHO = 220;

export default async function ModeracaoComunidadePage({ params, searchParams }: PageProps<"/comunidade/[slug]/moderacao">) {
  const { slug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  if (!(await canManageCommunity(member, c.id))) notFound();

  const type = reportTypeParam((await searchParams).tipo);
  const scope = { communityId: c.id, viewerId: member.id };
  const [open, resolved, counts, posts, log, bans, members, role] = await Promise.all([
    listReports(scope, { type }),
    listReports(scope, { status: "resolved", limit: 20 }),
    countOpenByType(scope),
    listPosts(20, member.id, { communityId: c.id }),
    listCommunityLog(c.id),
    listCommunityBans(c.id),
    listCommunityMembers(c.id),
    getMembership(c.id, member.id),
  ]);
  // autor do conteúdo denunciado: é o @ que a moderação remove
  const authors = await usernamesByIds(open.map((r) => r.targetMemberId ?? 0));
  const openTotal = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const isOwner = member.role === "admin" || role === "dono";
  const organizers = members
    .filter((m) => m.role === "organizador" && m.memberId !== member.id)
    .map((m) => ({ username: m.username, name: m.name }));

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-12 overflow-x-clip px-4 py-10 sm:px-6 sm:py-14" data-testid="community-moderation-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {c.name}
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Moderação</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">
          O que a organização da comunidade decide aqui vale na hora: a denúncia sai da fila, o post sai do mural e quem
          atrapalha sai do espaço. O nome de quem denunciou nunca aparece.
        </p>
      </header>

      {/* 1. fila de denúncia da comunidade */}
      <section id="denuncias" aria-labelledby="denuncias-title" className="flex scroll-mt-24 flex-col gap-4" data-testid="mod-reports">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="denuncias-title" className="text-[clamp(1.5rem,3vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
            Denúncias abertas <span className="font-mono text-[15px] font-normal text-muted">{openTotal}</span>
          </h2>
          <Link href={`/comunidade/${c.slug}/denuncias`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
            fila com filtro por tipo →
          </Link>
        </div>
        <ReportQueue
          open={open}
          resolved={resolved}
          counts={counts}
          type={type}
          basePath={`/comunidade/${c.slug}/moderacao`}
          anchor="#denuncias"
          empty="Nenhuma denúncia aberta. O mural está de pé."
          extra={(r) => {
            const author = r.targetMemberId ? authors[r.targetMemberId] : undefined;
            return (
              <>
                {r.targetType === "post" && <DeletePostButton postId={Number(r.targetId)} />}
                {author && r.targetMemberId !== member.id && (
                  <RemoveMemberButton slug={c.slug} username={author} label={`remover @${author}`} />
                )}
              </>
            );
          }}
        />
      </section>

      {/* 2. mural recente: apagar post e remover autor */}
      <section id="mural" aria-labelledby="mural-title" className="flex scroll-mt-24 flex-col gap-4" data-testid="mod-mural">
        <h2 id="mural-title" className="text-[clamp(1.5rem,3vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
          Mural recente
        </h2>
        {posts.length === 0 ? (
          <p className="border-[1.5px] border-dashed border-line px-4 py-5 font-mono text-[13px] text-muted" data-testid="mod-mural-empty">
            Ninguém postou no mural ainda.
          </p>
        ) : (
          <ul className="flex flex-col border-b border-line" data-testid="mod-mural-list">
            {posts.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 border-t border-line py-3" data-testid="mod-mural-item">
                <div className="flex items-start gap-3">
                  <Avatar username={p.username} name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[12px] text-muted">
                      <Link href={`/u/${p.username}`} className="text-foreground underline-offset-4 hover:underline">
                        @{p.username}
                      </Link>
                      {formatDbTime(p.createdAt)}
                    </span>
                    <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-line [overflow-wrap:anywhere]">
                      {p.body.length > TRECHO ? `${p.body.slice(0, TRECHO)}…` : p.body}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <DeletePostButton postId={p.id} testId={`mod-delete-mural-${p.id}`} />
                  {p.memberId !== member.id && (
                    <RemoveMemberButton slug={c.slug} username={p.username} testId={`mod-remove-mural-${p.id}`} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. quem está impedido de voltar (só aparece quando existe) */}
      {bans.length > 0 && (
        <section id="impedidos" aria-labelledby="impedidos-title" className="flex scroll-mt-24 flex-col gap-4" data-testid="mod-bans">
          <h2 id="impedidos-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
            Impedidos de voltar <span className="font-mono text-[15px] font-normal text-muted">{bans.length}</span>
          </h2>
          <ul className="flex flex-col border-b border-line">
            {bans.map((b) => (
              <li key={b.memberId} className="flex items-start justify-between gap-3 border-t border-line py-2.5" data-testid="mod-ban-item">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[14.5px] font-semibold break-words">
                    {b.name ?? `@${b.username}`} <span className="font-mono text-[12px] font-normal text-muted">@{b.username}</span>
                  </span>
                  <span className="font-mono text-[12px] break-words text-muted">
                    {b.reason ? `${b.reason} · ` : ""}
                    {formatDbTime(b.createdAt)}
                    {b.byUsername ? ` · por @${b.byUsername}` : ""}
                  </span>
                </span>
                <UnbanButton slug={c.slug} username={b.username} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4. o log: quem fez o quê, quando */}
      <section id="log" aria-labelledby="log-title" className="flex scroll-mt-24 flex-col gap-4" data-testid="mod-log">
        <h2 id="log-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
          O que a organização fez
        </h2>
        {log.length === 0 ? (
          <p className="border-[1.5px] border-dashed border-line px-4 py-5 font-mono text-[13px] text-muted" data-testid="mod-log-empty">
            Nada registrado ainda. Aviso editado, membro removido e denúncia resolvida aparecem aqui.
          </p>
        ) : (
          <ul className="flex flex-col border-b border-line" data-testid="mod-log-list">
            {log.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line py-2 font-mono text-[12.5px]">
                <span className="break-words">
                  {e.username ? `@${e.username} ` : ""}
                  {modLogLine(e)}
                </span>
                <span className="text-muted">{formatDbTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* área do dono: posse e exclusão */}
      {isOwner && (
        <section id="dono" aria-labelledby="dono-title" className="flex flex-col gap-6 border-t-2 border-line pt-6" data-testid="mod-owner">
          <h2 id="dono-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
            Só o dono
          </h2>
          <TransferOwnership slug={c.slug} organizers={organizers} />
          <DeleteCommunity slug={c.slug} />
        </section>
      )}
    </section>
  );
}
