import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MeetupRows } from "@/components/MeetupRows";
import { canManageCommunity, getCommunityBySlug } from "@/lib/communities";
import { listCommunityMeetups } from "@/lib/meetups";
import { currentMember } from "@/lib/session";

// /comunidade/[slug]/agenda: o que vem por aí e o que já rolou. Quem
// organiza vê também os rascunhos e o botão de marcar.

export async function generateMetadata({ params }: PageProps<"/comunidade/[slug]/agenda">): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCommunityBySlug(slug);
  if (!c || c.hidden) return { title: "agenda" };
  return { title: `agenda · ${c.name}`, alternates: { canonical: `/comunidade/${c.slug}/agenda` } };
}

export default async function AgendaPage({ params }: PageProps<"/comunidade/[slug]/agenda">) {
  const { slug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  const canManage = await canManageCommunity(member, c.id);
  const now = new Date();
  const { upcoming, past, drafts } = await listCommunityMeetups(c.id, { includeDrafts: canManage, now });

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14" data-testid="agenda-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}`} className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {c.name}
        </Link>
        <p className="tag self-start">AGENDA</p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">
            O que rola na {c.name}
          </h1>
          {canManage && (
            <Link href={`/comunidade/${c.slug}/agenda/novo`} className="btn shrink-0" data-testid="agenda-new">
              marcar evento →
            </Link>
          )}
        </div>
        <p className="max-w-[56ch] text-[15.5px] text-muted">Meetup, live, workshop e demo day entre um hackathon e outro.</p>
      </header>

      {canManage && drafts.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="agenda-drafts">
          <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">rascunhos</h2>
          <ul className="flex flex-col gap-2">
            {drafts.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-[1.5px] border-dashed border-line px-4 py-3">
                <span className="min-w-0 break-words">
                  <span className="chip bare mr-2">rascunho</span>
                  <span className="font-bold">{m.title}</span>
                </span>
                <Link href={`/agenda/${m.id}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
                  revisar e publicar →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="prox-title" className="flex flex-col gap-3">
        <h2 id="prox-title" className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.035em]">
          Próximos
        </h2>
        {upcoming.length > 0 ? (
          <MeetupRows items={upcoming} now={now} testId="agenda-upcoming" />
        ) : (
          <p className="border-[1.5px] border-line px-4 py-4 text-[15px] text-muted" data-testid="agenda-empty">
            Nada marcado ainda.
            {canManage ? " Marque o primeiro: quem segue a comunidade recebe o aviso." : " Quem segue a comunidade recebe o aviso quando sair."}
          </p>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-title" className="flex flex-col gap-3">
          <h2 id="past-title" className="font-mono text-[13px] tracking-[0.08em] uppercase">
            já rolaram
          </h2>
          <MeetupRows items={past} now={now} past testId="agenda-past" />
        </section>
      )}
    </section>
  );
}
