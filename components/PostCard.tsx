"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { userMessage } from "@/lib/apiError";
import { levelFor } from "@/lib/game";
import type { Post } from "@/lib/posts";
import { REACTION_GLYPH, REACTION_KINDS, REACTION_LABEL, type ReactionKind } from "@/lib/reactions";
import { Avatar } from "@/components/Avatar";
import { LinkCard } from "@/components/LinkCard";
import { MentionField } from "@/components/MentionField";
import { ReportDialog } from "@/components/ReportDialog";
import { RichText } from "@/components/RichText";

// O ÚNICO lugar que renderiza post (spec 046, migration 034). Feed, mural da
// edição, mural da comunidade, /post/[id] e as próximas ondas (timeline,
// perfil, projeto vivo) usam este card. O corpo é <RichText> (migration 039):
// @ vira link de quem existe, # vira /tag/[tag], url abre fora. O card guarda
// o próprio estado depois de montado: quem lista passa key={post.id}.
//
// Repost e citação (migration 049): repost é o card do original com um
// cabeçalho "@x compartilhou" (as ações — reação, comentário, compartilhar —
// são as do original); citação é o corpo de quem citou com o original numa
// caixa embaixo, ou "post apagado". Compartilhar é toggle e não dá XP.

export type PostCardMe = { id: number; username: string; role: string } | null;

const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export const formatPostTime = (s: string) => fmt.format(new Date(s.replace(" ", "T") + "Z"));

/** "@x compartilhou", "@a e @b compartilharam", "@a, @b e mais 2 compartilharam" */
export function shareLine(names: string[]): string {
  const at = names.map((n) => `@${n}`);
  if (at.length === 0) return "alguém compartilhou";
  if (at.length === 1) return `${at[0]} compartilhou`;
  if (at.length === 2) return `${at[0]} e ${at[1]} compartilharam`;
  return `${at[0]}, ${at[1]} e mais ${at.length - 2} compartilharam`;
}

