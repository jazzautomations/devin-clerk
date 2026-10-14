import Link from "next/link";
import { notFound } from "next/navigation";
import { EntriesSettingsForm, EntryRowActions, PrizeCategories } from "@/components/EntriesAdmin";
import { listChallenges } from "@/lib/challenges";
import {
  dbToBrtInput,
  formatBrt,
  getSubmissionSettings,
  listEntriesForAdmin,
  listEntryEvents,
  STATUS_LABEL,
  type EntryStatus,
} from "@/lib/entries";
import { listCategories } from "@/lib/prizes";
import { canManageEdition, hasEditionRole } from "@/lib/roles";
import { currentMember } from "@/lib/session";

// Aba entregas (spec 034): quem entregou e quem não, reabrir com motivo,
// vídeo do palco (staff), prazos/obrigatórios e categorias de prêmio.

const h2 = "font-mono text-[12px] tracking-widest text-muted uppercase";
const STATUS_CLASS: Record<EntryStatus, string> = {
  rascunho: "border-line text-muted",
  enviado: "border-accent text-accent",
  travado: "border-accent bg-mint text-accent",
  nao_entregue: "border-orange text-orange",
};
const EVENT_LABEL: Record<string, string> = {
  enviado: "enviou",
  reaberto: "reaberto",
  palco: "vídeo do palco",
  lembrete_24h: "lembrete T-24h",
  lembrete_3h: "lembrete T-3h",
  lembrete_30m: "lembrete T-30min",
  travado: "aviso de trava",
};

export default async function EntriesPanel({ params }: PageProps<"/admin/h/[id]/entregas">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member) notFound();
  const [manage, staff] = await Promise.all([canManageEdition(member, id), hasEditionRole(member, id, "staff")]);
  if (!staff) notFound();
  const [settings, entries, events, categories, challenges] = await Promise.all([
    getSubmissionSettings(id),
    listEntriesForAdmin(id),
    listEntryEvents(id, 50),
    manage ? listCategories(id) : Promise.resolve([]),
    manage ? listChallenges(id) : Promise.resolve([]),
  ]);
  if (!settings) notFound();
  const submitted = entries.filter((e) => e.status === "enviado" || e.status === "travado").length;

  return (
    <div className="flex flex-col gap-10">
      <dl className="grid grid-cols-2 border-t-[1.5px] border-l-[1.5px] border-line sm:grid-cols-4">
        {[
          ["times", entries.length],
          ["entregaram", submitted],
          ["faltam", entries.length - submitted],
          ["prazo", settings.submissionDeadline ? formatBrt(settings.submissionDeadline) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-1 border-r-[1.5px] border-b-[1.5px] border-line p-4">
            <dt className="font-mono text-[11px] tracking-widest text-muted uppercase">{k}</dt>
            <dd className={typeof v === "number" ? "pix text-3xl" : "font-mono text-[15px]"}>{v}</dd>
          </div>
        ))}
      </dl>
      {!settings.submissionDeadline && (
        <p className="border-[1.5px] border-orange px-4 py-3 font-mono text-[13px] text-orange">
          Sem prazo de entrega: a edição está no modo antigo (sem trava, todo time vai pro júri). Configure o prazo abaixo.
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className={h2}>times</h2>
        {entries.length === 0 ? (
          <p className="text-muted">Nenhum time ainda.</p>
        ) : (
          <ul className="flex flex-col border-t-[1.5px] border-line">
            {entries.map((e) => (
              <li key={e.teamId} className="flex flex-col gap-2 border-b border-line py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold tracking-[-0.02em] break-words">
                      {e.teamName}
                      {e.finalist && <span className="ml-2 font-mono text-[11px] font-normal text-accent uppercase">finalista</span>}
                    </p>
                    <p className="font-mono text-[12px] break-words text-muted">
                      {e.title ? (
                        <Link href={`/p/${e.teamId}`} className="hover:text-accent">
                          {e.title}
                        </Link>
                      ) : (
                        "sem projeto"
                      )}
                      {" · "}
                      {e.members.map((u) => `@${u}`).join(" ")}
                    </p>
                    <p className="font-mono text-[12px] text-muted">
                      {e.versions > 0 ? `v${e.versions} em ${formatBrt(e.lastSubmittedAt)}` : "nenhum envio"}
                      {e.lastSavedAt && ` · salvo ${formatBrt(e.lastSavedAt)}`}
                      {e.dirty && e.versions > 0 && " · mudança não enviada"}
                      {e.reopenedUntil && ` · reaberto até ${formatBrt(e.reopenedUntil)}`}
                    </p>
                  </div>
                  <span className={`border px-1.5 py-0.5 font-mono text-[11px] uppercase ${STATUS_CLASS[e.status]}`}>
                    {STATUS_LABEL[e.status]}
                  </span>
                </div>
                <EntryRowActions
                  hackathonId={id}
                  teamId={e.teamId}
                  manage={manage}
                  finalist={e.finalist}
                  stageVideoUrl={e.stageVideoUrl}
                  hasProject={!!e.title}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {manage && (
        <section className="flex flex-col gap-4">
          <h2 className={h2}>prazos e obrigatórios · horário de Brasília</h2>
          <EntriesSettingsForm
            hackathonId={id}
            initial={{
              teamFormationDeadline: dbToBrtInput(settings.teamFormationDeadline),
              submissionOpensAt: dbToBrtInput(settings.submissionOpensAt),
              submissionDeadline: dbToBrtInput(settings.submissionDeadline),
              submissionGraceMinutes: settings.submissionGraceMinutes,
              juryDeadline: dbToBrtInput(settings.juryDeadline),
              requireRepo: settings.requireRepo,
              requireVideo: settings.requireVideo,
              requireSlides: settings.requireSlides,
              requireAiUsage: settings.requireAiUsage,
              entriesShowContent: settings.entriesShowContent,
            }}
          />
        </section>
      )}

      {manage && (
        <section className="flex flex-col gap-4">
          <h2 className={h2}>categorias de prêmio</h2>
          <p className="max-w-2xl text-[14px] text-muted">
            Geral = ranking do júri entre os entregues. Desafio = só os times que marcaram o desafio. Os vencedores
            são gravados quando o resultado é publicado na aba júri, e o certificado de premiação sai por categoria
            pra quem do time fez check-in.
          </p>
          <PrizeCategories
            hackathonId={id}
            categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, places: c.places, finalistsOnly: c.finalistsOnly }))}
            challenges={challenges.map((c) => ({ id: c.id, label: `${c.sponsor} · ${c.title}` }))}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className={h2}>log</h2>
        {events.length === 0 ? (
          <p className="text-muted">Nada ainda.</p>
        ) : (
          <ul className="flex flex-col border-t border-line font-mono text-[12px]">
            {events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-line py-2">
                <span className="text-muted">{formatBrt(ev.createdAt)}</span>
                <span className="break-words">{ev.teamName}</span>
                <span className="text-accent">{EVENT_LABEL[ev.kind] ?? ev.kind}</span>
                {ev.version && <span>v{ev.version}</span>}
                {ev.username && <span className="text-muted">@{ev.username}</span>}
                {ev.reason && <span className="w-full break-words text-muted">motivo: {ev.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
