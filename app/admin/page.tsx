import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { getOrCreateMember } from "@/lib/members";
import { listRegistrants } from "@/lib/registrations";
import { listSubscribers } from "@/lib/admin";
import { listChallenges } from "@/lib/challenges";
import { listSponsors } from "@/lib/sponsors";
import { listAllBoardEntries } from "@/lib/teamboard";
import { getArchive } from "@/lib/archive";
import { CreateEventForm } from "@/components/CreateEventForm";
import { EditEventForm } from "@/components/EditEventForm";
import { ChallengeForm, ChallengeToggle } from "@/components/ChallengeForm";
import { SponsorForm, SponsorToggle } from "@/components/SponsorForm";
import { TeamBoardToggle } from "@/components/TeamBoardPanel";
import { AssetForm, TeamForm } from "@/components/ArchiveForms";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const member = getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    imageUrl: user?.imageUrl ?? null,
  });
  if (member.role !== "admin") notFound();

  const events = db
    .prepare(
      `SELECT h.*, COUNT(r.id) AS inscritos
       FROM hackathons h
       LEFT JOIN registrations r ON r.hackathonId = h.id
       GROUP BY h.id
       ORDER BY h.startsAt DESC`,
    )
    .all() as {
    id: string;
    name: string;
    organizer: string;
    startsAt: string;
    endsAt: string | null;
    format: string;
    location: string | null;
    registrationUrl: string;
    registrationDeadline: string | null;
    tags: string;
    active: number;
    inscritos: number;
  }[];

  // inscritos por edição — server-side direto na lib (com e-mail, é tela admin)
  const registrantsByEvent = new Map(
    events.map((e) => [e.id, listRegistrants(e.id)]),
  );

  // desafios por edição — inclui inativos (o admin gere o inventário)
  const challengesByEvent = new Map(
    events.map((e) => [e.id, listChallenges(e.id)]),
  );

  // board "procuro time" por edição — inclui inativos (moderação)
  const boardByEvent = new Map(
    events.map((e) => [e.id, listAllBoardEntries(e.id)]),
  );

  // arquivo da edição (times + materiais) — cadastro pós-evento, spec 015
  const archiveByEvent = new Map(events.map((e) => [e.id, getArchive(e.id)]));

  const subscribers = listSubscribers();

  // CRM de marcas (spec 019) — cadastro único, vínculo nos desafios via API
  const sponsors = listSponsors();

  const members = db
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
  const th = `${mono} text-left text-muted uppercase tracking-widest pb-2`;
  const td = `${mono} py-2 pr-4 align-top`;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <div className="flex flex-col gap-2">
        <p className={`${mono} tracking-widest text-accent`}>{"// admin"}</p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Painel do organizador
        </h1>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          nova edição
        </h2>
        <CreateEventForm />
      </div>

      <div className="flex flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          edições ({events.length})
        </h2>
        <ul className="divide-y divide-line border-y border-line">
          {events.map((e) => {
            const registrants = registrantsByEvent.get(e.id) ?? [];
            const archive = archiveByEvent.get(e.id) ?? {
              teams: [],
              assets: [],
            };
            return (
              <li key={e.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className={mono}>
                      {e.name}
                      <span className="block text-muted">{e.organizer}</span>
                    </span>
                    <span className={`${mono} shrink-0 text-right text-muted`}>
                      {new Intl.DateTimeFormat("pt-BR").format(
                        new Date(e.startsAt),
                      )}{" "}
                      ·{" "}
                      <span className="text-accent">
                        {registrants.length} inscritos
                      </span>{" "}
                      · {e.active ? "ativo" : "arquivado"}{" "}
                      <span className="group-open:hidden">▸</span>
                      <span className="hidden group-open:inline">▾</span>
                    </span>
                  </summary>
                  <div className="flex flex-col gap-5 border-t border-line/50 py-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-baseline justify-between">
                        <h3
                          className={`${mono} tracking-widest text-muted uppercase`}
                        >
                          inscritos ({registrants.length})
                        </h3>
                        <a
                          href={`/h/${e.id}`}
                          className={`${mono} text-accent hover:underline`}
                        >
                          ver página pública →
                        </a>
                      </div>
                      {registrants.length > 0 ? (
                        <div className="overflow-x-auto border border-line">
                          <table className="w-full min-w-[480px] border-collapse">
                            <thead>
                              <tr className="border-b border-line">
                                <th className={`${th} pl-4`}>hacker</th>
                                <th className={th}>e-mail</th>
                                <th className={th}>inscreveu em</th>
                              </tr>
                            </thead>
                            <tbody>
                              {registrants.map((r) => (
                                <tr
                                  key={r.username}
                                  className="border-b border-line/50"
                                >
                                  <td className={`${td} pl-4`}>
                                    {r.name ?? `@${r.username}`}
                                    <span className="ml-2 text-muted">
                                      @{r.username}
                                    </span>
                                  </td>
                                  <td className={td}>{r.email}</td>
                                  <td className={`${td} text-muted`}>
                                    {new Intl.DateTimeFormat("pt-BR").format(
                                      new Date(r.createdAt + "Z"),
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="border border-dashed border-line px-4 py-4 font-mono text-xs text-muted">
                          {"// nenhuma inscrição ainda"}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-3">
                      <h3
                        className={`${mono} tracking-widest text-muted uppercase`}
                      >
                        {"// desafios patrocinados"} (
                        {challengesByEvent.get(e.id)?.length ?? 0})
                      </h3>
                      {(challengesByEvent.get(e.id) ?? []).length > 0 && (
                        <ul className="divide-y divide-line border-y border-line">
                          {(challengesByEvent.get(e.id) ?? []).map((c) => (
                            <li
                              key={c.id}
                              className="flex items-baseline justify-between gap-4 py-2"
                            >
                              <span className={mono}>
                                <span className="text-accent uppercase">
                                  {c.sponsor}
                                </span>{" "}
                                — {c.title}
                                {c.prize && (
                                  <span className="ml-2 text-lendario">
                                    {c.prize}
                                  </span>
                                )}
                                {!c.active && (
                                  <span className="ml-2 text-muted">
                                    (inativo)
                                  </span>
                                )}
                              </span>
                              <ChallengeToggle id={c.id} active={c.active} />
                            </li>
                          ))}
                        </ul>
                      )}
                      <ChallengeForm hackathonId={e.id} />
                    </div>
                    <div className="flex flex-col gap-3">
                      <h3
                        className={`${mono} tracking-widest text-muted uppercase`}
                      >
                        {"// procurando time"} (
                        {boardByEvent.get(e.id)?.length ?? 0})
                      </h3>
                      {(boardByEvent.get(e.id) ?? []).length > 0 && (
                        <ul className="divide-y divide-line border-y border-line">
                          {(boardByEvent.get(e.id) ?? []).map((b) => (
                            <li
                              key={b.id}
                              className="flex items-baseline justify-between gap-4 py-2"
                            >
                              <span className={mono}>
                                @{b.username} — {b.need}
                                {!b.active && (
                                  <span className="ml-2 text-muted">
                                    (inativo)
                                  </span>
                                )}
                              </span>
                              <TeamBoardToggle
                                entryId={b.id}
                                hackathonId={e.id}
                                active={b.active}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-col gap-3">
                      <h3
                        className={`${mono} tracking-widest text-muted uppercase`}
                      >
                        editar edição
                      </h3>
                      <EditEventForm
                        event={{
                          id: e.id,
                          name: e.name,
                          startsAt: e.startsAt,
                          endsAt: e.endsAt,
                          format: e.format,
                          location: e.location,
                          registrationUrl: e.registrationUrl,
                          registrationDeadline: e.registrationDeadline,
                          tags: JSON.parse(e.tags) as string[],
                          active: e.active === 1,
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-3">
                      <h3
                        className={`${mono} tracking-widest text-muted uppercase`}
                      >
                        {"// arquivo"} ({archive.teams.length}{" "}
                        {archive.teams.length === 1 ? "time" : "times"} ·{" "}
                        {archive.assets.length}{" "}
                        {archive.assets.length === 1 ? "material" : "materiais"})
                      </h3>
                      {archive.teams.length > 0 && (
                        <ul className="divide-y divide-line border-y border-line">
                          {archive.teams.map((t) => (
                            <li
                              key={t.id}
                              className="flex items-baseline justify-between gap-4 py-2"
                            >
                              <span className={mono}>
                                {t.placement > 0 && (
                                  <span
                                    className={
                                      t.placement === 1
                                        ? "text-lendario"
                                        : "text-muted"
                                    }
                                  >
                                    {t.placement}º{" "}
                                  </span>
                                )}
                                {t.name}
                                {t.project && (
                                  <span className="text-muted">
                                    {" "}
                                    — {t.project.title}
                                  </span>
                                )}
                                {t.members.length > 0 && (
                                  <span className="ml-2 text-muted">
                                    {t.members
                                      .map((u) => `@${u}`)
                                      .join(" ")}
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <TeamForm hackathonId={e.id} />
                      <AssetForm hackathonId={e.id} />
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          {"// sponsors"} ({sponsors.length})
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
              exportar csv ↓
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
                {"// nenhum assinante ainda"}
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
    </section>
  );
}
