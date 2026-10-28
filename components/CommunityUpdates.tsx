import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { updateHref, type CommunityUpdate } from "@/lib/follows";
import { parseEventTime } from "@/lib/eventTime";

// Novidades das comunidades que a pessoa segue (/feed "minhas comunidades" e
// painel): post do mural, aviso, hackathon publicado e evento da agenda, cada um com a
// comunidade e a data. Clicar abre onde a coisa mora.

const KIND_LABEL = { post: "mural", aviso: "aviso", hackathon: "hackathon", agenda: "agenda" } as const;

const fmtQuando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });

/** "2026-10-27 14:03:00" (UTC do banco) → "27 de out., 11:03" */
export function fmtUpdateAt(at: string): string {
  const d = new Date(`${at.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : fmtQuando.format(d);
}

export function CommunityUpdates({ items, testId, compact = false }: { items: CommunityUpdate[]; testId?: string; compact?: boolean }) {
  return (
    <ul className="border-b border-line" data-testid={testId}>
      {items.map((u) => {
        const dated = u.kind === "hackathon" || u.kind === "agenda";
        const starts = dated ? parseEventTime(u.startsAt) : null;
        return (
          <li key={`${u.kind}-${u.id}`} className="flex min-w-0 flex-col gap-1.5 border-t border-line py-3.5" data-testid="community-update" data-kind={u.kind}>
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-muted">
              <span className={`chip bare ${dated ? "border-accent! bg-mint! text-accent!" : ""}`}>{KIND_LABEL[u.kind]}</span>
              <Link href={`/comunidade/${u.communitySlug}`} className="max-w-full truncate font-bold text-foreground underline-offset-4 hover:underline">
                {u.communityName}
              </Link>
              <span>· {fmtUpdateAt(u.at)}</span>
            </p>
            <Link href={updateHref(u)} className="group flex min-w-0 flex-col gap-1">
              {u.title && <span className="text-[17px] leading-snug font-extrabold tracking-[-0.02em] break-words group-hover:underline">{u.title}</span>}
              {dated && (
                <span className="font-mono text-[12.5px] text-muted">
                  {starts ? (u.kind === "agenda" ? fmtQuando.format(starts) : fmtDia.format(starts)) : ""} · {u.location ?? "online"}
                </span>
              )}
              {u.body && (
                <span className={`text-[15px] leading-relaxed break-words whitespace-pre-line text-[#2b2b2b] ${compact ? "line-clamp-2" : "line-clamp-4"}`}>
                  {u.body}
                </span>
              )}
            </Link>
            {u.username && (
              <span className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-muted">
                <Avatar username={u.username} name={u.name} avatarUrl={u.avatarUrl} size="sm" />
                <span className="truncate">@{u.username}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
