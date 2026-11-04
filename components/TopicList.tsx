import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { VoteButtons } from "@/components/VoteButtons";
import type { TopicSummary } from "@/lib/topics";
import { TOPIC_KIND_LABEL, timeAgo, topicHref } from "@/lib/topicsShared";

// Lista de tópicos da comunidade (migration 058): votos à esquerda, título,
// flair, autor, respostas e última atividade, com os selos fixado,
// trancado e resolveu. A mesma linha serve a página /t e o bloco "Tópicos
// em alta" da comunidade (variant="compact", sem votos clicáveis).

export function TopicBadges({ t }: { t: Pick<TopicSummary, "pinned" | "locked" | "resolved" | "removed" | "kind"> }) {
  return (
    <>
      {t.pinned && <span className="border-[1.5px] border-foreground bg-foreground px-1.5 font-mono text-[11px] text-band uppercase">fixado</span>}
      {t.removed && <span className="border-[1.5px] border-orange px-1.5 font-mono text-[11px] text-orange uppercase">removido</span>}
      {t.locked && <span className="border-[1.5px] border-line px-1.5 font-mono text-[11px] uppercase">trancado</span>}
      {t.resolved && <span className="border-[1.5px] border-accent bg-mint px-1.5 font-mono text-[11px] text-accent uppercase">resolveu</span>}
      {t.kind !== "discussao" && <span className="font-mono text-[11px] text-muted uppercase">{TOPIC_KIND_LABEL[t.kind]}</span>}
    </>
  );
}

export function FlairChip({ flair, href }: { flair: string; href?: string }) {
  const cls = "inline-block max-w-full truncate border border-line-soft bg-[#f3f3f3] px-1.5 font-mono text-[11.5px] leading-[18px]";
  return href ? (
    <Link href={href} className={`${cls} hover:border-foreground`}>
      {flair}
    </Link>
  ) : (
    <span className={cls}>{flair}</span>
  );
}

export function TopicList({
  topics,
  slug,
  meId,
  canVote,
  variant = "full",
  now = new Date(),
  testId = "topic-list",
}: {
  topics: TopicSummary[];
  slug: string;
  meId: number | null;
  /** membro da comunidade: as setas funcionam */
  canVote: boolean;
  variant?: "full" | "compact";
  now?: Date;
  testId?: string;
}) {
  const compact = variant === "compact";
  return (
    <ul className="flex flex-col border-b-[1.5px] border-line" data-testid={testId}>
      {topics.map((t) => {
        const href = topicHref(slug, t.id);
        const own = t.author?.id === meId;
        const reason = !canVote ? "Entre na comunidade pra votar." : own ? "Esse é seu." : t.removed || t.deleted ? "Saiu do ar." : null;
        return (
          <li
            key={t.id}
            className={`flex min-w-0 gap-3 border-t-[1.5px] border-line py-3 ${t.pinned ? "bg-[#f6fbf8]" : ""} ${compact ? "items-center" : "items-start"}`}
            data-testid="topic-row"
            data-topic-id={t.id}
          >
            {compact ? (
              <span
                className="flex h-10 w-10 shrink-0 flex-col items-center justify-center border-[1.5px] border-line font-mono text-[13px] leading-none font-bold tabular-nums"
                aria-label={`${t.score} votos`}
              >
                {t.score}
                <span className="mt-0.5 text-[9px] font-normal text-muted">votos</span>
              </span>
            ) : (
              <VoteButtons endpoint={`/api/topics/${t.id}/vote`} score={t.score} myVote={t.myVote} disabledReason={reason} />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <TopicBadges t={t} />
                {t.flair && <FlairChip flair={t.flair} href={compact ? undefined : `/comunidade/${slug}/t?flair=${encodeURIComponent(t.flair)}`} />}
              </div>
              <Link
                href={href}
                className={`min-w-0 font-bold break-words underline-offset-4 hover:text-accent hover:underline ${compact ? "text-[15.5px] leading-snug" : "text-[17px] leading-snug tracking-[-0.01em]"} ${t.removed || t.deleted ? "text-muted" : ""}`}
                data-testid="topic-link"
              >
                {t.title}
              </Link>
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-muted">
                {t.author ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Avatar username={t.author.username} name={t.author.name} avatarUrl={t.author.avatarUrl} size="sm" />
                    <span className="truncate">@{t.author.username}</span>
                  </span>
                ) : (
                  <span>[apagado]</span>
                )}
                <span aria-hidden="true">·</span>
                <span data-testid="topic-replies">
                  {t.replyCount} {t.replyCount === 1 ? "resposta" : "respostas"}
                </span>
                <span aria-hidden="true">·</span>
                <span title={t.lastActivityAt}>{timeAgo(t.lastActivityAt, now)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
