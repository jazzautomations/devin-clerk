import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MeetupForm } from "@/components/MeetupForm";
import { canManageCommunity, getCommunityById } from "@/lib/communities";
import { toBrtInput } from "@/lib/eventTime";
import { getMeetup, isMeetupOver, listHosts, meetupIdParam } from "@/lib/meetups";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "editar evento", robots: { index: false } };

// só dono, organizador ou admin global; cancelado e passado não se editam
export default async function EditarEventoPage({ params }: PageProps<"/agenda/[id]/editar">) {
  const { id } = await params;
  const mid = meetupIdParam(id);
  const [member, m] = await Promise.all([currentMember(), mid ? getMeetup(mid) : null]);
  if (!member || !m || (m.communityHidden && member.role !== "admin")) notFound();
  if (!(await canManageCommunity(member, m.communityId))) notFound();
  if (m.cancelledAt || isMeetupOver(m)) notFound();
  const [c, hosts] = await Promise.all([getCommunityById(m.communityId), listHosts(m.id)]);
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/agenda/${m.id}`} className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {m.title}
        </Link>
        <p className="tag self-start">EDITAR EVENTO</p>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">{m.title}</h1>
      </header>
      <MeetupForm
        slug={m.communitySlug}
        city={c?.city ?? null}
        meetupId={m.id}
        initial={{
          kind: m.kind,
          title: m.title,
          description: m.description,
          startsAt: toBrtInput(m.startsAt),
          endsAt: toBrtInput(m.endsAt),
          location: m.location,
          onlineUrl: m.onlineUrl,
          embedUrl: m.embedUrl,
          capacity: m.capacity,
          hosts: hosts.map((h) => h.username),
        }}
      />
    </section>
  );
}
