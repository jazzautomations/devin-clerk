import { notFound } from "next/navigation";
import { getMemberByUsername } from "@/lib/members";
import { getRegistrationIds } from "@/lib/registrations";
import { getHackathon } from "@/lib/hackathons";
import { getMemberBadges, getMemberCards } from "@/lib/xp";
import { levelFor } from "@/lib/game";
import { XpBar } from "@/components/XpBar";
import { BadgeChip } from "@/components/BadgeChip";
import { CollectibleCard } from "@/components/CollectibleCard";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const member = getMemberByUsername(username);
  if (!member) notFound();

  const history = getRegistrationIds(member.id)
    .map((id) => getHackathon(id))
    .filter(Boolean);
  const badges = getMemberBadges(member.id);
  const cards = getMemberCards(member.id);
  const { level } = levelFor(member.xp);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// hacker · lv"}
          {level.n} {level.name}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {member.name ?? `@${member.username}`}
        </h1>
        <div className="flex items-center gap-2">
          <p className="font-mono text-sm text-muted">@{member.username}</p>
          <span className="border border-line bg-surface px-1.5 font-mono text-[10px] text-foreground">
            LV{level.n}
          </span>
          {member.persona && (
            <span className="border border-accent/30 bg-accent/10 px-1.5 font-mono text-[10px] text-accent">
              {member.persona}
            </span>
          )}
        </div>
        {member.headline && (
          <p className="font-mono text-sm text-foreground">{member.headline}</p>
        )}
        {member.bio && <p className="max-w-xl text-muted">{member.bio}</p>}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {member.github && (
            <a
              href={`https://github.com/${member.github.replace(/^@/, "")}`}
              target="_blank"
              rel="noopener"
              className="font-mono text-xs text-accent hover:underline"
            >
              github/{member.github.replace(/^@/, "")} →
            </a>
          )}
          {member.linkedin && (
            <a
              href={
                member.linkedin.startsWith("http")
                  ? member.linkedin
                  : `https://linkedin.com/${member.linkedin.replace(/^@/, "")}`
              }
              target="_blank"
              rel="noopener"
              className="font-mono text-xs text-accent hover:underline"
            >
              linkedin →
            </a>
          )}
          {member.twitter && (
            <a
              href={`https://x.com/${member.twitter.replace(/^@/, "")}`}
              target="_blank"
              rel="noopener"
              className="font-mono text-xs text-accent hover:underline"
            >
              x/{member.twitter.replace(/^@/, "")} →
            </a>
          )}
          {member.website && (
            <a
              href={
                member.website.startsWith("http")
                  ? member.website
                  : `https://${member.website}`
              }
              target="_blank"
              rel="noopener"
              className="font-mono text-xs text-accent hover:underline"
            >
              site →
            </a>
          )}
        </div>
      </div>

      {member.skills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {member.skills.map((s) => (
            <span
              key={s}
              className="border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
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
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
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
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
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

      <div className="flex flex-col gap-4">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          campanhas ({history.length})
        </h2>
        {history.length === 0 ? (
          <p className="border border-dashed border-line px-5 py-6 font-mono text-xs text-muted">
            {"// ainda não participou de hackathon via hackahub"}
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {history.map((h) => (
              <li
                key={h!.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div>
                  <p className="font-display font-semibold">{h!.name}</p>
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
