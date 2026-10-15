import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getHackathon, isOver } from "@/lib/hackathons";
import { absoluteUrl, eventJsonLd, jsonLd } from "@/lib/seo";
import { getMemberByClerkId } from "@/lib/members";
import {
  getEditionCapacity,
  getPublicListing,
  getRegistrationsByHackathon,
  getRegistrationStatus,
  getWaitlistPosition,
} from "@/lib/registrations";
import { consentPurpose } from "@/lib/registrationForm";
import { RegisterButton } from "@/components/RegisterButton";
import { PublicListingToggle } from "@/components/PublicListingToggle";
import { getImageConsent } from "@/lib/eventTerms";
import { ImageConsentToggle } from "@/components/ImageConsentToggle";
import { CollectibleCard } from "@/components/CollectibleCard";
import { getCardRarity, getCardSupply, getMemberCard } from "@/lib/xp";
import { getArchive } from "@/lib/archive";
import { getChallenges } from "@/lib/challenges";
import { listEditionSponsors } from "@/lib/editionSponsors";
import { EditionSponsors } from "@/components/EditionSponsors";
import { DeployPanel } from "@/components/DeployPanel";
import { getLatestDeployForTeam } from "@/lib/deploys";
import { listBoardEntries } from "@/lib/teamboard";
import { TeamBoardPanel } from "@/components/TeamBoardPanel";
import { memberTeamFor } from "@/lib/teams";
import { MyTeamPanel } from "@/components/MyTeamPanel";
import { listMyInvites, listPendingTeamInvites, type MyInvite } from "@/lib/teamInvites";
import { countdownTarget, editionPhase } from "@/lib/arena";
import type { EditionPhase } from "@/lib/arena";
import { ArenaCountdown } from "@/components/ArenaCountdown";
import { Avatar } from "@/components/Avatar";
import { FeedSection } from "@/components/FeedSection";
import { listPosts } from "@/lib/posts";
import { NextStepPanel } from "@/components/NextStepPanel";
import { EditionTeaser } from "@/components/EditionTeaser";
import { RadarEventFacts } from "@/components/RadarEventFacts";
import { getNextStep } from "@/lib/nextStepFacts";
import { EditionAnnouncements } from "@/components/EditionAnnouncements";
import {
  KIND_LABEL,
  KIND_PITCH,
  getMyApplications,
  getOpenKinds,
  type ApplicationKind,
  type ApplicationStatus,
} from "@/lib/roleApplications";
import { StageCta } from "@/components/StageCta";
import { EditionDeadlines } from "@/components/EditionDeadlines";
import { visibleArchive } from "@/lib/entriesPublic";
import { ScheduleNowNext } from "@/components/ScheduleNowNext";
import { ANON_VIEWER, listVisibleScheduleItems } from "@/lib/schedule";

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
  open: "text-band",
  "closed-soon": "text-[#f2b880]",
  live: "text-band animate-pulse",
  ongoing: "text-band animate-pulse",
  ended: "text-mint",
  archived: "text-mint",
};

