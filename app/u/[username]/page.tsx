import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getMemberByUsername, resolveUsernameRedirect } from "@/lib/members";
import { absoluteUrl } from "@/lib/seo";
import { getRegistrationIds } from "@/lib/registrations";
import { getHackathon } from "@/lib/hackathons";
import { getMemberBadges, getMemberCards } from "@/lib/xp";
import { getMemberArc, getMemberProjects } from "@/lib/archive";
import type { MemberArcEntry } from "@/lib/archive";
import { levelFor } from "@/lib/game";
import { XpBar } from "@/components/XpBar";
import { BadgeChip } from "@/components/BadgeChip";
import { CollectibleCard } from "@/components/CollectibleCard";
import { Avatar } from "@/components/Avatar";
import { ShareBar } from "@/components/ShareBar";
import { profileUrl } from "@/lib/social";
import { personaLabel } from "@/lib/personas";
import { auth } from "@clerk/nextjs/server";
import { PublicCard } from "@/components/PublicCard";

// spec 029 — desfecho de cada edição do arco → chip da trajetória:
// pódio nas cores de raridade, entrega em accent, presença em muted
function arcOutcome(e: MemberArcEntry): { label: string; cls: string } {
  if (e.placement === 1)
    return {
      label: "1º lugar",
      cls: "border-lendario/50 bg-lendario/10 text-lendario",
    };
  if (e.placement === 2)
    return {
      label: "2º lugar",
      cls: "border-epico/50 bg-epico/10 text-epico",
    };
  if (e.placement === 3)
    return {
      label: "3º lugar",
      cls: "border-raro/50 bg-raro/10 text-raro",
    };
  if (e.hasProject)
    return {
      label: "entregou projeto",
      cls: "border-accent bg-mint text-accent",
    };
  return { label: "participou", cls: "border-line text-muted" };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const member = await getMemberByUsername(username);
  if (!member) return { title: "perfil não encontrado" };
  const name = member.name ?? `@${member.username}`;
  const description =
    member.headline ??
    member.bio ??
    `${name} no hackahub — nível, badges, projetos e campanhas de hackathon.`;
  return {
    title: name,
    description,
    alternates: { canonical: `/u/${member.username}` },
    openGraph: {
      title: name,
      description,
      url: absoluteUrl(`/u/${member.username}`),
      type: "profile",
      username: member.username,
    },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const member = await getMemberByUsername(username);
  if (!member) {
    // frente N #8 — username trocado: o link antigo segue valendo (308)
    const moved = await resolveUsernameRedirect(decodeURIComponent(username));
    if (moved) permanentRedirect(`/u/${moved}`);
    notFound();
  }

  // spec 039 — sem conta: cartão mínimo (nome, headline, personas, edições)
  const { userId } = await auth();
  if (!userId) {
    const editions = (await getRegistrationIds(member.id)).length;
    const personas = member.personas.map((p) => personaLabel(p)).filter(Boolean).join(" · ");
    return (
      <PublicCard
        kind="perfil"
        title={member.name ?? `@${member.username}`}
        subtitle={member.headline}
        path={`/u/${member.username}`}
        facts={[
          ["usuário", `@${member.username}`],
          ...(personas ? ([["quem é", personas]] as [string, string][]) : []),
          ["edições", String(editions)],
        ]}
      >
        <Avatar username={member.username} name={member.name} avatarUrl={member.avatarUrl} size="md" />
      </PublicCard>
    );
  }

  const history = (
    await Promise.all((await getRegistrationIds(member.id)).map((id) => getHackathon(id)))
  ).filter(Boolean);
  const badges = await getMemberBadges(member.id);
  const cards = await getMemberCards(member.id);
  const projects = await getMemberProjects(member.username);
  const arc = await getMemberArc(member.username);
  const podiums = arc.filter(
    (e) => e.placement >= 1 && e.placement <= 3,
  ).length;
  const delivered = arc.filter((e) => e.hasProject).length;
  const { level } = levelFor(member.xp);
  const socialLinks: [string, string][] = [];
  for (const [label, href] of [
    ["github", profileUrl("github", member.github)],
    ["linkedin", profileUrl("linkedin", member.linkedin)],
    ["x", profileUrl("twitter", member.twitter)],
    ["site", profileUrl("website", member.website)],
  ] as const) {
    if (href) socialLinks.push([label, href]);
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 [&>*]:max-w-3xl">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"hacker · lv"}
          {level.n} {level.name}
        </p>
        <div className="flex items-center gap-4">
          <Avatar
            username={member.username}
            name={member.name}
            avatarUrl={member.avatarUrl}
            size="lg"
          />
          <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
            {member.name ?? `@${member.username}`}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <p className="font-mono text-sm text-muted">@{member.username}</p>
          <span className="border border-line bg-surface px-1.5 font-mono text-[12px] text-foreground">
            LV{level.n}
          </span>
          {(member.personas.length ? member.personas : member.persona ? [member.persona] : []).map((k) => (
            <span key={k} className="border border-line bg-mint px-1.5 font-mono text-[12px] text-accent">
              {personaLabel(k) ?? k}
            </span>
          ))}
        </div>
        {member.headline && (
          <p className="font-mono text-sm text-foreground">{member.headline}</p>
        )}
        {member.bio && <p className="max-w-xl text-muted">{member.bio}</p>}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {socialLinks.map(([label, href]) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener"
              className="font-mono text-xs text-accent hover:underline"
            >
              {label} →
            </a>
          ))}
        </div>
        <ShareBar
          url={absoluteUrl(`/u/${member.username}`)}
          text={`${member.name ?? `@${member.username}`} no HackaHub — hackathons, projetos e certificados`}
          label="compartilhar perfil"
        />
      </div>

      {member.skills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {member.skills.map((s) => (
            <span
              key={s}
              className="border-[1.5px] border-line px-2 py-0.5 font-mono text-[12px] text-muted"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      <div className="border border-line bg-surface p-4">
        <XpBar xp={member.xp} />
      </div>

      {badges.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            badges ({badges.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <BadgeChip key={b.id} badge={b} />
            ))}
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            coleção — cartinhas de edição ({cards.length})
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {cards.map((c) => (
              <CollectibleCard
                key={c.hackathonId}
                hackathonId={c.hackathonId}
                name={c.name}
                startsAt={c.startsAt}
                location={c.location}
                rarity={c.rarity}
                serial={c.serial}
              />
            ))}
          </div>
        </div>
      )}

      {arc.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            {"trajetória"}
          </h2>
          <p className="font-mono text-xs text-muted">
            {arc.length} {arc.length === 1 ? "edição" : "edições"} · {podiums}{" "}
            {podiums === 1 ? "pódio" : "pódios"} · {delivered}{" "}
            {delivered === 1 ? "projeto entregue" : "projetos entregues"}
          </p>
          <ol
            aria-label="trajetória"
            className="flex flex-wrap items-center gap-x-2 gap-y-2"
          >
            {arc.map((e, i) => {
              const chip = arcOutcome(e);
              return (
                <li key={e.hackathonId} className="flex items-center gap-2">
                  {i > 0 && (
                    <span
                      aria-hidden
                      className="font-mono text-[12px] text-muted"
                    >
                      →
                    </span>
                  )}
                  <Link
                    href={`/h/${e.hackathonId}`}
                    title={e.teamName ?? e.hackathonName}
                    className="flex flex-wrap items-center gap-2 border-[1.5px] border-line bg-surface px-2.5 py-1.5 transition hover:border-line"
                  >
                    <span className="font-mono text-[12px] text-muted">
                      {new Intl.DateTimeFormat("pt-BR", {
                        month: "short",
                        year: "2-digit",
                      }).format(new Date(e.startsAt))}
                    </span>
                    <span className="font-display text-xs font-extrabold tracking-[-0.02em]">
                      {e.hackathonName}
                    </span>
                    <span
                      className={`border px-1.5 font-mono text-[10px] ${chip.cls}`}
                    >
                      {chip.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {projects.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
            projetos ({projects.length})
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {projects.map((p) => (
              <li key={`${p.hackathonId}-${p.teamName}`} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display font-extrabold tracking-[-0.02em]">
                    {p.project ? (
                      <Link
                        href={`/p/${p.teamId}`}
                        className="transition hover:text-accent"
                      >
                        {p.project.title}
                      </Link>
                    ) : (
                      p.teamName
                    )}
                  </p>
                  {p.placement > 0 && (
                    <span className="border border-lendario/50 bg-lendario/10 px-1.5 font-mono text-[12px] text-lendario">
                      {p.placement}º lugar
                    </span>
                  )}
                </div>
                <p className="font-mono text-xs text-muted">
                  {p.teamName} · {p.hackathonName}
                </p>
                {p.project?.repoUrl && (
                  <a
                    href={p.project.repoUrl}
                    target="_blank"
                    rel="noopener"
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    repo →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
          campanhas ({history.length})
        </h2>
        {history.length === 0 ? (
          <p className="border-[1.5px] border-line px-5 py-6 font-mono text-xs text-muted">
            {"ainda não participou de hackathon via hackahub"}
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {history.map((h) => (
              <li
                key={h!.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div>
                  <p className="font-display font-extrabold tracking-[-0.02em]">{h!.name}</p>
                  <p className="font-mono text-xs text-muted">
                    {h!.organizer}
                  </p>
                </div>
                <span className="font-mono text-xs text-muted">
                  {new Intl.DateTimeFormat("pt-BR", {
                    month: "short",
                    year: "numeric",
                  }).format(new Date(h!.startsAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
