import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { appConfig } from "@/app.config";
import { FeatureCard } from "@/components/FeatureCard";
import { HackathonFeed } from "@/components/HackathonFeed";
import {
  getOpenHackathons,
  getPastHackathons,
  getTags,
} from "@/lib/hackathons";
import { getOrCreateMember } from "@/lib/members";
import { listPosts } from "@/lib/posts";
import { getRegistrationIds } from "@/lib/registrations";
import { getMemberBadges, getMemberCards } from "@/lib/xp";
import { FeedSection } from "@/components/FeedSection";
import { XpBar } from "@/components/XpBar";
import { BadgeChip } from "@/components/BadgeChip";
import { Avatar } from "@/components/Avatar";
import { CERT_KIND_LABEL, listMemberCertificates } from "@/lib/certificates";
import { getAttendanceHistory, listPendingRsvpForMember } from "@/lib/rsvp";
import { AttendanceHistory } from "@/components/AttendanceHistory";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const member = await getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email,
    imageUrl: user?.imageUrl ?? null,
  });
  const name = user?.firstName ?? member.name ?? email.split("@")[0];
  const now = new Date();
  const hackathons = await getOpenHackathons(now);
  const sessoes = hackathons.filter((h) => h.partner);
  const radar = hackathons.filter((h) => !h.partner);
  const tags = await getTags(hackathons);
  const registeredIds = await getRegistrationIds(member.id);
  const past = await getPastHackathons(now);
  const badges = await getMemberBadges(member.id);
  const cards = await getMemberCards(member.id);
  const certificates = await listMemberCertificates(member.id);
  const [attendance, pendingRsvp] = await Promise.all([
    getAttendanceHistory(member.id, now),
    listPendingRsvpForMember(member.id, now),
  ]);
  const [nextFeature] = appConfig.upcomingFeatures;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"feed"}
        </p>
        <div className="flex items-center gap-3">
          <Avatar
            username={member.username}
            name={name}
            avatarUrl={member.avatarUrl}
            size="md"
          />
          <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
            Salve{name ? `, ${name}` : ""}.
          </h1>
        </div>
        <p className="max-w-xl text-lg text-muted">
          Hackathons abertos — os da comunidade com inscrição pelo HackaHub, e o
          resto do mundo curado embaixo.{" "}
          <Link href={`/u/${member.username}`} className="text-accent hover:underline">
            teu perfil público →
          </Link>
          {member.role === "admin" && (
            <Link href="/admin" className="text-accent hover:underline">
              {" "}
              · painel do organizador →
            </Link>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3 border border-line bg-surface p-5">
        <XpBar xp={member.xp} />
        <div className="flex flex-wrap items-center gap-2">
          {badges.map((b) => (
            <BadgeChip key={b.id} badge={b} />
          ))}
          {cards.length > 0 && (
            <Link
              href={`/u/${member.username}`}
              className="font-mono text-[12px] text-muted transition hover:text-accent"
            >
              {cards.length} {cards.length === 1 ? "cartinha" : "cartinhas"} na
              coleção →
            </Link>
          )}
        </div>
      </div>

      <AttendanceHistory entries={attendance.entries} summary={attendance.summary} pending={pendingRsvp} />

      {certificates.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            teus certificados
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {certificates.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <Link href={`/c/${c.code}`} className="min-w-0 transition hover:text-accent">
                  <span className="font-display font-extrabold tracking-[-0.02em]">{c.hackathonName}</span>{" "}
                  <span className="font-mono text-xs text-muted">· {CERT_KIND_LABEL[c.kind]}</span>
                </Link>
                <a href={`/c/${c.code}/pdf`} className="font-mono text-xs text-accent hover:underline">
                  baixar PDF
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
          comunidade — o que a galera tá construindo
        </h2>
        <FeedSection
          initialPosts={await listPosts(50, member.id)}
          me={member.username}
          isAdmin={member.role === "admin"}
        />
      </div>

      {sessoes.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-mono text-xs tracking-[0.06em] text-accent uppercase">
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
        <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
          radar — brasil + mundo
        </h2>
        <HackathonFeed
          hackathons={radar}
          tags={tags}
          now={now.toISOString()}
          registeredIds={registeredIds}
        />
      </div>

      {past.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            arquivo — edições passadas
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {past.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/h/${h.id}`}
                  className="flex items-center justify-between gap-4 py-3 transition hover:text-accent"
                >
                  <div>
                    <p className="font-display font-extrabold tracking-[-0.02em]">{h.name}</p>
                    <p className="font-mono text-xs text-muted">
                      {h.organizer} · {h.location ?? "online"}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted">
                    {new Intl.DateTimeFormat("pt-BR", {
                      month: "short",
                      year: "numeric",
                    }).format(new Date(h.startsAt))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
          vindo por aí
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {appConfig.upcomingFeatures.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>

      {nextFeature && (
        <div className="border-[1.5px] border-line bg-mint px-5 py-4 font-mono text-xs text-muted">
          <span className="text-accent">$ keep_building:</span> open Devin and
          ask it to &ldquo;Build &lsquo;{nextFeature.title}&rsquo; from the
          Coming soon page.&rdquo;
        </div>
      )}
    </section>
  );
}
