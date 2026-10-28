import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { hostedSql } from "@/lib/hackathons";
import { getOrCreateMember } from "@/lib/members";
import { listSubscribers } from "@/lib/admin";
import { listChallenges } from "@/lib/challenges";
import { listSponsors } from "@/lib/sponsors";
import { listAllBoardEntries } from "@/lib/teamboard";
import { LEAD_INTEREST_LABELS, listLeads } from "@/lib/leads";
import { listPendingSubmissions } from "@/lib/submissions";
import { getArchive } from "@/lib/archive";
import { CreateEventForm } from "@/components/CreateEventForm";
import { EditEventForm } from "@/components/EditEventForm";
import { ChallengeForm, ChallengeToggle } from "@/components/ChallengeForm";
import { SponsorForm, SponsorToggle } from "@/components/SponsorForm";
import { TeamBoardToggle } from "@/components/TeamBoardPanel";
import { AssetForm, TeamForm } from "@/components/ArchiveForms";
import { SubmissionActions } from "@/components/SubmissionActions";
import { EditionList, RADAR_PAGE, type AdminEdition } from "@/components/AdminEditionList";
import { ModerationToggles } from "@/components/CommunityActions";
import { listCommunities, listRecentCommunityHackathons } from "@/lib/communities";
import { countOpenByType, listReports } from "@/lib/reports";
import { ReportQueue, reportTypeParam } from "@/components/ReportQueue";

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const member = await getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    imageUrl: user?.imageUrl ?? null,
  });
  if (member.role !== "admin") notFound();

  // Edições: separa as que rodam no HackaHub (criadas pelo painel, de
  // comunidade ou com equipe) do catálogo raspado pelo radar. Um SELECT só com os
  // contadores; o detalhe (desafios, quadro, arquivo, editar) só carrega da
  // edição aberta (?h=), em vez de ~4 consultas por edição a cada visita.
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const openId = typeof sp.h === "string" ? sp.h : "";
  const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const events = await db
    .prepare(
      `SELECT h.id, h.name, h.organizer, h.startsAt, h.endsAt, h.format, h.location, h.registrationUrl,
              h.registrationDeadline, h.tags, h.active, h.requiresApproval,
              (SELECT COUNT(*)::int FROM registrations r WHERE r.hackathonId = h.id) AS inscritos,
              (SELECT COUNT(*)::int FROM registrations r
                WHERE r.hackathonId = h.id AND r.status = 'pending') AS pendentes,
              (SELECT COUNT(*)::int FROM schedule_items si WHERE si.hackathonId = h.id) AS "scheduleItems",
              (${hostedSql("h")}
                OR EXISTS (SELECT 1 FROM edition_roles er WHERE er.hackathonId = h.id)) AS "ours"
       FROM hackathons h
       WHERE (@q = '' OR lower(h.name) LIKE @like ESCAPE '\\' OR h.id LIKE @like ESCAPE '\\')
       ORDER BY to_ts(h.startsAt) DESC NULLS LAST`,
    )
    .all<AdminEdition>({ q, like });
  const ours = events.filter((e) => e.ours);
  const radar = events.filter((e) => !e.ours);
  const radarShown = q ? radar : radar.slice(0, RADAR_PAGE);
  const opened = openId ? (events.find((e) => e.id === openId) ?? null) : null;
  const detail = opened
    ? await Promise.all([listChallenges(opened.id), listAllBoardEntries(opened.id), getArchive(opened.id)])
    : null;
  const challenges = detail?.[0] ?? [];
  const board = detail?.[1] ?? [];
  const archive = detail?.[2] ?? { teams: [], assets: [] };

  const subscribers = await listSubscribers();

  // moderação de comunidades (migration 027): todas (inclusive escondidas)
  // e hackathons novos de comunidade. Denúncias (032): a fila única, com
  // todas as abertas de qualquer espaço e o filtro por tipo (?tipo=)
  const reportType = reportTypeParam(sp.tipo);
  const [communities, recentHackathons, openReports, resolvedReports, reportCounts] = await Promise.all([
    listCommunities({ includeHidden: true }),
    listRecentCommunityHackathons(),
    listReports({ global: true }, { type: reportType }),
    listReports({ global: true }, { status: "resolved", limit: 10 }),
    countOpenByType({ global: true }),
  ]);

  // CRM de marcas (spec 019) — cadastro único, vínculo nos desafios via API
  const sponsors = await listSponsors();

  // fila de prospecção (spec 022) — leads do /empresas, mais recente primeiro
  const leads = await listLeads();

  // fila de curadoria (spec 026) — indicações do /radar, mais antiga primeiro
  const submissions = await listPendingSubmissions();

  const members = await db
    .prepare(
      "SELECT username, name, email, role, createdAt FROM members ORDER BY id",
    )
    .all() as {
    username: string;
    name: string | null;
    email: string;
    role: string;
    createdAt: string;
  }[];

  const mono = "font-mono text-xs";

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2">
        <p className={`${mono} tracking-widest text-accent`}>{"admin"}</p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          Painel do organizador
        </h1>
        <Link href="/admin/metricas" className={`${mono} self-start text-accent underline underline-offset-4`} data-testid="admin-metrics-link">
          métricas da rede →
        </Link>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          nova edição
        </h2>
        <CreateEventForm communities={communities.filter((c) => !c.hidden).map((c) => ({ slug: c.slug, name: c.name }))} />
      </div>

      <div id="denuncias" className="flex scroll-mt-24 flex-col gap-4" data-testid="admin-reports">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          denúncias abertas ({Object.values(reportCounts).reduce((a, b) => a + (b ?? 0), 0)})
        </h2>
        <p className="max-w-2xl text-[14px] text-muted">
          Todas as abertas, de qualquer espaço. A de mural de comunidade também chega pra organização dela; a de mural de
          edição, pra quem trata incidentes da edição. Perfil e comunidade inteira só chegam aqui.
        </p>
        <ReportQueue
          open={openReports}
          resolved={resolvedReports}
          counts={reportCounts}
          type={reportType}
          basePath="/admin"
          anchor="#denuncias"
          showRouting
          empty="nenhuma denúncia aberta."
        />
      </div>

      <div id="comunidades" className="flex scroll-mt-24 flex-col gap-4" data-testid="admin-communities">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>comunidades ({communities.length})</h2>
        <ul className="divide-y divide-line border-y border-line">
          {communities.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className={`${mono} min-w-0`}>
                <Link href={`/comunidade/${c.slug}`} className="text-accent hover:underline">
                  {c.name}
                </Link>
                <span className="ml-2 text-muted">
                  {c.city ?? "online"} · {c.members} membros · {c.hackathons} no ar
                </span>
                {c.owners === 0 && <span className="ml-2 border border-line px-1.5 text-muted">sem dono</span>}
                {c.verified && <span className="ml-2 border border-accent px-1.5 text-accent">selo</span>}
                {c.hidden && <span className="ml-2 border border-orange px-1.5 text-orange">escondida</span>}
                {c.reports > 0 && <span className="ml-2 text-orange">{c.reports} denúncia(s)</span>}
              </span>
              <ModerationToggles slug={c.slug} hidden={c.hidden} verified={c.verified} />
            </li>
          ))}
        </ul>
        {recentHackathons.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className={`${mono} text-muted uppercase`}>hackathons novos de comunidade (30 dias)</p>
            <ul className="divide-y divide-line border-y border-line">
              {recentHackathons.map((h) => (
                <li key={h.id} className={`${mono} flex flex-wrap justify-between gap-2 py-2`}>
                  <span>
                    <Link href={`/admin/h/${h.id}`} className="text-accent hover:underline">
                      {h.name}
                    </Link>{" "}
                    <span className="text-muted">· {h.communityName}</span>
                  </span>
                  <span className="text-muted">{h.active === 1 ? "no ar" : "rascunho"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className={`${mono} tracking-widest text-muted uppercase`}>
            edições no HackaHub ({ours.length})
          </h2>
          <form action="/admin" className="flex w-full gap-2 sm:w-auto" role="search">
            <input
              name="q"
              defaultValue={q}
              aria-label="buscar edição por nome ou endereço"
              placeholder="buscar por nome ou endereço"
              className="w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm sm:w-72"
            />
            <button type="submit" className="btn-ghost shrink-0 rounded-[6px]">
              buscar
            </button>
          </form>
        </div>
        {q && (
          <p className={`${mono} text-muted`}>
            resultado pra “{q}” ·{" "}
            <Link href="/admin" className="text-accent underline underline-offset-4">
              limpar busca
            </Link>
          </p>
        )}
        <EditionList events={ours} openId={openId} q={q} empty="nenhuma edição com esse nome" />
      </div>

      {opened && (
        <div id="edicao-aberta" className="flex scroll-mt-24 flex-col gap-5 border-[1.5px] border-line p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[1.4rem] leading-none font-extrabold tracking-[-0.02em]">{opened.name}</h2>
            <Link href={q ? `/admin?q=${encodeURIComponent(q)}` : "/admin"} className={`${mono} text-accent hover:underline`}>
              fechar
            </Link>
          </div>
          <p className={`${mono} text-muted`}>
            inscrições, aprovação e o resto da operação ficam no{" "}
            <Link href={`/admin/h/${opened.id}`} className="text-accent underline underline-offset-4">
              painel da edição
            </Link>
            .
          </p>
          <div className="flex flex-col gap-3">
            <h3 className={`${mono} tracking-widest text-muted uppercase`}>
              desafios patrocinados ({challenges.length})
            </h3>
            {challenges.length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {challenges.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-4 py-2">
                    <span className={mono}>
                      <span className="text-accent uppercase">{c.sponsor}</span> · {c.title}
                      {c.prize && <span className="ml-2 text-lendario">{c.prize}</span>}
                      {!c.active && <span className="ml-2 text-muted">(inativo)</span>}
                    </span>
                    <ChallengeToggle id={c.id} active={c.active} />
                  </li>
                ))}
              </ul>
            )}
            <ChallengeForm hackathonId={opened.id} />
          </div>
          <div className="flex flex-col gap-3">
            <h3 className={`${mono} tracking-widest text-muted uppercase`}>procurando time ({board.length})</h3>
            {board.length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {board.map((b) => (
                  <li key={b.id} className="flex items-baseline justify-between gap-4 py-2">
                    <span className={mono}>
                      @{b.username} · {b.need}
                      {!b.active && <span className="ml-2 text-muted">(inativo)</span>}
                    </span>
                    <TeamBoardToggle entryId={b.id} hackathonId={opened.id} active={b.active} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <h3 className={`${mono} tracking-widest text-muted uppercase`}>editar edição</h3>
            <EditEventForm
              isAdmin
              event={{
                id: opened.id,
                name: opened.name,
                startsAt: opened.startsAt,
                endsAt: opened.endsAt,
                format: opened.format,
                location: opened.location,
                registrationUrl: opened.registrationUrl,
                registrationDeadline: opened.registrationDeadline,
                tags: JSON.parse(opened.tags) as string[],
                active: opened.active === 1,
                requiresApproval: opened.requiresApproval === 1,
                scheduleItems: Number(opened.scheduleItems),
              }}
            />
          </div>
          <div className="flex flex-col gap-3">
            <h3 className={`${mono} tracking-widest text-muted uppercase`}>
              arquivo ({archive.teams.length} {archive.teams.length === 1 ? "time" : "times"} ·{" "}
              {archive.assets.length} {archive.assets.length === 1 ? "material" : "materiais"})
            </h3>
            {archive.teams.length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {archive.teams.map((t) => (
                  <li key={t.id} className="flex items-baseline justify-between gap-4 py-2">
                    <span className={mono}>
                      {t.placement > 0 && (
                        <span className={t.placement === 1 ? "text-lendario" : "text-muted"}>{t.placement}º </span>
                      )}
                      {t.name}
                      {t.project && <span className="text-muted"> · {t.project.title}</span>}
                      {t.members.length > 0 && (
                        <span className="ml-2 text-muted">{t.members.map((u) => `@${u}`).join(" ")}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <TeamForm hackathonId={opened.id} />
            <AssetForm hackathonId={opened.id} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          catálogo do radar ({radar.length})
        </h2>
        <p className="text-[14px] text-muted">
          Hackathons de outros organizadores que aparecem no radar.
          {!q && radar.length > radarShown.length && ` Mostrando os ${radarShown.length} mais recentes; use a busca pra achar os outros.`}
        </p>
        <EditionList events={radarShown} openId={openId} q={q} empty="nada no radar com esse nome" />
      </div>

      <div className="flex flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          {"sponsors"} ({sponsors.length})
        </h2>
        {sponsors.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {sponsors.map((s) => (
              <li
                key={s.id}
                className="flex items-baseline justify-between gap-4 py-2"
              >
                <span className={mono}>
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener"
                      className="text-accent hover:underline"
                    >
                      {s.name}
                    </a>
                  ) : (
                    <span className="text-accent">{s.name}</span>
                  )}
                  <span className="ml-2 text-muted uppercase">{s.tier}</span>
                  <span className="ml-2 text-muted">
                    {s.challengeCount}{" "}
                    {s.challengeCount === 1 ? "desafio" : "desafios"}
                  </span>
                  {!s.active && (
                    <span className="ml-2 text-muted">(inativo)</span>
                  )}
                </span>
                <SponsorToggle id={s.id} active={s.active} />
              </li>
            ))}
          </ul>
        )}
        <SponsorForm />
      </div>

      <div id="leads" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          {"leads"} ({leads.length})
        </h2>
        {leads.length > 0 ? (
          <ul className="divide-y divide-line border-y border-line">
            {leads.map((l) => (
              <li
                key={l.id}
                className="flex items-baseline justify-between gap-4 py-2"
              >
                <span className={`${mono} min-w-0 [overflow-wrap:anywhere]`}>
                  <span className="text-accent">{l.company}</span>
                  <span className="ml-2 text-muted">{l.email}</span>
                  <span className="ml-2 border border-line px-1.5 text-[12px] text-muted uppercase">
                    {LEAD_INTEREST_LABELS[l.interest]}
                  </span>
                  {l.message && (
                    <span className="mt-1 block text-muted">{l.message}</span>
                  )}
                </span>
                <span className={`${mono} shrink-0 text-muted`}>
                  {new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(l.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-[1.5px] border-line px-4 py-4 font-mono text-xs text-muted">
            {"nenhum lead ainda — a porta é /empresas"}
          </p>
        )}
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className={`${mono} tracking-widest text-muted uppercase`}>
              newsletter ({subscribers.length})
            </h2>
            <a
              href="/api/admin/subscribers?format=csv"
              className={`${mono} text-accent hover:underline`}
            >
              baixar planilha ↓
            </a>
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {subscribers.map((s) => (
              <li
                key={s.email}
                className="flex items-center justify-between gap-4 py-2"
              >
                <span className={mono}>{s.email}</span>
                <span className={`${mono} text-muted`}>
                  {new Intl.DateTimeFormat("pt-BR").format(
                    new Date(s.createdAt + "Z"),
                  )}
                </span>
              </li>
            ))}
            {subscribers.length === 0 && (
              <li className="py-4 font-mono text-xs text-muted">
                {"nenhum assinante ainda"}
              </li>
            )}
          </ul>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className={`${mono} tracking-widest text-muted uppercase`}>
            membros ({members.length})
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {members.map((m) => (
              <li
                key={m.username}
                className="flex items-center justify-between gap-4 py-2"
              >
                <span className={mono}>
                  {m.name ?? `@${m.username}`}
                  <span className="ml-2 text-muted">@{m.username}</span>
                </span>
                <span
                  className={`${mono} ${m.role === "admin" ? "text-accent" : "text-muted"}`}
                >
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          {"indicações"} ({submissions.length})
        </h2>
        {submissions.length > 0 ? (
          <ul className="divide-y divide-line border-y border-line">
            {submissions.map((s) => (
              <li
                key={s.id}
                className="flex items-baseline justify-between gap-4 py-2"
              >
                <span className={mono}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {s.name}
                  </a>
                  <span className="ml-2 border border-line px-1.5 text-[12px] text-muted uppercase">
                    {s.format}
                  </span>
                  {s.startsAt && (
                    <span className="ml-2 text-muted">
                      {new Intl.DateTimeFormat("pt-BR").format(
                        new Date(s.startsAt),
                      )}
                    </span>
                  )}
                  {s.location && (
                    <span className="ml-2 text-muted">{s.location}</span>
                  )}
                  {s.note && (
                    <span className="mt-1 block text-muted">{s.note}</span>
                  )}
                  <span className="mt-1 block text-[12px] text-muted">
                    indicado em{" "}
                    {new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(s.createdAt))}
                  </span>
                </span>
                <SubmissionActions id={s.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-[1.5px] border-line px-4 py-4 font-mono text-xs text-muted">
            {"fila vazia — a porta é o fim do /radar"}
          </p>
        )}
      </div>
    </section>
  );
}
