import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getHackathon, isOver } from "@/lib/hackathons";
import { absoluteUrl, eventJsonLd, jsonLd } from "@/lib/seo";
import { getMemberByClerkId } from "@/lib/members";
import {
  getRegistrationsByHackathon,
  getRegistrationStatus,
} from "@/lib/registrations";
import { RegisterButton } from "@/components/RegisterButton";
import { CollectibleCard } from "@/components/CollectibleCard";
import { getCardRarity, getCardSupply, getMemberCard } from "@/lib/xp";
import { getArchive } from "@/lib/archive";
import { getChallenges } from "@/lib/challenges";
import { DeployPanel } from "@/components/DeployPanel";
import { getLatestDeployForTeam } from "@/lib/deploys";
import { listBoardEntries } from "@/lib/teamboard";
import { TeamBoardPanel } from "@/components/TeamBoardPanel";
import { memberTeamFor } from "@/lib/teams";
import { MyTeamPanel } from "@/components/MyTeamPanel";
import { countdownTarget, editionPhase } from "@/lib/arena";
import type { EditionPhase } from "@/lib/arena";
import { ArenaCountdown } from "@/components/ArenaCountdown";
import { Avatar } from "@/components/Avatar";
import { FeedSection } from "@/components/FeedSection";
import { listPosts } from "@/lib/posts";

const FORMAT_LABEL: Record<string, string> = {
  online: "online",
  presencial: "presencial",
  hibrido: "híbrido",
};

// spec 016 + 030 — arena ao vivo: rótulo/estilo da fase (open/closed-soon/
// live/ongoing renderizam faixa; ended/archived ficam no modo arquivo)
const PHASE_LABEL: Record<EditionPhase, string> = {
  open: "inscrições abertas",
  "closed-soon": "inscrições encerradas",
  live: "começando",
  ongoing: "em andamento",
  ended: "edição encerrada",
  archived: "arquivada",
};
const PHASE_CLASS: Record<EditionPhase, string> = {
  open: "text-muted",
  "closed-soon": "text-lendario",
  live: "text-accent animate-pulse",
  ongoing: "text-accent animate-pulse",
  ended: "text-muted",
  archived: "text-muted",
};

// spec 019 — chip de tier do sponsor vinculado: master é o pacote lendário
const TIER_CLASS: Record<string, string> = {
  master: "border-lendario/40 bg-lendario/5 text-lendario",
  sponsor: "border-accent/40 bg-accent/5 text-accent",
  apoio: "border-line text-muted",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) return { title: "edição não encontrada" };
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(h.startsAt));
  const description = `${date} · ${h.location ?? "online"} · ${h.organizer}`;
  return {
    title: h.name,
    description,
    alternates: { canonical: `/h/${h.id}` },
    openGraph: {
      title: h.name,
      description,
      url: absoluteUrl(`/h/${h.id}`),
      type: "website",
    },
  };
}

