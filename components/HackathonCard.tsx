import type { Hackathon } from "@/lib/hackathons";

const FORMAT_LABEL: Record<Hackathon["format"], string> = {
  online: "online",
  presencial: "presencial",
  hibrido: "híbrido",
};

export function HackathonCard({
  hackathon,
  now,
}: {
  hackathon: Hackathon;
  now: Date;
}) {
  const starts = new Date(hackathon.startsAt);
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const closed =
    hackathon.registrationDeadline !== null &&
    new Date(hackathon.registrationDeadline) < now;

  return (
    <article className="flex flex-col gap-4 border border-line bg-surface p-5 transition hover:border-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg font-semibold tracking-tight">
            {hackathon.name}
          </h3>
          <p className="font-mono text-xs text-muted">
            {hackathon.organizer}
          </p>
        </div>
        <span className="shrink-0 border border-line px-2 py-1 font-mono text-[10px] tracking-widest text-muted uppercase">
          {FORMAT_LABEL[hackathon.format]}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
        <div>
          <dt className="text-muted">data</dt>
          <dd>{fmt.format(starts)}</dd>
        </div>
        <div>
          <dt className="text-muted">local</dt>
          <dd>{hackathon.location ?? "Online"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">inscrições</dt>
          <dd className={closed ? "text-muted" : "text-accent"}>
            {closed
              ? "encerradas"
              : hackathon.registrationDeadline
                ? `até ${fmt.format(new Date(hackathon.registrationDeadline))}`
                : "abertas"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {hackathon.tags.map((tag) => (
          <span
            key={tag}
            className="border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
          >
            #{tag}
          </span>
        ))}
      </div>

      <a
        href={hackathon.registrationUrl}
        target="_blank"
        rel="noopener"
        className={
          closed
            ? "mt-auto border border-line px-4 py-2 text-center font-mono text-xs text-muted"
            : "mt-auto bg-accent px-4 py-2 text-center font-mono text-xs font-semibold text-black transition hover:brightness-110"
        }
      >
        {closed ? "ver evento →" : "inscrever-se →"}
      </a>
    </article>
  );
}
