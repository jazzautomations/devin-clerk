import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOpenHackathons } from "@/lib/hackathons";
import { getOrCreateMember } from "@/lib/members";
import { listPosts } from "@/lib/posts";
import { getRegistrationIds } from "@/lib/registrations";
import { getMemberBadges, getMemberCards } from "@/lib/xp";
import { FeedSection } from "@/components/FeedSection";
import { XpBar } from "@/components/XpBar";
import { BadgeChip } from "@/components/BadgeChip";
import { Avatar } from "@/components/Avatar";
import { CERT_KIND_LABEL, listMemberCertificates } from "@/lib/certificates";
import { getAttendanceHistory } from "@/lib/rsvp";
import { AttendanceHistory } from "@/components/AttendanceHistory";
import { NextStepPanel } from "@/components/NextStepPanel";
import { EditionRows } from "@/components/EditionRows";
import { dashboardList } from "@/lib/radar";
import { getNextStep, listMyActiveEditions } from "@/lib/nextStepFacts";
import { listMyEditionRoles } from "@/lib/roles";
import { ProfileReminder } from "@/components/ProfileReminder";
import { communityNextStep, listMyCommunities } from "@/lib/communities";
import { listCommunityUpdates } from "@/lib/follows";
import { CommunityUpdates } from "@/components/CommunityUpdates";

// spec 039 — o painel é "meu próximo passo": primeiro o que a pessoa tem
// que fazer em cada edição ativa, depois a equipe, os certificados, o
// progresso e, por último, o que tá aberto e o mural.

