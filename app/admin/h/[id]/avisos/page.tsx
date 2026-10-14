import { notFound } from "next/navigation";
import db from "@/lib/db";
import { currentMember } from "@/lib/session";
import { canManageEdition } from "@/lib/roles";
import {
  AUDIENCE_LABEL,
  CHANNELS,
  listAnnouncementsForAdmin,
  listEditionTeams,
  MAX_ATTEMPTS,
  type Channel,
} from "@/lib/announcements";
import { formatDbTime } from "@/lib/format";
import { AnnouncementComposer } from "@/components/AnnouncementComposer";

const CHANNEL_LABEL: Record<Channel, string> = { inapp: "in-app", email: "e-mail", whatsapp: "whatsapp" };

// spec 033 US2 — aba de avisos do painel da edição (organizador/admin)
export default async function AvisosPage({ params }: PageProps<"/admin/h/[id]/avisos">) {
  const { id } = await params;
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();

  const [announcements, teams, counts] = await Promise.all([
    listAnnouncementsForAdmin(id),
    listEditionTeams(id),
    db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE status IN ('approved','pending')) AS todos,
                COUNT(*) FILTER (WHERE status = 'approved') AS aprovados
         FROM registrations WHERE hackathonId = ?`,
      )
      .get<{ todos: number; aprovados: number }>(id),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">Novo aviso</h2>
          <p className="text-[14px] text-muted">
            Vai fixado na página da edição, no sino, por e-mail e por WhatsApp individual pra quem optou. Sem grupo.
          </p>
        </div>
        <AnnouncementComposer
          hackathonId={id}
          teams={teams}
          counts={{ todos: counts?.todos ?? 0, aprovados: counts?.aprovados ?? 0 }}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="border-t-2 border-line pt-5 text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">
          Publicados
        </h2>
        {announcements.length === 0 ? (
          <p className="border-[1.5px] border-line px-5 py-5 font-mono text-[13px] text-muted">nenhum aviso publicado ainda</p>
        ) : (
          <ol className="flex flex-col gap-6">
            {announcements.map((a) => (
              <li key={a.id} data-testid="admin-announcement" className="flex min-w-0 flex-col gap-3 border-[1.5px] border-line p-4">
                <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px] text-muted">
                  <time>{formatDbTime(a.createdAt)}</time>
                  <span>
                    pra {a.audience === "time" ? `o time ${a.teamName ?? "?"}` : AUDIENCE_LABEL[a.audience]}
                  </span>
                  {a.authorUsername && <span>por @{a.authorUsername}</span>}
                </p>
                <h3 className="text-[19px] leading-tight font-extrabold tracking-[-0.02em] break-words">{a.title}</h3>
                <p className="line-clamp-3 text-[14px] break-words whitespace-pre-line text-muted">{a.body}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[300px] border-collapse font-mono text-[12px]">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="border-b border-line py-1 pr-3 font-normal">canal</th>
                        <th className="border-b border-line py-1 pr-3 font-normal">entregue</th>
                        <th className="border-b border-line py-1 pr-3 font-normal">falhou</th>
                        <th className="border-b border-line py-1 pr-3 font-normal">pulado</th>
                        <th className="border-b border-line py-1 font-normal">na fila</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CHANNELS.map((ch) => (
                        <tr key={ch}>
                          <td className="border-b border-line-soft py-1 pr-3">{CHANNEL_LABEL[ch]}</td>
                          <td className="border-b border-line-soft py-1 pr-3 text-accent">{a.stats[ch].sent}</td>
                          <td className={`border-b border-line-soft py-1 pr-3 ${a.stats[ch].failed ? "font-bold text-orange" : ""}`}>
                            {a.stats[ch].failed}
                          </td>
                          <td className="border-b border-line-soft py-1 pr-3">{a.stats[ch].skipped}</td>
                          <td className="border-b border-line-soft py-1">{a.stats[ch].queued}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {a.failures.length > 0 && (
                  <details className="font-mono text-[12px]">
                    <summary className="cursor-pointer text-orange">{a.failures.length} falha(s) — ver quem</summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {a.failures.map((f, i) => (
                        <li key={i} className="break-words">
                          @{f.username} · {CHANNEL_LABEL[f.channel]} · {f.attempts}/{MAX_ATTEMPTS}
                          {f.retrying ? " · vai tentar de novo" : ""} — <span className="text-muted">{f.error}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