// spec 019 — chip de tier do sponsor vinculado: master é o pacote lendário
const TIER_CLASS: Record<string, string> = {
  master: "border-lendario bg-lendario/10 text-lendario",
  sponsor: "border-accent bg-mint text-accent",
  apoio: "border-line text-muted",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const h = await getHackathon(id);
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
  const h = await getHackathon(id);
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
  // spec 039 — sem conta: teaser público (divulgação). O resto é de quem entra.
  if (!userId) {
    const [capT, sponsorsT, challengesT] = await Promise.all([
      getEditionCapacity(h.id),
      listEditionSponsors(h.id),
      getChallenges(h.id),
    ]);
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(eventJsonLd(h, [])) }} />
        <EditionTeaser
          h={h}
          past={past}
          closed={closed}
          approved={capT.approved}
          capacity={capT.capacity}
          remaining={capT.remaining}
          sponsors={sponsorsT}
          challenges={challengesT}
        />
      </>
    );
  }
  const member = await getMemberByClerkId(userId);
  // spec 032 — "inscrito" = approved; pending/rejected têm estado próprio
  // no CTA e não abrem os gates (time/board/mural) da página
  const myStatus = member ? await getRegistrationStatus(member.id, h.id) : null;
  const registered = myStatus === "approved";
  // spec 021 — time do próprio membro na edição (null = ainda não submeteu)
  const myTeam =
    member && registered ? await memberTeamFor(h.id, member.username) : null;
  // frente N #4 — convites de time pendentes (pra mim / do meu time)
  const [myInvites, teamPending] = await Promise.all([
    member && registered && !myTeam ? listMyInvites(member.id, h.id) : Promise.resolve([] as MyInvite[]),
    myTeam ? listPendingTeamInvites(myTeam.id) : Promise.resolve([] as string[]),
  ]);
  // frente N #6 — só quem optou por aparecer; a contagem é o agregado (cap.approved)
  const attendees = await getRegistrationsByHackathon(h.id);
  const myListing = member && registered ? await getPublicListing(member.id, h.id) : false;
  const cardRarity = await getCardRarity(h.id);
  const cardSupply = await getCardSupply(h.id);
  const myCard = member ? await getMemberCard(member.id, h.id) : null;
  // spec 034 — antes do prazo de entrega o arquivo não expõe projeto
  const archive = await visibleArchive(h.id, await getArchive(h.id), now);
  const hasArchive = archive.teams.length > 0 || archive.assets.length > 0;
  const challenges = await getChallenges(h.id);
  // roadmap 037 #8 — logos dos patrocinadores da edição
  const sponsors = await listEditionSponsors(h.id);
  const boardEntries = await listBoardEntries(h.id);
  const phase = editionPhase(h, now);
  const countdownTo = countdownTarget(h, now);
  const podium = archive.teams.filter((t) => t.placement >= 1 && t.placement <= 3);
  const field = archive.teams.filter((t) => t.placement === 0);
  const latestDeploys = new Map(
    await Promise.all(
      archive.teams.map(async (t) => [t.id, await getLatestDeployForTeam(t.id)] as const),
    ),
  );
  const editionPosts = await listPosts(50, member?.id ?? null, {
    hackathonId: h.id,
  });

  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const startDate = new Date(h.startsAt);
  const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(startDate);
  const mes = new Intl.DateTimeFormat("pt-BR", { month: "short" })
    .format(startDate)
    .replace(".", "")
    .toUpperCase();
  const ano = startDate.getFullYear();
  const diaSemana = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(startDate);
  const canRegister = !past && !closed && h.hosted;
  // spec 033 US1/FR-009 — formulário da edição, aceite LGPD e vagas
  // frente L — inscrição sempre passa pelo formulário (data de nascimento,
  // código de conduta e uso de imagem não cabem em 1 clique)
  const [consent, cap, myPosition, helpKinds, myApps, myImage] = await Promise.all([
    canRegister ? consentPurpose(h.id) : Promise.resolve(null),
    getEditionCapacity(h.id),
    member && myStatus === "waitlist" ? getWaitlistPosition(member.id, h.id) : Promise.resolve(null),
    // frente E — "Quer ajudar?": tipos de candidatura abertos pela organização
    !past && h.hosted ? getOpenKinds(h.id) : Promise.resolve([] as ApplicationKind[]),
    member ? getMyApplications(member.id, h.id) : Promise.resolve({} as Partial<Record<ApplicationKind, ApplicationStatus>>),
    member && myStatus ? getImageConsent(member.id, h.id) : Promise.resolve(null),
  ]);
  // roadmap 037 #4 — itens abertos da programação viram subEvent no JSON-LD
  const publicSchedule = await listVisibleScheduleItems(h.id, ANON_VIEWER);
  // spec 039 — o próximo passo da pessoa nesta edição, no topo da página
  const step = await getNextStep(h, member, now);
  const cancellable = canRegister && (myStatus === "approved" || myStatus === "pending" || myStatus === "waitlist");
  const regStatus = past
    ? "edição encerrada"
    : closed
      ? "encerradas"
      : h.registrationDeadline
        ? `até ${fmt.format(new Date(h.registrationDeadline))}`
        : "abertas";
  // numeração das seções na ordem em que aparecem (as condicionais pulam)
  let secN = 0;
  const nextK = () => String(++secN).padStart(2, "0");

  return (
    <div className="overflow-x-clip">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(eventJsonLd(h, publicSchedule)) }}
      />

      {/* faixa do evento — data, formato e local em pixel */}
      <div className="strip">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-x-6 gap-y-0.5 px-4 py-1.5 sm:px-6">
          <span>
            {dia} {mes} {ano} · {FORMAT_LABEL[h.format].toUpperCase()} ·{" "}
            {(h.location ?? "online").toUpperCase()}
          </span>
          <span>
            {past
              ? "ARQUIVO DA EDIÇÃO"
              : !h.hosted
                ? "EVENTO NO RADAR"
                : closed
                  ? "INSCRIÇÕES ENCERRADAS"
                  : "INSCRIÇÃO PELO HACKAHUB"}
          </span>
        </div>
      </div>

      {/* hero: nome grande à esquerda, ficha (ingresso) à direita */}
      <header className="mx-auto grid max-w-6xl gap-8 px-4 pt-8 pb-8 sm:px-6 sm:pt-14 lg:grid-cols-[1.55fr_1fr] lg:items-end lg:gap-14">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="tag uppercase">{past ? "arquivo" : "hackathon"}</p>
            <span className="chip bare" data-testid="edition-chip-inscricao">{h.hosted ? "inscrição no HackaHub" : "site oficial"}</span>
            <span className="chip bare">{FORMAT_LABEL[h.format]}</span>
          </div>
          <h1 className="mt-5 text-[clamp(2.4rem,7vw,5.25rem)] leading-[0.92] font-extrabold tracking-[-0.045em] break-words">
            {h.name}
          </h1>
          <p className="mt-4 text-[17px] text-muted">
            Realização <strong className="font-bold text-foreground">{h.organizer}</strong>
          </p>
          {h.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {h.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ficha técnica — a única da página */}
        <div className="border-t-[3px] border-b border-line">
          <div className="flex items-baseline gap-2 pt-4 text-[clamp(3.2rem,8vw,4.75rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
            {dia}
            <span className="text-[0.5em] text-accent">
              {mes} {ano}
            </span>
          </div>
          <p className="mt-2 mb-4 text-[14px] text-muted first-letter:uppercase">
            {diaSemana} · {fmt.format(startDate)}
          </p>
          <dl className="text-[14.5px]">
            <div className="grid grid-cols-[88px_1fr] gap-3 border-t border-line py-2.5">
              <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">local</dt>
              <dd className="font-semibold">{h.location ?? "Online"}</dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 border-t border-line py-2.5">
              <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">formato</dt>
              <dd className="font-semibold">
                {FORMAT_LABEL[h.format]}
                {h.hosted && (
                  <span className="font-normal text-muted">
                    {" "}
                    · {cap.approved} {cap.approved === 1 ? "inscrito" : "inscritos"}
                  </span>
                )}
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 border-t border-line py-2.5">
              <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">inscrições</dt>
              <dd className={`font-semibold ${closed || past ? "text-muted" : "text-accent"}`}>{regStatus}</dd>
            </div>
            {cap.capacity !== null && (
              <div className="grid grid-cols-[88px_1fr] gap-3 border-t border-line py-2.5">
                <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">vagas</dt>
                <dd className="font-semibold" data-testid="edition-capacity">
                  {cap.remaining === 0
                    ? `esgotadas · ${cap.waitlist} na fila`
                    : `${cap.remaining} de ${cap.capacity} livres`}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      {/* evento do radar: alcance, quem pode, prazos e prêmio antes do site oficial */}
      {!h.hosted && !past && (
        <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
          <RadarEventFacts h={h} now={now} />
        </div>
      )}

      {/* spec 039 — teu próximo passo: o estado da pessoa na edição e a ação */}
      <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <NextStepPanel step={step}>
          {(cancellable || (registered && !past && step.action?.href !== `/h/${h.id}/ingresso`)) && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {registered && !past && step.action?.href !== `/h/${h.id}/ingresso` ? (
                <Link
                  href={`/h/${h.id}/ingresso`}
                  data-testid="ticket-link"
                  className="font-mono text-[13px] text-band underline-offset-4 hover:underline"
                >
                  meu ingresso · QR do check-in →
                </Link>
              ) : (
                <span />
              )}
              {cancellable && (
                <div className="sm:w-auto [&_button]:w-full sm:[&_button]:w-auto">
                  <RegisterButton
                    hackathonId={h.id}
                    requiresApproval={h.requiresApproval}
                    status={myStatus}
                    formHref={`/h/${h.id}/inscricao`}
                    consentText={consent?.text ?? null}
                    full={!h.requiresApproval && cap.remaining === 0}
                    waitlistPosition={myPosition}
                  />
                </div>
              )}
            </div>
          )}
        </NextStepPanel>
      </div>

      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-14">
        {/* coluna principal */}
        <div className="flex min-w-0 flex-col gap-14">
          {member && <EditionAnnouncements hackathonId={h.id} member={member} />}
          {!past && <ScheduleNowNext hackathonId={h.id} member={member} now={now} compact />}
          {!past && countdownTo && (
            <div data-testid="arena-strip" className="window dark">
              <div className="tbar">
                <span className="title">CONTAGEM.exe</span>
                <span className="dots" aria-hidden>
                  <b />
                  <b />
                </span>
              </div>
              <div className="tbody gap-5 p-5!">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p
                    data-testid="arena-phase"
                    className={`pix text-[22px] uppercase ${PHASE_CLASS[phase]}`}
                  >
                    {PHASE_LABEL[phase]}
                  </p>
                  <p data-testid="arena-attendees" className="font-mono text-[13px] text-mint">
                    {cap.approved}{" "}
                    {cap.approved === 1 ? "inscrito" : "inscritos"}
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
            </div>
          )}

          <EditionDeadlines hackathonId={h.id} username={myTeam ? member!.username : null} />

          {/* spec 021 — inscrito submete/edita o próprio time; edição encerrada
              vira arquivo e o painel some (o time já tá em "resultado") */}
          {!past && registered && (
            <section id="meu-time" className="flex scroll-mt-24 flex-col gap-5">
              <SectionHead k={nextK()} title="Meu time" />
              <MyTeamPanel
                hackathonId={h.id}
                initialTeam={myTeam}
                initialInvites={myInvites}
                initialPending={teamPending}
              />
            </section>
          )}

          {challenges.length > 0 && (
            <section className="flex flex-col gap-5">
              <SectionHead
                k={nextK()}
                title="Desafios patrocinados"
                note="Escolha o desafio do time. Cada um tem dono, prêmio e o que entregar."
              />
              <ol className="border-b border-line">
                {challenges.map((c, i) => (
                  <li
                    key={c.id}
                    className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-t border-line py-6"
                  >
                    <span className="pix row-span-3 self-start bg-foreground px-2 text-[22px] leading-[1.2] text-band">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p className="font-mono text-[12px] tracking-[0.06em] text-accent uppercase">
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
                          className={`ml-2 inline-block border px-1.5 py-0.5 text-[11px] ${TIER_CLASS[c.sponsorTier] ?? "border-line text-muted"}`}
                        >
                          {c.sponsorTier}
                        </span>
                      )}
                    </p>
                    <h3 className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">
                      {c.title}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {c.prize && <p className="prize-badge w-fit text-lendario">prêmio: {c.prize}</p>}
                      {c.description && (
                        <p className="text-[15px] leading-relaxed text-muted">{c.description}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {(past || hasArchive) && (
            <section id="resultado" className="flex scroll-mt-24 flex-col gap-5">
              <SectionHead k={nextK()} title="Resultado" />
              {podium.length > 0 ? (
                <ol className="ink-grid sm:grid-cols-3">
                  {podium.map((t) => (
                    <li
                      key={t.id}
                      className={`flex flex-col gap-2 p-4 ${
                        t.placement === 1 ? "bg-mint!" : ""
                      }`}
                    >
                      <span
                        className={`pix self-start px-2 text-[26px] leading-[1.15] ${
                          t.placement === 1
                            ? "bg-foreground text-band"
                            : "border-[1.5px] border-line text-foreground"
                        }`}
                      >
                        {t.placement}º
                      </span>
                      <p className="text-[18px] font-extrabold tracking-[-0.02em]">{t.name}</p>
                      {t.project && (
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/p/${t.id}`}
                            className="text-[14px] font-semibold text-foreground underline-offset-4 hover:text-accent hover:underline"
                          >
                            {t.project.title}
                          </Link>
                          {t.project.description && (
                            <p className="text-[13px] text-muted">{t.project.description}</p>
                          )}
                          <span className="flex gap-3 font-mono text-[12px] text-accent">
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
                            initialDeploy={latestDeploys.get(t.id) ?? null}
                            canDeploy={
                              !!member &&
                              (member.role === "admin" ||
                                t.members.includes(member.username))
                            }
                          />
                        </div>
                      )}
                      {t.members.length > 0 && (
                        <p className="mt-auto font-mono text-[12px] text-muted">
                          {t.members.map((u) => `@${u}`).join(" ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : hasArchive ? (
                <p className="border-[1.5px] border-line px-5 py-6 font-mono text-[13px] text-muted">
                  {"pódio em organização"}
                </p>
              ) : (
                <p className="border-[1.5px] border-line px-5 py-6 font-mono text-[13px] text-muted">
                  {"arquivo em organização — resultado entra aqui depois do evento"}
                </p>
              )}

              {field.length > 0 && (
                <ul className="border-b border-line">
                  {field.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-4"
                    >
                      <div className="min-w-0">
                        <p className="text-[17px] font-extrabold tracking-[-0.02em]">{t.name}</p>
                        {t.project && (
                          <p className="text-[14px] text-muted">
                            <Link
                              href={`/p/${t.id}`}
                              className="text-foreground underline-offset-4 hover:text-accent hover:underline"
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
                                  className="font-mono text-[12px] text-accent hover:underline"
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
                            initialDeploy={latestDeploys.get(t.id) ?? null}
                            canDeploy={
                              !!member &&
                              (member.role === "admin" ||
                                t.members.includes(member.username))
                            }
                          />
                        )}
                      </div>
                      {t.members.length > 0 && (
                        <span className="font-mono text-[12px] text-muted">
                          {t.members.map((u) => `@${u}`).join(" ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {archive.assets.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
                    materiais & fotos
                  </h3>
                  <ul className="border-b border-line">
                    {archive.assets.map((a) => (
                      <li key={a.id} className="flex items-baseline gap-3 border-t border-line py-2.5">
                        <span className="pix w-16 shrink-0 text-[18px] text-muted uppercase">
                          {a.type}
                        </span>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener"
                          className="min-w-0 truncate text-[14px] text-accent hover:underline"
                        >
                          {a.caption ?? a.url.replace(/^https?:\/\//, "").slice(0, 50)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {(!past || boardEntries.length > 0) && (
            <section className="flex flex-col gap-5">
              <SectionHead
                k={nextK()}
                title={`Quem tá procurando time (${boardEntries.length})`}
                note="Chegou sozinho? Marca aqui e o time te acha."
              />
              <TeamBoardPanel
                hackathonId={h.id}
                canPost={!past && registered}
                myUsername={member?.username ?? null}
                initialEntries={boardEntries}
              />
            </section>
          )}

          {/* spec 028 — mural da edição: recorte do feed por hackathonId;
              leitura pública, postar exige inscrição (mesmo gate do board) */}
          <section className="flex flex-col gap-5">
            <SectionHead
              k={nextK()}
              title="Mural da edição"
              note="Demo, bastidor e recado de quem tá na edição."
            />
            <FeedSection
              initialPosts={editionPosts}
              canPost={Boolean(member && registered)}
              me={member?.username ?? null}
              isAdmin={member?.role === "admin"}
              hackathonId={h.id}
              editionLabel={h.name}
            />
          </section>
          {sponsors.length > 0 && (
            <section className="flex flex-col gap-5">
              <SectionHead k={nextK()} title="Patrocinadores" note="Quem banca a edição." />
              <EditionSponsors sponsors={sponsors} />
            </section>
          )}
        </div>

        {/* coluna lateral: palco, links da edição, carta, inscritos, ajudar */}
        <aside className="flex min-w-0 flex-col gap-8 lg:sticky lg:top-24 lg:self-start">
          <StageCta hackathonId={h.id} />

          {h.hosted && (
            <nav aria-label="Nesta edição" data-testid="safety-links" className="flex flex-col border-[1.5px] border-line">
              <h2 className="border-b border-line px-4 py-2.5 font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
                nesta edição
              </h2>
              <ul className="flex flex-col text-[14.5px]">
                {publicSchedule.length > 0 && (
                  <EditionLink href={`/h/${h.id}/programacao`} label="programação" note={`${publicSchedule.length} itens · .ics`} />
                )}
                {(past || hasArchive) && <EditionLink href={`/h/${h.id}/projetos`} label="projetos entregues" />}
                <EditionLink href={`/h/${h.id}/duvidas`} label="dúvidas pra organização" />
                <EditionLink href={`/h/${h.id}/conduta`} label="código de conduta da edição" />
                <EditionLink href={`/h/${h.id}/incidente`} label="relatar um problema (pode ser anônimo)" />
              </ul>
              {myImage && (
                <div className="border-t border-line px-4 py-3">
                  <ImageConsentToggle hackathonId={h.id} granted={myImage.granted} source="edicao" />
                </div>
              )}
            </nav>
          )}

          <div className="flex flex-col gap-4">
            <h2 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
              cartinha colecionável desta edição
            </h2>
            <div className="grid grid-cols-[minmax(0,160px)_1fr] items-start gap-4">
              <CollectibleCard
                hackathonId={h.id}
                name={h.name}
                startsAt={h.startsAt}
                location={h.location}
                rarity={cardRarity}
                serial={myCard?.serial}
                supply={myCard === null ? cardSupply : undefined}
              />
              <div className="flex flex-col gap-3 text-[13px] leading-snug text-muted">
                <p>
                  {myCard
                    ? `tu tens a № ${String(myCard.serial).padStart(3, "0")} — prova de presença na tua coleção`
                    : past
                      ? "edição encerrada — a tiragem desta carta fechou"
                      : "inscreve-te pra mintar a tua — serial na ordem de chegada"}
                </p>
                <p className="pix text-[22px] leading-none text-foreground">
                  {cardSupply} {cardSupply === 1 ? "mintada" : "mintadas"} até agora
                </p>
              </div>
            </div>
          </div>

          {cap.approved > 0 && (
            <div className="flex flex-col gap-3" data-testid="public-attendees">
              <h2 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
                inscritos ({cap.approved})
                {boardEntries.length > 0 &&
                  ` · ${boardEntries.length} procurando time`}
              </h2>
              <p className="text-[13px] leading-snug text-muted" data-testid="public-attendees-note">
                {attendees.length === cap.approved
                  ? "só aparece aqui quem escolheu aparecer"
                  : `só aparece aqui quem escolheu aparecer · ${cap.approved - attendees.length} ${
                      cap.approved - attendees.length === 1 ? "preferiu" : "preferiram"
                    } não`}
              </p>
              {registered && <PublicListingToggle hackathonId={h.id} initial={myListing} />}
              {attendees.length > 0 && (
              <ul className="max-h-[360px] overflow-y-auto border-y border-line text-[14px]">
                {attendees.map((a) => (
                  <li
                    key={a.username}
                    className="flex items-center justify-between gap-2 border-t border-line-soft py-2 first:border-t-0"
                  >
                    <Link
                      href={`/u/${a.username}`}
                      className="flex min-w-0 items-center gap-2 font-medium hover:text-accent"
                    >
                      <Avatar
                        username={a.username}
                        name={a.name}
                        avatarUrl={a.avatarUrl}
                        size="sm"
                      />
                      <span className="truncate">@{a.username}</span>
                    </Link>
                    <span className="font-mono text-[12px] text-muted">
                      {new Intl.DateTimeFormat("pt-BR", {
                        day: "2-digit",
                        month: "short",
                      }).format(new Date(a.createdAt + "Z"))}
                    </span>
                  </li>
                ))}
              </ul>
              )}
            </div>
          )}

          {helpKinds.length > 0 && (
            <section data-testid="help-cta" className="flex flex-col gap-3 border-[1.5px] border-line p-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-[22px] leading-none font-extrabold tracking-[-0.03em]">Quer ajudar?</h2>
                <p className="text-[13px] text-muted">
                  A organização está recebendo candidaturas. Quem ajuda não compete na mesma edição.
                </p>
              </div>
              <ul className="flex flex-col">
                {helpKinds.map((k) => {
                  const st = myApps[k];
                  return (
                    <li key={k} className="flex items-center justify-between gap-3 border-t border-line py-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold first-letter:uppercase">{KIND_LABEL[k]}</p>
                        <p className="text-[13px] leading-snug text-muted">{KIND_PITCH[k]}</p>
                      </div>
                      <Link
                        href={`/h/${h.id}/candidatura/${k}`}
                        className={`shrink-0 rounded-[6px] border-[1.5px] px-3 py-2 font-mono text-[12px] font-semibold whitespace-nowrap ${
                          st ? "border-line text-muted" : "border-accent text-accent hover:bg-accent hover:text-background"
                        }`}
                        aria-label={`candidatar-se como ${KIND_LABEL[k]}`}
                      >
                        {st === "pending"
                          ? "em análise"
                          : st === "approved"
                            ? "aprovada"
                            : st === "rejected"
                              ? "não aprovada"
                              : "candidatar-se"}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function EditionLink({ href, label, note }: { href: string; label: string; note?: string }) {
  return (
    <li className="border-t border-line-soft first:border-t-0">
      <Link
        href={href}
        className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-foreground underline-offset-4 hover:bg-mint hover:underline"
      >
        <span>{label}</span>
        <span className="shrink-0 font-mono text-[12px] text-accent">{note ?? "→"}</span>
      </Link>
    </li>
  );
}

// cabeçalho de seção: fio grosso de tinta, número em mono verde, título pesado
function SectionHead({ k, title, note }: { k: string; title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-2 border-t-2 border-line pt-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <h2 className="flex items-baseline gap-3 text-[clamp(1.6rem,3vw,2.1rem)] leading-none font-extrabold tracking-[-0.035em]">
        <span className="font-mono text-[15px] font-medium tracking-normal text-accent">{k}</span>
        {title}
      </h2>
      {note && <p className="max-w-[38ch] text-[14px] text-muted sm:text-right">{note}</p>}
    </div>
  );
}
