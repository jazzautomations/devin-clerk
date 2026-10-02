import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import {
  getRegistrationIds,
  getRegistrationsByHackathon,
} from "@/lib/registrations";
import { RegisterButton } from "@/components/RegisterButton";
import { CollectibleCard } from "@/components/CollectibleCard";
import { getCardRarity, getCardSupply, getMemberCard } from "@/lib/xp";
import { getArchive } from "@/lib/archive";

const FORMAT_LABEL: Record<string, string> = {
  online: "online",
  presencial: "presencial",
  hibrido: "híbrido",
};

export default async function HackathonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) notFound();

  const now = new Date();
  const past = new Date(h.startsAt) <= now;
  const closed =
    h.registrationDeadline !== null &&
    new Date(h.registrationDeadline) < now;

  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  const registered =
    member !== null && getRegistrationIds(member.id).includes(h.id);
  const attendees = getRegistrationsByHackathon(h.id);
  const cardRarity = getCardRarity(h.id);
  const cardSupply = getCardSupply(h.id);
  const myCard = member ? getMemberCard(member.id, h.id) : null;
  const archive = getArchive(h.id);
  const hasArchive = archive.teams.length > 0 || archive.assets.length > 0;
  const podium = archive.teams.filter((t) => t.placement >= 1 && t.placement <= 3);
  const field = archive.teams.filter((t) => t.placement === 0);

  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {past ? "// arquivo" : "// hackathon"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {h.name}
        </h1>
        <p className="font-mono text-sm text-muted">{h.organizer}</p>
      </div>

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
          <RegisterButton hackathonId={h.id} registered={registered} />
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
                      <p className="font-mono text-xs text-foreground">
                        {t.project.title}
                      </p>
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
                        {t.project.title}
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

      {attendees.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
            inscritos ({attendees.length})
          </h2>
          <ul className="divide-y divide-line border-y border-line font-mono text-xs">
            {attendees.map((a) => (
              <li key={a.username} className="flex justify-between py-2">
                <span>@{a.username}</span>
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
    </section>
  );
}