const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });
const ROLE_LABEL: Record<string, string> = { organizador: "organização", staff: "staff", mentor: "mentoria", jurado: "júri" };

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

  const [active, roles, open, registeredIds, badges, cards, certificates, attendance, posts, communities, updates] = await Promise.all([
    listMyActiveEditions(member.id, now),
    listMyEditionRoles(member.id),
    getOpenHackathons(now),
    getRegistrationIds(member.id),
    getMemberBadges(member.id),
    getMemberCards(member.id),
    listMemberCertificates(member.id),
    getAttendanceHistory(member.id, now),
    listPosts(20, member.id),
    listMyCommunities(member.id),
    listCommunityUpdates(member.id, { limit: 3 }),
  ]);
  const steps = await Promise.all(active.map(async (h) => ({ h, step: await getNextStep(h, member, now) })));
  // abertos: edições do HackaHub primeiro, depois Brasil com a cidade/UF do perfil na
  // frente; sem repetir o que já está nos próximos passos
  const activeIds = new Set(active.map((h) => h.id));
  const abertos = dashboardList(open, now, { city: member.city, exclude: activeIds, limit: 5 });
  const proxima = open.find((h) => h.hosted && !activeIds.has(h.id)) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-14 px-4 py-10 sm:px-6 sm:py-14">
      {/* cabeçalho */}
      <header className="flex flex-col gap-4 border-b-2 border-line pb-8">
        <p className="tag self-start">MEU PAINEL</p>
        <div className="flex items-center gap-3">
          <Avatar username={member.username} name={name} avatarUrl={member.avatarUrl} size="md" />
          <h1 className="text-[clamp(2.3rem,6vw,3.75rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
            Salve{name ? `, ${name}` : ""}.
          </h1>
        </div>
        <nav aria-label="Atalhos do perfil" className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[13px]">
          <Link href={`/u/${member.username}`} className="text-accent underline-offset-4 hover:underline">
            teu perfil público →
          </Link>
          <Link href="/perfil" className="text-accent underline-offset-4 hover:underline">
            editar perfil →
          </Link>
          {member.role === "admin" && (
            <Link href="/admin" className="text-accent underline-offset-4 hover:underline">
              admin da plataforma →
            </Link>
          )}
        </nav>
        <ProfileReminder member={member} />
      </header>

      {/* teu próximo passo — um card por edição ativa */}
      <section aria-labelledby="passos-title" className="flex flex-col gap-5" data-testid="dashboard-next-steps">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">
            <b>[01]</b> {steps.length === 1 ? "tua edição" : "tuas edições"}
          </p>
          <h2 id="passos-title" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-none font-extrabold tracking-[-0.035em]">
            Seu próximo passo
          </h2>
        </div>
        {steps.length > 0 ? (
          <div className="flex flex-col gap-5">
            {steps.map(({ h, step }) => (
              <NextStepPanel
                key={h.id}
                step={step}
                tone="paper"
                heading={{
                  name: h.name,
                  href: `/h/${h.id}`,
                  meta: `${fmtData.format(new Date(h.startsAt))} · ${h.location ?? "online"}`,
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4 border-[1.5px] border-line p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-[20px] font-extrabold tracking-[-0.02em]">Você ainda não está em nenhuma edição.</p>
              <p className="mt-1 text-[15px] text-muted">
                {proxima
                  ? `${proxima.name} tem inscrição aberta no HackaHub, em ${fmtData.format(new Date(proxima.startsAt))}.`
                  : "Quando abrir uma edição com inscrição no HackaHub, ela aparece aqui."}
              </p>
            </div>
            <Link href={proxima ? `/h/${proxima.id}` : "/radar"} className="btn shrink-0">
              {proxima ? "ver a próxima edição →" : "ver hackathons abertos →"}
            </Link>
          </div>
        )}
      </section>

      {/* suas comunidades — um próximo passo por comunidade */}
      <section aria-labelledby="comunidades-title" className="flex flex-col gap-4" data-testid="dashboard-communities">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <h2 id="comunidades-title" className="text-[clamp(1.5rem,3vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
            Suas comunidades
          </h2>
          <Link href="/comunidades" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
            ver todas →
          </Link>
        </div>
        {communities.length > 0 ? (
          <ul className="border-b border-line">
            {communities.map((c) => {
              const next = communityNextStep(c);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3.5">
                  <div className="min-w-0">
                    <Link href={`/comunidade/${c.slug}`} className="text-[17px] font-extrabold tracking-[-0.02em] hover:underline">
                      {c.name}
                    </Link>
                    {c.role !== "membro" && (
                      <span className="chip bare ml-2">{c.role === "dono" ? "dono" : c.role === "organizador" ? "organiza" : "segue"}</span>
                    )}
                    <p className="mt-0.5 text-[14.5px] text-muted">{next.text}</p>
                  </div>
                  <Link href={next.href} className="btn-ghost min-h-[40px]! text-[14px]!">
                    {next.label} →
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col gap-4 border-[1.5px] border-line p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-[20px] font-extrabold tracking-[-0.02em]">Você ainda não está em nenhuma comunidade.</p>
              <p className="mt-1 text-[15px] text-muted">É pela comunidade que chegam os avisos dos próximos hackathons.</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link href="/comunidades" className="btn">
                achar a minha →
              </Link>
              <Link href="/comunidades/nova" className="btn-ghost">
                criar uma
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* novidades das comunidades que a pessoa segue (membro já segue) */}
      {communities.length > 0 && (
        <section aria-labelledby="novidades-title" className="flex flex-col gap-4" data-testid="dashboard-community-updates">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <h2 id="novidades-title" className="text-[clamp(1.5rem,3vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
              Novidades das suas comunidades
            </h2>
            <Link href="/feed?aba=comunidades" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
              ver no feed →
            </Link>
          </div>
          {updates.length > 0 ? (
            <CommunityUpdates items={updates} compact />
          ) : (
            <p className="border-[1.5px] border-line px-4 py-4 text-[15px] text-muted" data-testid="dashboard-updates-empty">
              Nada novo ainda. Post no mural, aviso e hackathon aberto das suas comunidades aparecem aqui.
            </p>
          )}
        </section>
      )}

      {/* equipe da edição — atalho pro painel de quem organiza/ajuda */}
      {roles.length > 0 && (
        <section aria-labelledby="equipe-title" className="flex flex-col gap-4" data-testid="dashboard-roles">
          <p className="eyebrow">
            <b>[02]</b> na equipe
          </p>
          <h2 id="equipe-title" className="sr-only">
            Edições em que tu é da equipe
          </h2>
          <ul className="border-b border-line">
            {roles.map((r) => (
              <li key={r.hackathonId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3.5">
                <div className="min-w-0">
                  <p className="text-[17px] font-extrabold tracking-[-0.02em]">{r.hackathonName}</p>
                  <p className="mt-0.5 flex flex-wrap gap-1.5">
                    {r.roles.map((role) => (
                      <span key={role} className="chip bare">
                        {ROLE_LABEL[role] ?? role}
                      </span>
                    ))}
                  </p>
                </div>
                <Link href={`/admin/h/${r.hackathonId}`} className="btn-ghost min-h-[40px]! text-[14px]!">
                  abrir painel da edição →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* certificados */}
      {certificates.length > 0 && (
        <section aria-labelledby="cert-title" className="flex flex-col gap-4">
          <p className="eyebrow">
            <b>[{roles.length > 0 ? "03" : "02"}]</b> certificados
          </p>
          <h2 id="cert-title" className="sr-only">
            Teus certificados
          </h2>
          <ul className="border-b border-line">
            {certificates.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3">
                <Link href={`/c/${c.code}`} className="min-w-0 transition hover:text-accent">
                  <span className="font-extrabold tracking-[-0.02em]">{c.hackathonName}</span>{" "}
                  <span className="font-mono text-xs text-muted">· {CERT_KIND_LABEL[c.kind]}</span>
                </Link>
                <a href={`/c/${c.code}/pdf`} className="font-mono text-xs text-accent hover:underline">
                  baixar PDF
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* progresso + presença */}
      <section aria-label="Teu progresso" className={`grid gap-8 ${attendance.entries.length > 0 ? "lg:grid-cols-2" : ""}`}>
        <div className="flex flex-col gap-3 border-[1.5px] border-line p-5">
          <XpBar xp={member.xp} />
          <div className="flex flex-wrap items-center gap-2">
            {badges.map((b) => (
              <BadgeChip key={b.id} badge={b} />
            ))}
            {cards.length > 0 && (
              <Link href={`/u/${member.username}`} className="font-mono text-[12px] text-muted transition hover:text-accent">
                {cards.length} {cards.length === 1 ? "cartinha" : "cartinhas"} na coleção →
              </Link>
            )}
          </div>
        </div>
        <AttendanceHistory entries={attendance.entries} summary={attendance.summary} pending={[]} />
      </section>

      {/* o que tá aberto */}
      {abertos.length > 0 && (
        <section aria-labelledby="abertos-title" className="flex flex-col gap-4">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <h2 id="abertos-title" className="text-[clamp(1.5rem,3vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
              Hackathons abertos
            </h2>
            <Link href="/radar" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
              ver todos →
            </Link>
          </div>
          <EditionRows hackathons={abertos} registeredIds={registeredIds} />
        </section>
      )}

      {/* mural da comunidade */}
      <section aria-labelledby="mural-title" className="flex flex-col gap-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <h2 id="mural-title" className="text-[clamp(1.5rem,3vw,2rem)] leading-none font-extrabold tracking-[-0.035em]">
            Mural da comunidade
          </h2>
          <Link href="/feed" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
            abrir o feed →
          </Link>
        </div>
        <FeedSection initialPosts={posts} me={member.username} isAdmin={member.role === "admin"} />
      </section>
    </div>
  );
}
