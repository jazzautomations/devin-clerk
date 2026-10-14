import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { googleCalendarUrl } from "@/lib/ics";
import { absoluteUrl } from "@/lib/seo";
import {
  AUDIENCE_LABEL,
  KIND_LABEL,
  calendarTokenFor,
  groupByDay,
  hasScheduleAccess,
  listVisibleScheduleItems,
  personalFeedPath,
  scheduleViewerFor,
  timeLabel,
  toIcsEvent,
} from "@/lib/schedule";
import { ScheduleNowNext } from "@/components/ScheduleNowNext";
import { CalendarFeedLink } from "@/components/CalendarFeedLink";

export async function generateMetadata({ params }: PageProps<"/h/[id]/programacao">): Promise<Metadata> {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) return { title: "edição não encontrada" };
  return {
    title: `Programação · ${h.name}`,
    description: `Horários, salas e atividades de ${h.name}.`,
    alternates: { canonical: `/h/${h.id}/programacao` },
  };
}

// Programação pública da edição (roadmap 037 #4). Itens "todos" pra
// qualquer um; os de participantes/mentores/jurados/staff só pra quem tem
// a inscrição aprovada ou o papel. Agrupada por dia, hora de Brasília.
export default async function ProgramacaoPage({ params }: PageProps<"/h/[id]/programacao">) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) notFound();
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  const viewer = await scheduleViewerFor(member, id);
  const items = await listVisibleScheduleItems(id, viewer);
  const days = groupByDay(items);
  const feedUrl =
    member && hasScheduleAccess(viewer, viewer.status)
      ? absoluteUrl(personalFeedPath(await calendarTokenFor(member.id, id)))
      : null;
  const rows = days.map((d) => ({
    ...d,
    items: d.items.map((i) => {
      const ev = toIcsEvent(i, h);
      return { ...i, google: googleCalendarUrl(ev), ics: `/h/${id}/programacao/${i.id}.ics` };
    }),
  }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <Link href={`/h/${id}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {h.name}
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-none font-extrabold tracking-[-0.04em]">Programação</h1>
        <p className="text-[15px] text-muted">
          Horários de Brasília. Mudou algo? Quem é afetado recebe aviso — e o calendário assinado atualiza sozinho.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={`/h/${id}/programacao.ics`} className="btn-ghost rounded-[6px]" download>
            baixar .ics da edição
          </a>
          <a
            href={absoluteUrl(`/h/${id}/programacao.ics`).replace(/^https?:/, "webcal:")}
            className="btn-ghost rounded-[6px]"
          >
            assinar (itens abertos)
          </a>
        </div>
      </header>

      <ScheduleNowNext hackathonId={id} member={member} items={items} />

      {feedUrl && <CalendarFeedLink hackathonId={id} initialUrl={feedUrl} />}

      {rows.length === 0 ? (
        <p data-testid="schedule-empty" className="border-[1.5px] border-line px-5 py-5 font-mono text-[13px] text-muted">
          a programação ainda não foi publicada — volta mais perto do evento
        </p>
      ) : (
        <div className="flex flex-col gap-10">
          {rows.map((d) => (
            <section key={d.date} data-testid="schedule-day" className="flex flex-col gap-3">
              <h2 className="border-t-2 border-line pt-4 text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em] first-letter:uppercase">
                {d.label}
              </h2>
              <ol className="flex flex-col">
                {d.items.map((i) => (
                  <li
                    key={i.id}
                    id={`item-${i.id}`}
                    data-testid="schedule-item"
                    className="grid scroll-mt-24 grid-cols-[4.2rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line py-4 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
                  >
                    <p className="font-mono text-[14px] leading-tight">
                      <span className="block font-bold">{timeLabel(i.startsAt)}</span>
                      <span className="block text-muted">{timeLabel(i.endsAt)}</span>
                    </p>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <h3 className="text-[18px] leading-tight font-extrabold tracking-[-0.02em] break-words">{i.title}</h3>
                      <p className="flex flex-wrap gap-1.5">
                        <span className="chip bare">{KIND_LABEL[i.kind]}</span>
                        {i.room && <span className="chip bare">sala {i.room}</span>}
                        {i.audience !== "todos" && (
                          <span className="chip bare border-accent! text-accent">só {AUDIENCE_LABEL[i.audience]}</span>
                        )}
                      </p>
                      {i.description && (
                        <p className="text-[14px] break-words whitespace-pre-line text-muted">{i.description}</p>
                      )}
                      <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
                        <a href={i.google} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
                          Google Agenda ↗
                        </a>
                        <a href={i.ics} className="text-accent underline-offset-4 hover:underline" download>
                          baixar .ics
                        </a>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