export function PostCard({
  post: initial,
  me,
  showThreadLink = true,
  context = null,
  onChange,
  onRemoved,
  onAuthorHidden,
}: {
  post: Post;
  me: PostCardMe;
  /** "N comentários" leva a /post/[id]; na própria página do post fica de fora */
  showThreadLink?: boolean;
  /** mural onde o card está: o chip do próprio espaço some */
  context?: { hackathonId?: string | null; communitySlug?: string | null } | null;
  onChange?: (post: Post) => void;
  onRemoved?: (id: number) => void;
  /** denunciar bloqueia o autor: quem lista tira o que é dele da vista */
  onAuthorHidden?: (username: string) => void;
}) {
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ body: initial.body, link: initial.link ?? "" });
  const [quoting, setQuoting] = useState(false);
  const [quoteText, setQuoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const mine = !!me && (post.memberId === me.id || post.username === me.username);
  const canReport = !!me && !mine;
  const hasMenu = mine || post.canModerate || canReport;

  // menu fecha com clique fora e Esc (a caixa de denúncia, aberta de dentro
  // dele, segura o menu montado enquanto estiver aberta)
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function update(next: Post) {
    setPost(next);
    onChange?.(next);
  }

  async function react(kind: ReactionKind) {
    if (!me || mine || busy) return;
    const next = post.myReaction === kind ? null : kind;
    const prev = post;
    // otimista: troca na hora, desfaz se a API recusar
    const reactions = { ...post.reactions };
    if (post.myReaction) reactions[post.myReaction] = Math.max(0, reactions[post.myReaction] - 1);
    if (next) reactions[next] += 1;
    const likeCount = REACTION_KINDS.reduce((s, k) => s + reactions[k], 0);
    update({ ...post, reactions, myReaction: next, likeCount, likedByMe: next !== null });
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/posts/${post.id}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => null) : null;
      update(prev);
      setError(res ? userMessage(res, data, "Não deu pra reagir. Tente de novo.") : "Sem conexão. Tente de novo.");
      return;
    }
    const data = (await res.json()) as { kind: ReactionKind | null; reactions: Post["reactions"]; likeCount: number };
    update({ ...prev, reactions: data.reactions, myReaction: data.kind, likeCount: data.likeCount, likedByMe: data.kind !== null });
  }

  /** compartilhar é toggle: POST cria o repost, DELETE tira o meu */
  async function toggleShare() {
    if (!me || mine || busy) return;
    const prev = post;
    const reposted = !post.repostedByMe;
    // otimista: o contador anda na hora, desfaz se a API recusar
    update({
      ...post,
      repostedByMe: reposted,
      shareCount: Math.max(0, post.shareCount + (reposted ? 1 : -1)),
    });
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/posts/${post.id}/repost`, { method: reposted ? "POST" : "DELETE" }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      update(prev);
      setError(res ? userMessage(res, data, "Não deu pra compartilhar. Tente de novo.") : "Sem conexão. Tente de novo.");
      return;
    }
    update({
      ...prev,
      repostedByMe: Boolean(data?.reposted),
      shareCount: typeof data?.shareCount === "number" ? data.shareCount : prev.shareCount,
    });
  }

  /** citação: corpo próprio e o original na caixa, no /post da citação */
  async function sendQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!quoteText.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: quoteText, quoteOfId: post.id }),
    }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setError(res ? userMessage(res, data, "Não deu pra citar. Tente de novo.") : "Sem conexão. Tente de novo.");
      return;
    }
    setQuoting(false);
    setQuoteText("");
    router.push(`/post/${data.post.id}`);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.body.trim()) return setError("Escreva alguma coisa.");
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft.body, link: draft.link }),
    }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setError(res ? userMessage(res, data, "Não deu pra salvar. Tente de novo.") : "Sem conexão. Tente de novo.");
      return;
    }
    update(data.post as Post);
    setEditing(false);
  }

  /** o autor decide se o post aceita citação (migration 049) */
  async function toggleAllowQuote() {
    setMenu(false);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowQuote: !post.allowQuote }),
    }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setError(res ? userMessage(res, data, "Não deu pra mudar a citação. Tente de novo.") : "Sem conexão. Tente de novo.");
      return;
    }
    update(data.post as Post);
  }

  async function remove() {
    setMenu(false);
    if (!confirm(mine ? "Apagar seu post? Reações e comentários saem junto." : "Apagar este post? Reações e comentários saem junto.")) return;
    setBusy(true);
    const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => null) : null;
      setError(res ? userMessage(res, data, "Não deu pra apagar. Tente de novo.") : "Sem conexão. Tente de novo.");
      return;
    }
    onRemoved?.(post.id);
  }

  const showEdition = post.hackathonId && post.hackathonId !== context?.hackathonId;
  const showCommunity = post.communitySlug && post.communitySlug !== context?.communitySlug;
  const permalink = `/post/${post.id}`;

  // repost: o card do original embaixo, com o cabeçalho de quem compartilhou.
  // As ações são as do original (é o conteúdo dele que está ali).
  if (post.repostOfId !== null) {
    const reposted = post.repostOf;
    const sharers = reposted && reposted.sharedBy.length > 0 ? reposted.sharedBy : [post.username];
    return (
      <article className="flex min-w-0 flex-col gap-2" data-testid="repost-card" data-post-id={post.id}>
        <p className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-muted" data-testid="repost-header">
          <span aria-hidden className="font-bold text-accent">
            ↻
          </span>
          <span className="min-w-0 break-words">{shareLine(sharers)}</span>
        </p>
        {post.repostOf ? (
          <div className="min-w-0 border-[1.5px] border-line px-3 py-3 sm:px-4">
            <PostCard
              post={post.repostOf}
              me={me}
              showThreadLink={showThreadLink}
              context={context}
              onRemoved={(id) => {
                onRemoved?.(post.id);
                onRemoved?.(id);
              }}
              onAuthorHidden={onAuthorHidden}
            />
          </div>
        ) : (
          <p className="border-[1.5px] border-dashed border-line px-3 py-2 font-mono text-[12px] text-muted" data-testid="post-gone">
            post apagado
          </p>
        )}
        {error && (
          <p role="alert" className="font-mono text-xs text-orange">
            {error}
          </p>
        )}
      </article>
    );
  }

  return (
    <article className="flex min-w-0 flex-col gap-3" data-testid="post-card" data-post-id={post.id}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Avatar username={post.username} name={post.name} avatarUrl={post.avatarUrl} size="md" />
          <Link href={`/u/${post.username}`} className="min-w-0 truncate text-[15px] font-bold hover:text-accent">
            {post.name ?? `@${post.username}`}
          </Link>
          <span className="font-mono text-xs text-muted">@{post.username}</span>
          <span className="border border-line px-1.5 font-mono text-[12px] text-muted">LV{levelFor(post.xp).level.n}</span>
          {post.persona && (
            <span className="border border-line bg-mint px-1.5 font-mono text-[12px] text-accent">{post.persona}</span>
          )}
          {!post.allowQuote && (
            <span
              className="border border-line px-1.5 font-mono text-[12px] text-muted"
              data-testid="post-no-quote"
              title="Este post não aceita citação"
            >
              sem citação
            </span>
          )}
          {post.headline && <span className="w-full truncate font-mono text-xs text-muted sm:w-auto">{post.headline}</span>}
        </div>
        {hasMenu && me && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label="ações do post"
              data-testid="post-menu"
              className="min-h-[32px] min-w-[32px] border-[1.5px] border-transparent px-1.5 font-mono text-[15px] leading-none text-muted transition hover:border-line hover:text-foreground"
            >
              ···
            </button>
            {menu && (
              <div
                role="menu"
                className="absolute top-full right-0 z-20 mt-1 flex w-48 flex-col border-[1.5px] border-line bg-background py-1 shadow-[4px_4px_0_rgba(12,12,12,0.85)]"
              >
                {mine && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setDraft({ body: post.body, link: post.link ?? "" });
                      setError(null);
                      setEditing(true);
                    }}
                    className="px-3 py-2 text-left font-mono text-[13px] hover:bg-mint"
                  >
                    editar
                  </button>
                )}
                {mine && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={toggleAllowQuote}
                    className="px-3 py-2 text-left font-mono text-[13px] hover:bg-mint"
                    data-testid="post-toggle-quote"
                  >
                    {post.allowQuote ? "não aceitar citação" : "aceitar citação"}
                  </button>
                )}
                {post.canModerate && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={remove}
                    className="px-3 py-2 text-left font-mono text-[13px] text-orange hover:bg-mint"
                  >
                    apagar
                  </button>
                )}
                {canReport && (
                  <ReportDialog
                    targetType="post"
                    targetId={post.id}
                    targetLabel="este post"
                    authorUsername={post.username}
                    triggerClassName="w-full px-3 py-2 text-left font-mono text-[13px] hover:bg-mint"
                    onReported={(r) => {
                      setMenu(false);
                      if (r.blocked) onAuthorHidden?.(r.blocked);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {(showEdition || showCommunity) && (
        <div className="flex flex-wrap gap-2">
          {showEdition && (
            <Link
              href={`/h/${post.hackathonId}`}
              className="border border-line px-1.5 font-mono text-[12px] text-muted transition hover:text-accent"
            >
              → {post.hackathonName ?? post.hackathonId}
            </Link>
          )}
          {showCommunity && (
            <Link
              href={`/comunidade/${post.communitySlug}`}
              className="border border-line px-1.5 font-mono text-[12px] text-muted transition hover:text-accent"
            >
              → {post.communityName}
            </Link>
          )}
        </div>
      )}

      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-2" data-testid="post-edit">
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            rows={4}
            maxLength={500}
            aria-label="texto do post"
            className="w-full resize-y rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] focus:border-accent focus:outline-none"
          />
          <input
            value={draft.link}
            onChange={(e) => setDraft((d) => ({ ...d, link: e.target.value }))}
            placeholder="link (opcional)"
            aria-label="link do post"
            className="w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="btn min-h-[40px]! rounded-[6px] px-4! py-2! text-[14px]! disabled:opacity-60">
              {busy ? "salvando…" : "salvar"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="font-mono text-[13px] text-muted hover:underline">
              cancelar
            </button>
          </div>
        </form>
      ) : (
        <>
          <RichText body={post.body} mentioned={post.mentionedUsernames} />
          {post.linkCard ? (
            <LinkCard card={post.linkCard} />
          ) : (
            post.link && (
              <a
                href={post.link}
                target={post.link.startsWith("/") ? undefined : "_blank"}
                rel="noopener noreferrer nofollow"
                className="self-start border-[1.5px] border-line px-2.5 py-1 font-mono text-xs break-all text-muted transition hover:text-accent"
              >
                {post.link.replace(/^https?:\/\//, "").slice(0, 60)} ↗
              </a>
            )
          )}
          {post.quoteOfId !== null && (
            <div className="min-w-0 border-[1.5px] border-line bg-background px-3 py-2" data-testid="quote-box">
              {post.quoteOf ? (
                <>
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-[12px] text-muted">
                    <Avatar
                      username={post.quoteOf.username}
                      name={post.quoteOf.name}
                      avatarUrl={post.quoteOf.avatarUrl}
                      size="sm"
                    />
                    <Link href={`/u/${post.quoteOf.username}`} className="truncate font-bold text-foreground hover:text-accent">
                      {post.quoteOf.name ?? `@${post.quoteOf.username}`}
                    </Link>
                    <span className="truncate">@{post.quoteOf.username}</span>
                    <Link href={`/post/${post.quoteOf.id}`} className="shrink-0 hover:text-accent">
                      <time dateTime={post.quoteOf.createdAt.replace(" ", "T") + "Z"}>
                        {formatPostTime(post.quoteOf.createdAt)}
                      </time>
                    </Link>
                  </p>
                  <div className="mt-1 min-w-0 text-[14px]">
                    <RichText body={post.quoteOf.body} mentioned={post.quoteOf.mentionedUsernames} />
                  </div>
                </>
              ) : (
                <p className="font-mono text-[12px] text-muted" data-testid="quote-gone">
                  post apagado
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* recado no perfil (migration 041): reação desligada, sobra a resposta */}
        {post.profileId === null && (
          <div role="group" aria-label="reações" className="flex flex-wrap gap-1.5">
            {REACTION_KINDS.map((k) => {
              const n = post.reactions[k];
              const on = post.myReaction === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => react(k)}
                  disabled={!me || mine}
                  aria-pressed={on}
                  aria-label={`${REACTION_LABEL[k]}${n ? `, ${n}` : ""}`}
                  title={mine ? "reações de quem leu seu post" : REACTION_LABEL[k]}
                  data-testid={`reaction-${k}`}
                  className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-[6px] border-[1.5px] px-2 font-mono text-[12px] transition disabled:cursor-default ${
                    on
                      ? "border-accent bg-mint text-accent"
                      : "border-line-soft text-muted enabled:hover:border-foreground enabled:hover:text-foreground"
                  }`}
                >
                  <span aria-hidden className="font-bold">
                    {REACTION_GLYPH[k]}
                  </span>
                  <span>{REACTION_LABEL[k]}</span>
                  {n > 0 && <span className={on ? "text-accent" : "text-foreground"}>{n}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
          {/* compartilhar e citar (migration 049): nada disso dá XP */}
          <button
            type="button"
            onClick={toggleShare}
            disabled={!me || mine || busy}
            aria-pressed={post.repostedByMe}
            aria-label={post.repostedByMe ? "desfazer compartilhamento" : "compartilhar"}
            title={mine ? "seu próprio post não se compartilha" : post.repostedByMe ? "desfazer compartilhamento" : "compartilhar"}
            data-testid="post-share"
            className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-[6px] border-[1.5px] px-2 transition disabled:cursor-default ${
              post.repostedByMe
                ? "border-accent bg-mint text-accent"
                : "border-line-soft text-muted enabled:hover:border-foreground enabled:hover:text-foreground"
            }`}
          >
            <span aria-hidden className="font-bold">
              ↻
            </span>
            <span>{post.repostedByMe ? "compartilhado" : "compartilhar"}</span>
            {post.shareCount > 0 && (
              <span className={post.repostedByMe ? "text-accent" : "text-foreground"} data-testid="share-count">
                {post.shareCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setQuoting((q) => !q);
              setError(null);
            }}
            disabled={!me || !post.allowQuote}
            aria-expanded={quoting}
            aria-label="citar este post"
            title={post.allowQuote ? "citar este post" : "a pessoa não aceita citação neste post"}
            data-testid="post-quote"
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-[6px] border-[1.5px] border-line-soft px-2 text-muted transition enabled:hover:border-foreground enabled:hover:text-foreground disabled:cursor-default disabled:opacity-60"
          >
            <span aria-hidden className="font-bold">
              ❝
            </span>
            <span>citar</span>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3 font-mono text-[12px] text-muted">
          {showThreadLink && (
            <Link href={permalink} className="transition hover:text-accent" data-testid="post-comments-link">
              {post.commentCount} {post.commentCount === 1 ? "comentário" : "comentários"}
            </Link>
          )}
          <Link href={permalink} className="transition hover:text-accent" title="endereço deste post">
            <time dateTime={post.createdAt.replace(" ", "T") + "Z"}>{formatPostTime(post.createdAt)}</time>
          </Link>
          {post.editedAt && <span data-testid="post-edited">editado</span>}
        </div>
      </div>
      {quoting && (
        <form onSubmit={sendQuote} className="flex min-w-0 flex-col gap-2 border-[1.5px] border-line p-3" data-testid="quote-form">
          <p className="font-mono text-[12px] text-muted">
            citando <span className="text-foreground">@{post.username}</span>
          </p>
          <MentionField
            value={quoteText}
            onChange={setQuoteText}
            rows={3}
            maxLength={500}
            ariaLabel="o que você achou deste post"
            placeholder="O que você achou deste post?"
            className="w-full resize-none border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !quoteText.trim()}
              className="btn min-h-[40px]! rounded-[6px] px-4! py-2! text-[14px]! disabled:opacity-60"
            >
              {busy ? "citando…" : "citar →"}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuoting(false);
                setQuoteText("");
              }}
              className="font-mono text-[13px] text-muted hover:underline"
            >
              cancelar
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="font-mono text-xs text-orange">
          {error}
        </p>
      )}
    </article>
  );
}
