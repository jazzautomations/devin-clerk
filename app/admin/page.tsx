import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { getOrCreateMember } from "@/lib/members";
import { CreateEventForm } from "@/components/CreateEventForm";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const member = getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
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
    location: string | null;
    active: number;
    inscritos: number;
  }[];

  const registrations = db
    .prepare(
      `SELECT r.id, r.createdAt, m.username, m.name, m.email, h.name AS evento
       FROM registrations r
       JOIN members m ON m.id = r.memberId
       JOIN hackathons h ON h.id = r.hackathonId
       ORDER BY r.id DESC LIMIT 100`,
    )
    .all() as {
    id: number;
    createdAt: string;
    username: string;
    name: string | null;
    email: string;
    evento: string;
  }[];

  const subscribers = db
    .prepare("SELECT email, createdAt FROM subscribers ORDER BY id DESC")
    .all() as { email: string; createdAt: string }[];

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
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[640px] border-collapse px-4">
            <thead>
              <tr className="border-b border-line">
                <th className={`${th} pl-4`}>evento</th>
                <th className={th}>data</th>
                <th className={th}>inscritos</th>
                <th className={th}>status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-line/50">
                  <td className={`${td} pl-4`}>
                    <a
                      href={`/h/${e.id}`}
                      className="text-foreground hover:text-accent"
                    >
                      {e.name}
                    </a>
                    <span className="block text-muted">{e.organizer}</span>
                  </td>
                  <td className={td}>
                    {new Intl.DateTimeFormat("pt-BR").format(
                      new Date(e.startsAt),
                    )}
                  </td>
                  <td className={`${td} text-accent`}>{e.inscritos}</td>
                  <td className={`${td} ${e.active ? "" : "text-muted"}`}>
                    {e.active ? "ativo" : "arquivado"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className={`${mono} tracking-widest text-muted uppercase`}>
          inscrições ({registrations.length})
        </h2>
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={`${th} pl-4`}>hacker</th>
                <th className={th}>e-mail</th>
                <th className={th}>evento</th>
                <th className={th}>em</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((r) => (
                <tr key={r.id} className="border-b border-line/50">
                  <td className={`${td} pl-4`}>
                    {r.name ?? `@${r.username}`}
                  </td>
                  <td className={td}>{r.email}</td>
                  <td className={td}>{r.evento}</td>
                  <td className={`${td} text-muted`}>
                    {new Intl.DateTimeFormat("pt-BR").format(
                      new Date(r.createdAt + "Z"),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {registrations.length === 0 && (
            <p className="px-4 py-6 font-mono text-xs text-muted">
              {"// nenhuma inscrição ainda"}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className={`${mono} tracking-widest text-muted uppercase`}>
            newsletter ({subscribers.length})
          </h2>
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
