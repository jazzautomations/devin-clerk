import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { appConfig } from "@/app.config";
import { getProjectByTeamId } from "@/lib/archive";
import { getLatestDeployForTeam } from "@/lib/deploys";

type Props = { params: Promise<{ teamId: string }> };

function parseTeamId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { teamId } = await params;
  const id = parseTeamId(teamId);
  const data = id === null ? null : getProjectByTeamId(id);
  if (!data) return { title: `projeto não encontrado — ${appConfig.name}` };
  const description =
    data.project.description ??
    `projeto de ${data.teamName} no ${data.hackathonName} — arquivo do ${appConfig.name}`;
  return {
    title: data.project.title,
    description,
    openGraph: {
      title: data.project.title,
      description,
      siteName: appConfig.name,
      type: "website",
    },
  };
}

export default async function ProjectPage({ params }: Props) {
  const { teamId } = await params;
  const id = parseTeamId(teamId);
  const data = id === null ? null : getProjectByTeamId(id);
  if (!data) notFound();

  const deploy = getLatestDeployForTeam(data.teamId);
  const live = deploy?.status === "running" ? deploy : null;
  const place = data.placement;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// projeto"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {data.project.title}
        </h1>
        <p className="font-mono text-sm text-muted">
          <Link
            href={`/h/${data.hackathonId}`}
            className="text-accent hover:underline"
          >
            {data.hackathonName}
          </Link>
          {" · "}
          {data.teamName}
        </p>
        {place >= 1 && place <= 3 && (
          <span
            className={`w-fit border px-2 py-1 font-mono text-xs ${
              place === 1
                ? "border-lendario/60 bg-lendario/10 text-lendario"
                : "border-line bg-surface text-muted"
            }`}
          >
            {place}º lugar
          </span>
        )}
      </div>

      {live && (
        <a
          href={`/demo/${live.id}/`}
          className="flex items-center justify-between gap-4 border border-accent/50 bg-accent/10 px-5 py-4 font-mono text-sm text-accent transition hover:bg-accent/15"
        >
          <span>● demo ao vivo — deploy rodando agora</span>
          <span>abrir →</span>
        </a>
      )}

      {data.project.description ? (
        <p className="max-w-2xl leading-relaxed text-muted">
          {data.project.description}
        </p>
      ) : (
        <p className="border border-dashed border-line px-5 py-4 font-mono text-xs text-muted">
          {"// sem descrição — o código conta a história"}
        </p>
      )}

      {data.project.repoUrl || data.project.demoUrl ? (
        <div className="flex flex-wrap gap-3">
          {data.project.repoUrl && (
            <a
              href={data.project.repoUrl}
              target="_blank"
              rel="noopener"
              className="border border-line px-6 py-3 font-mono text-sm transition hover:border-accent/50 hover:text-accent"
            >
              repositório →
            </a>
          )}
          {data.project.demoUrl && (
            <a
              href={data.project.demoUrl}
              target="_blank"
              rel="noopener"
              className="border border-line px-6 py-3 font-mono text-sm transition hover:border-accent/50 hover:text-accent"
            >
              demo →
            </a>
          )}
        </div>
      ) : (
        <p className="font-mono text-xs text-muted">
          {"// sem links públicos cadastrados — pergunta pro time"}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          time — {data.teamName}
        </h2>
        {data.members.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {data.members.map((u) => (
              <li key={u}>
                <Link
                  href={`/u/${u}`}
                  className="block border border-line bg-surface px-3 py-1.5 font-mono text-xs transition hover:border-accent/50 hover:text-accent"
                >
                  @{u}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border border-dashed border-line px-5 py-4 font-mono text-xs text-muted">
            {
              "// membros ainda não vinculados — o organizador liga o time aos perfis pelo /admin"
            }
          </p>
        )}
      </div>

      <Link
        href={`/h/${data.hackathonId}`}
        className="w-fit font-mono text-xs text-muted transition hover:text-accent"
      >
        {"← volta pro arquivo da edição"}
      </Link>
    </section>
  );
}