export default async function HackathonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) notFound();

  const now = new Date();
  // spec 030 — "encerrada" é a mesma fronteira do radar (027):
  // COALESCE(endsAt, registrationDeadline, startsAt) < now. startsAt
  // passado sozinho NÃO arquiva — evento ongoing segue em modo live
  const past = isOver(h, now);
  const closed =
    h.registrationDeadline !== null &&
    new Date(h.registrationDeadline) < now;

  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  // spec 032 — "inscrito" = approved; pending/rejected têm estado próprio
  // no CTA e não abrem os gates (time/board/mural) da página
  const myStatus = member ? getRegistrationStatus(member.id, h.id) : null;
  const registered = myStatus === "approved";
  // spec 021 — time do próprio membro na edição (null = ainda não submeteu)
  const myTeam =
    member && registered ? memberTeamFor(h.id, member.username) : null;
  const attendees = getRegistrationsByHackathon(h.id);
  const cardRarity = getCardRarity(h.id);
  const cardSupply = getCardSupply(h.id);
  const myCard = member ? getMemberCard(member.id, h.id) : null;
  const archive = getArchive(h.id);
  const hasArchive = archive.teams.length > 0 || archive.assets.length > 0;
  const challenges = getChallenges(h.id);
  const boardEntries = listBoardEntries(h.id);
  const phase = editionPhase(h, now);
  const countdownTo = countdownTarget(h, now);
  const podium = archive.teams.filter((t) => t.placement >= 1 && t.placement <= 3);
  const field = archive.teams.filter((t) => t.placement === 0);

  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(eventJsonLd(h)) }}
      />
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {past ? "// arquivo" : "// hackathon"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {h.name}
        </h1>
        <p className="font-mono text-sm text-muted">{h.organizer}</p>
      </div>

      {!past && countdownTo && (
        <div
          data-testid="arena-strip"
          className="flex flex-col gap-5 border border-line bg-surface p-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <p
              data-testid="arena-phase"
              className={`font-mono text-xs tracking-widest uppercase ${PHASE_CLASS[phase]}`}
            >
              {"// "}
              {PHASE_LABEL[phase]}
            </p>
            <p
              data-testid="arena-attendees"
              className="font-mono text-xs text-muted"
            >
              {attendees.length}{" "}
              {attendees.length === 1 ? "inscrito" : "inscritos"}
              {boardEntries.length > 0 &&
                ` · ${boardEntries.length} procurando time`}
            </p>
          </div>
          <ArenaCountdown
            targetIso={countdownTo.iso}
            nowIso={now.toISOString()}
            label={
              countdownTo.kind === "deadline"
                ? "inscrições fecham em"
                : countdownTo.kind === "end"
                  ? "termina em"
                  : "começa em"
            }
            live={phase === "live" || phase === "ongoing"}
          />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-y border-line py-6 font-mono text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">data</dt>
          <dd className="mt-1">{fmt.format(new Date(h.startsAt))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">formato</dt>
          <dd className="mt-1">{FORMAT_LABEL[h.format]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">local</dt>
          <dd className="mt-1">{h.location ?? "Online"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">inscrições</dt>
          <dd className={`mt-1 ${closed && !past ? "text-muted" : "text-accent"}`}>
            {past
              ? "edição encerrada"
              : closed
                ? "encerradas"
                : h.registrationDeadline
                  ? `até ${fmt.format(new Date(h.registrationDeadline))}`
                  : "abertas"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {h.tags.map((t) => (
          <span
            key={t}
            className="border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
          >
            #{t}
          </span>
        ))}
      </div>

      {!past && !closed && h.partner && (
        <div className="flex flex-col gap-3 border border-line bg-surface p-6">
          <RegisterButton
            hackathonId={h.id}
            requiresApproval={h.requiresApproval}
            status={myStatus}
          />
          {!member && (
            <p className="font-mono text-xs text-muted">
              {"// vai pedir login — é o cadastro único do hackahub, não um Google Form"}
            </p>
          )}
        </div>
      )}

      {!past && !h.partner && (
        <a
          href={h.registrationUrl}
          target="_blank"
          rel="noopener"
          className="w-fit border border-line px-6 py-3 font-mono text-sm transition hover:border-accent/50 hover:text-accent"
        >
          inscrever no site oficial →
        </a>
      )}

      {/* spec 021 — inscrito submete/edita o próprio time; edição encerrada
          vira arquivo e o painel some (o time já tá em "resultado") */}
      {!past && registered && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
            {"// meu time"}
          </h2>
          <MyTeamPanel hackathonId={h.id} initialTeam={myTeam} />
        </div>
      )}

      {challenges.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
            {"// desafios patrocinados"}
          </h2>
          <ul className="grid gap-3">
            {challenges.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 border border-line bg-surface p-5"
              >
                <p className="font-mono text-xs tracking-widest text-accent uppercase">
                  {c.sponsorUrl ? (
                    <a
                      href={c.sponsorUrl}
                      target="_blank"
                      rel="noopener"
                      className="hover:underline"
                    >
                      {c.sponsor}
                    </a>
                  ) : (
                    c.sponsor
                  )}
                  {c.sponsorTier && (
                    <span
                      className={`ml-2 inline-block border px-1.5 py-0.5 text-[10px] ${TIER_CLASS[c.sponsorTier] ?? "border-line text-muted"}`}
                    >
                      {c.sponsorTier}
                    </span>
                  )}
                </p>
                <h3 className="font-display text-xl font-bold tracking-tight">
                  {c.title}
                </h3>
                {c.prize && (
                  <p className="w-fit border border-lendario/40 bg-lendario/5 px-2 py-1 font-mono text-xs text-lendario">
                    prêmio: {c.prize}
                  </p>
                )}
                {c.description && (
                  <p className="text-sm text-muted">{c.description}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          cartinha colecionável desta edição
        </h2>
        <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
          <CollectibleCard
            hackathonId={h.id}
            name={h.name}
            startsAt={h.startsAt}
            location={h.location}
            rarity={cardRarity}
            serial={myCard?.serial}
            supply={myCard === null ? cardSupply : undefined}
          />
          <div className="flex flex-col justify-center gap-2 border border-line bg-surface p-5 font-mono text-xs text-muted">
            <p>
              {myCard
                ? `// tu tens a № ${String(myCard.serial).padStart(3, "0")} — prova de presença na tua coleção`
                : past
                  ? "// edição encerrada — a tiragem desta carta fechou"
                  : "// inscreve-te pra mintar a tua — serial na ordem de chegada"}
            </p>
            <p className="text-foreground">
              {cardSupply} {cardSupply === 1 ? "mintada" : "mintadas"} até agora
            </p>
          </div>
        </div>
      </div>

      {(past || hasArchive) && (
        <div className="flex flex-col gap-5">
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
            resultado
          </h2>
          {podium.length > 0 ? (
            <ol className="grid gap-3 sm:grid-cols-3">
              {podium.map((t) => (
                <li
                  key={t.id}
                  className={`flex flex-col gap-2 border p-4 ${
                    t.placement === 1
                      ? "border-lendario/60 bg-lendario/5"
                      : "border-line bg-surface"
                  }`}
                >
                  <span
                    className={`font-mono text-2xl font-bold ${
                      t.placement === 1 ? "text-lendario" : "text-muted"
                    }`}
                  >
                    {t.placement}º
                  </span>
                  <p className="font-display font-bold tracking-tight">
                    {t.name}
                  </p>
                  {t.project && (
                    <div className="flex flex-col gap-1">
                      <Link
                        href={`/p/${t.id}`}
                        className="font-mono text-xs text-foreground transition hover:text-accent"
                      >
                        {t.project.title}
                      </Link>
                      {t.project.description && (
                        <p className="text-xs text-muted">
                          {t.project.description}
                        </p>
                      )}
                      <span className="flex gap-3 font-mono text-[10px] text-accent">
                        {t.project.repoUrl && (
                          <a
                            href={t.project.repoUrl}
                            target="_blank"
                            rel="noopener"
                            className="hover:underline"
                          >
                            repo →
                          </a>
                        )}
                        {t.project.demoUrl && (
                          <a
                            href={t.project.demoUrl}
                            target="_blank"
                            rel="noopener"
                            className="hover:underline"
                          >
                            demo →
                          </a>
                        )}
                      </span>
                      <DeployPanel
                        teamId={t.id}
                        hasRepo={!!t.project.repoUrl}
                        initialDeploy={getLatestDeployForTeam(t.id)}
                        canDeploy={
                          !!member &&
                          (member.role === "admin" ||
                            t.members.includes(member.username))
                        }
                      />
                    </div>
                  )}
                  {t.members.length > 0 && (
                    <p className="mt-auto font-mono text-[10px] text-muted">
                      {t.members.map((u) => `@${u}`).join(" ")}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : hasArchive ? (
            <p className="border border-dashed border-line px-5 py-6 font-mono text-xs text-muted">
              {"// pódio em organização"}
            </p>
          ) : (
            <p className="border border-dashed border-line px-5 py-6 font-mono text-xs text-muted">
              {"// arquivo em organização — resultado entra aqui depois do evento"}
            </p>
          )}

          {field.length > 0 && (
            <ul className="divide-y divide-line border-y border-line">
              {field.map((t) => (
                <li
                  key={t.id}
                  className="flex items-baseline justify-between gap-4 py-3"
                >
                  <div>
                    <p className="font-display font-semibold">{t.name}</p>
                    {t.project && (
                      <p className="font-mono text-xs text-muted">
                        <Link
                          href={`/p/${t.id}`}
                          className="text-foreground transition hover:text-accent"
                        >
                          {t.project.title}
                        </Link>
                        {t.project.repoUrl && (
                          <>
                            {" "}
                            —{" "}
                            <a
                              href={t.project.repoUrl}
                              target="_blank"
                              rel="noopener"
                              className="text-accent hover:underline"
                            >
                              repo →
                            </a>
                          </>
                        )}
                      </p>
                    )}
                    {t.project && (
                      <DeployPanel
                        teamId={t.id}
                        hasRepo={!!t.project.repoUrl}
                        initialDeploy={getLatestDeployForTeam(t.id)}
                        canDeploy={
                          !!member &&
                          (member.role === "admin" ||
                            t.members.includes(member.username))
                        }
                      />
                    )}
                  </div>
                  {t.members.length > 0 && (
                    <span className="font-mono text-[10px] text-muted">
                      {t.members.map((u) => `@${u}`).join(" ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {archive.assets.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-mono text-[10px] tracking-widest text-muted uppercase">
                materiais & fotos
              </h3>
              <ul className="divide-y divide-line border-y border-line">
                {archive.assets.map((a) => (
                  <li key={a.id} className="flex items-baseline gap-3 py-2">
                    <span className="w-16 shrink-0 font-mono text-[10px] text-muted uppercase">
                      {a.type}
                    </span>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener"
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {a.caption ?? a.url.replace(/^https?:\/\//, "").slice(0, 50)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(!past || boardEntries.length > 0) && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
            {"// quem tá procurando time"} ({boardEntries.length})
          </h2>
          <TeamBoardPanel
            hackathonId={h.id}
            canPost={!past && registered}
            myUsername={member?.username ?? null}
            initialEntries={boardEntries}
          />
        </div>
      )}

      {attendees.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
            inscritos ({attendees.length})
            {boardEntries.length > 0 &&
              ` · ${boardEntries.length} procurando time`}
          </h2>
          <ul className="divide-y divide-line border-y border-line font-mono text-xs">
            {attendees.map((a) => (
              <li
                key={a.username}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="flex items-center gap-2">
                  <Avatar
                    username={a.username}
                    name={a.name}
                    avatarUrl={a.avatarUrl}
                    size="sm"
                  />
                  @{a.username}
                </span>
                <span className="text-muted">
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "short",
                  }).format(new Date(a.createdAt + "Z"))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* spec 028 — mural da edição: recorte do feed por hackathonId;
          leitura pública, postar exige inscrição (mesmo gate do board) */}
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          {"// mural da edição"}
        </h2>
        <FeedSection
          initialPosts={listPosts(50, member?.id ?? null, {
            hackathonId: h.id,
          })}
          canPost={Boolean(member && registered)}
          me={member?.username ?? null}
          isAdmin={member?.role === "admin"}
          hackathonId={h.id}
          editionLabel={h.name}
        />
      </div>
    </section>
  );
}
