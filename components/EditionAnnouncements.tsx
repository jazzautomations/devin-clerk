import Link from "next/link";
import { after } from "next/server";
import { listAnnouncementsForMember, markAnnouncementsRead } from "@/lib/announcements";
import { getRegistrationStatus } from "@/lib/registrations";
import { getEditionRoles } from "@/lib/roles";
import { formatDbTime } from "@/lib/format";
import { channelsEnabled } from "@/lib/notify/channels";

// spec 033 US2 — avisos fixados no topo da página da edição, só pra quem
// está inscrito (approved/pending) ou tem papel nela. Mais recente primeiro;
// não lidos em menta com selo "novo". Ver a página marca como lido (depois
// da resposta, pra o destaque aparecer nesta visita).
export async function EditionAnnouncements({
  hackathonId,
  member,
}: {
  hackathonId: string;
  member: { id: number; role: string };
}) {
  const [status, roles] = await Promise.all([
    getRegistrationStatus(member.id, hackathonId),
    getEditionRoles(hackathonId, member.id),
  ]);
  const staff = member.role === "admin" || roles.length > 0;
  // fila de espera também lê: quem é promovido na véspera não pode perder
  // o "credenciamento abre 8h"
  if (!staff && status !== "approved" && status !== "pending" && status !== "waitlist") return null;

  const items = await listAnnouncementsForMember(hackathonId, member.id, { all: staff });
  const unread = items.filter((a) => !a.read).map((a) => a.id);
  if (unread.length > 0) after(() => markAnnouncementsRead(member.id, unread));

  return (
    <section id="avisos" data-testid="edition-announcements" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-t-2 border-line pt-5">
        <h2 className="flex items-baseline gap-3 text-[clamp(1.6rem,3vw,2.1rem)] leading-none font-extrabold tracking-[-0.035em]">
          Avisos
          {unread.length > 0 && (
            <span className="tag text-[16px] tracking-normal">{unread.length} novo{unread.length > 1 ? "s" : ""}</span>
          )}
        </h2>
        <Link
          href={`/h/${hackathonId}/duvidas`}
          className="inline-flex min-h-11 items-center font-mono text-[13px] text-accent underline-offset-4 hover:underline"
        >
          dúvidas da edição →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="border-[1.5px] border-line px-5 py-5 font-mono text-[13px] text-muted">
          {channelsEnabled().email
            ? "nenhum aviso ainda. Quando a organização publicar, aparece aqui, no sino e no seu e-mail."
            : "nenhum aviso ainda. Quando a organização publicar, aparece aqui e no sino."}
        </p>
      ) : (
        <ol className="flex flex-col border-b border-line">
          {items.map((a) => (
            <li
              key={a.id}
              data-unread={!a.read || undefined}
              className={`flex flex-col gap-2 border-t border-line px-4 py-4 ${
                a.read ? "" : "border-l-4 border-l-accent bg-mint"
              }`}
            >
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-muted">
                {!a.read && <span className="font-bold text-accent uppercase">novo</span>}
                <time>{formatDbTime(a.createdAt)}</time>
              </p>
              <h3 className="text-[19px] leading-tight font-extrabold tracking-[-0.02em] break-words">{a.title}</h3>
              <p className="text-[15px] leading-relaxed break-words whitespace-pre-line">{a.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
