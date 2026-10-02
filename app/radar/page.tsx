import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { HackathonFeed } from "@/components/HackathonFeed";
import {
  getTags,
  getUpcomingHackathons,
} from "@/lib/hackathons";
import { getOrCreateMember } from "@/lib/members";
import { getRegistrationIds } from "@/lib/registrations";

export const metadata: Metadata = {
  title: "radar",
  description:
    "Hackathons abertos no Brasil e no mundo — sessões Hack Inova com inscrição em 1 clique e o radar curado das fontes oficiais.",
  alternates: { canonical: "/radar" },
};

export default async function RadarPage() {
  const { userId } = await auth();
  let registeredIds: string[] = [];
  if (userId) {
    const user = await currentUser();
    const member = getOrCreateMember({
      id: userId,
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? "",
    });
    registeredIds = getRegistrationIds(member.id);
  }

  const now = new Date();
  const hackathons = getUpcomingHackathons(now);
  const sessoes = hackathons.filter((h) => h.partner);
  const radar = hackathons.filter((h) => !h.partner);
  const tags = getTags(hackathons);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// radar"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Hackathons abertos
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Os da comunidade com inscrição em 1 clique, e o resto do cenário
          curado do Brasil e do mundo — raspado das fontes oficiais.
        </p>
      </div>

      {sessoes.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-mono text-xs tracking-widest text-accent uppercase">
            sessões hack inova — inscrição direta
          </h2>
          <HackathonFeed
            hackathons={sessoes}
            tags={[]}
            now={now.toISOString()}
            registeredIds={registeredIds}
          />
        </div>
      )}

      <div className="flex flex-col gap-4">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          radar — brasil + mundo
        </h2>
        <HackathonFeed
          hackathons={radar}
          tags={tags}
          now={now.toISOString()}
          registeredIds={registeredIds}
        />
      </div>
    </section>
  );
}
