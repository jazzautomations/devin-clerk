import Link from "next/link";
import { listMembers } from "@/lib/members";

export default function MembrosPage() {
  const members = listMembers(100);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// diretório"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Quem constrói aqui
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Devs, empreendedores, investidores, professores, marcas — todo mundo
          que gira o ecossistema de hackathons no Brasil.
        </p>
      </div>

      <ul className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => (
          <li key={m.username} className="bg-background">
            <Link
              href={`/u/${m.username}`}
              className="group flex h-full flex-col gap-2 p-5 transition hover:bg-surface"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display font-semibold tracking-tight transition group-hover:text-accent">
                  {m.name ?? `@${m.username}`}
                </span>
                {m.persona && (
                  <span className="shrink-0 border border-accent/30 bg-accent/10 px-1.5 font-mono text-[10px] text-accent">
                    {m.persona}
                  </span>
                )}
              </div>
              {m.headline && (
                <span className="font-mono text-xs text-muted">
                  {m.headline}
                </span>
              )}
              {m.skills.length > 0 && (
                <span className="mt-auto font-mono text-[10px] text-muted">
                  {m.skills.slice(0, 3).join(" · ")}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {members.length === 0 && (
        <p className="border border-dashed border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {"// ainda vazio — cria tua conta e entra pro wall"}
        </p>
      )}
    </section>
  );
}
