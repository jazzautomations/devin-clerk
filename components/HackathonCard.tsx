"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Hackathon } from "@/lib/hackathons";
import type { RegistrationStatus } from "@/lib/registrations";
import { CardArt } from "@/components/CardArt";

const FORMAT_LABEL: Record<Hackathon["format"], string> = {
  online: "online",
  presencial: "presencial",
  hibrido: "híbrido",
};

type Status = RegistrationStatus | null;

export function HackathonCard({
  hackathon,
  now,
  registered,
}: {
  hackathon: Hackathon;
  now: Date;
  registered: boolean;
}) {
  const router = useRouter();
  // spec 032 — registered (approved-only) vira status; edição curada
  // resolve pendente/rejeitado via GET register (a página radar não passa
  // o mapa de status — o card busca o próprio)
  const [status, setStatus] = useState<Status>(
    registered ? "approved" : null,
  );
  const [loading, setLoading] = useState(false);
  const [reward, setReward] = useState<string | null>(null);

  useEffect(() => {
    if (!hackathon.requiresApproval || status !== null) return;
    let alive = true;
    fetch(`/api/hackathons/${hackathon.id}/register`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.status === "string") setStatus(d.status);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hackathon.id, hackathon.requiresApproval, status]);
  const starts = new Date(hackathon.startsAt);
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const closed =
    hackathon.registrationDeadline !== null &&
    new Date(hackathon.registrationDeadline) < now;
  // spec 027 — evento na lista aberta com startsAt passado está rolando:
  // o campo data marca "em andamento" e, quando há, o fim ("até DD/MM")
  const over =
    new Date(
      hackathon.endsAt ?? hackathon.registrationDeadline ?? hackathon.startsAt,
    ) < now;
  const ongoing = !over && starts <= now;

  async function toggleRegistration() {
    setLoading(true);
    try {
      const res = await fetch(`/api/hackathons/${hackathon.id}/register`, {
        method:
          status === "approved" || status === "pending" ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const next: Status = data.status ?? null;
        setStatus(next);
        if (next === "approved") {
          const parts = [data.xp ? `${data.xp} xp` : null]
            .concat(data.cardSerial ? [`carta №${String(data.cardSerial).padStart(3, "0")} mintada`] : [])
            .concat(data.newBadges?.length ? [`badge nova: ${data.newBadges.join(", ")}`] : [])
            .filter(Boolean);
          setReward(parts.length ? parts.join(" · ") : null);
        } else if (next === "pending") {
          setReward("pedido enviado — a curadoria revisa tua presença");
        } else {
          setReward(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="card group flex flex-col overflow-hidden">
      {/* capa generativa — a arte da cartinha da edição vira a cara do card */}
      <Link
        href={`/h/${hackathon.id}`}
        className="card-cover relative block h-24"
        aria-hidden
        tabIndex={-1}
      >
        <CardArt seed={hackathon.id} className="h-full w-full" />
        <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
          <span className="border border-line bg-background/80 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted uppercase backdrop-blur-sm">
            {FORMAT_LABEL[hackathon.format]}
          </span>
          {hackathon.partner && (
            <span className="border border-accent/50 bg-background/80 px-2 py-0.5 font-mono text-[10px] tracking-widest text-accent uppercase backdrop-blur-sm">
              parceiro
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg font-semibold tracking-tight">
            <Link href={`/h/${hackathon.id}`} className="transition hover:text-accent">
              {hackathon.name}
            </Link>
          </h3>
          <p className="font-mono text-xs text-muted">
            {hackathon.organizer}
          </p>
        </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
        <div>
          <dt className="text-muted">data</dt>
          <dd className={ongoing ? "text-accent" : undefined}>
            {ongoing
              ? hackathon.endsAt
                ? `em andamento · até ${fmt.format(new Date(hackathon.endsAt))}`
                : "em andamento"
              : fmt.format(starts)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">local</dt>
          <dd>{hackathon.location ?? "Online"}</dd>
        </div>
        {hackathon.prize && (
          <div className="col-span-2">
            <dt className="sr-only">prêmio</dt>
            <dd><span className="prize-badge">{hackathon.prize}</span></dd>
          </div>
        )}
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

      {hackathon.partner && !closed ? (
        <button
          onClick={toggleRegistration}
          disabled={loading || status === "rejected"}
          className={
            status === "approved"
              ? "mt-auto border border-accent/50 bg-accent/10 px-4 py-2 font-mono text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
              : status === "pending"
                ? "mt-auto border border-accent/40 bg-surface px-4 py-2 font-mono text-xs font-semibold text-muted transition hover:text-accent disabled:opacity-50"
                : status === "rejected"
                  ? "mt-auto border border-line px-4 py-2 font-mono text-xs text-muted opacity-60"
                  : "mt-auto bg-accent px-4 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          }
        >
          {loading
            ? "…"
            : status === "approved"
              ? "✓ inscrito — cancelar"
              : status === "pending"
                ? "aguardando aprovação — desistir"
                : status === "rejected"
                  ? "não rolou dessa vez"
                  : hackathon.requiresApproval
                    ? "pedir lugar"
                    : "inscrever-se em 1 clique"}
        </button>
      ) : (
        <a
          href={hackathon.registrationUrl}
          target="_blank"
          rel="noopener"
          className={
            closed
              ? "mt-auto border border-line px-4 py-2 text-center font-mono text-xs text-muted"
              : "mt-auto border border-line px-4 py-2 text-center font-mono text-xs text-foreground transition hover:border-accent/50 hover:text-accent"
          }
        >
          {closed ? "ver evento →" : "inscrever no site oficial →"}
        </a>
      )}
      {reward && (
        <p className="font-mono text-[10px] text-accent">{"// "}{reward}</p>
      )}
      </div>
    </article>
  );
}
