"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Hackathon } from "@/lib/hackathons";
import type { RegistrationStatus } from "@/lib/registrations";
import { CardArt } from "@/components/CardArt";
import { BADGES } from "@/lib/game";
import { cleanTags } from "@/lib/radarTags";
import { BRAZIL_LABEL, prizeBrlApprox, radarBadges } from "@/lib/radar";

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
    // pendente (curada) e fila de espera (spec 033) só aparecem pelo GET
    if (!hackathon.partner || status !== null) return;
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
  }, [hackathon.id, hackathon.partner, status]);
  const starts = new Date(hackathon.startsAt);
  const badges = radarBadges(hackathon, now);
  const brl = prizeBrlApprox(hackathon);
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
    // spec 033 — inscrever exige o aceite LGPD (e as perguntas da edição,
    // quando há): o card leva pra página de inscrição; cancelar segue aqui
    if (status !== "approved" && status !== "pending" && status !== "waitlist") {
      router.push(`/h/${hackathon.id}/inscricao`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/hackathons/${hackathon.id}/register`, {
        method: "DELETE",
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
            .concat(
              data.newBadges?.length
                ? [`conquista nova: ${(data.newBadges as string[]).map((b) => BADGES[b]?.name ?? b).join(", ")}`]
                : [],
            )
            .filter(Boolean);
          setReward(parts.length ? parts.join(" · ") : null);
        } else if (next === "pending") {
          setReward("pedido enviado. A organização avalia sua inscrição.");
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
          <span className="border-[1.5px] border-line bg-background px-2 py-0.5 font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
            {FORMAT_LABEL[hackathon.format]}
          </span>
          {hackathon.partner && (
            <span className="border-[1.5px] border-accent bg-background px-2 py-0.5 font-mono text-[12px] tracking-[0.06em] text-accent uppercase">
              parceiro
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg font-extrabold tracking-[-0.035em]">
            <Link href={`/h/${hackathon.id}`} className="transition hover:text-accent">
              {hackathon.name}
            </Link>
          </h3>
          <p className="font-mono text-xs text-muted">
            {hackathon.organizer}
          </p>
        </div>

        {/* selos do radar: formato · alcance, se brasileiro pode e o prazo */}
        <div className="flex flex-wrap gap-1.5 font-mono text-[12px]" data-testid="radar-selos">
          <span className="border-[1.5px] border-line px-2 py-0.5">{badges.where}</span>
          {badges.brazil && (
            <span
              className={
                badges.brazil === "sim"
                  ? "border-[1.5px] border-accent bg-mint px-2 py-0.5 text-accent"
                  : "border-[1.5px] border-[#ba3919] px-2 py-0.5 text-[#ba3919]"
              }
            >
              {BRAZIL_LABEL[badges.brazil]}
            </span>
          )}
          {badges.closing && (
            <span className="border-[1.5px] border-foreground bg-foreground px-2 py-0.5 text-band">{badges.closing}</span>
          )}
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
            <dd className="flex flex-wrap items-baseline gap-2">
              <span className="prize-badge text-lendario">{badges.prize}</span>
              {brl && <span className="text-muted">{brl}</span>}
            </dd>
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
        {cleanTags(hackathon.tags).map((tag) => (
          <span
            key={tag}
            className="border-[1.5px] border-line px-2 py-0.5 font-mono text-[12px] text-muted"
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
              ? "mt-auto border-[1.5px] border-accent bg-mint px-4 py-2 font-mono text-xs font-semibold text-accent transition hover:bg-[#c3ebd5] disabled:opacity-50"
              : status === "pending" || status === "waitlist"
                ? "mt-auto border-[1.5px] border-accent bg-surface px-4 py-2 font-mono text-xs font-semibold text-muted transition hover:text-accent disabled:opacity-50"
                : status === "rejected"
                  ? "mt-auto border-[1.5px] border-line px-4 py-2 font-mono text-xs text-muted opacity-60"
                  : "mt-auto bg-foreground px-4 py-2 font-mono text-xs font-semibold text-background transition hover:bg-accent disabled:opacity-50"
          }
        >
          {loading
            ? "…"
            : status === "approved"
              ? "✓ inscrito — cancelar"
              : status === "pending"
                ? "aguardando aprovação — desistir"
                : status === "waitlist"
                  ? "na fila de espera — sair"
                : status === "rejected"
                  ? "não rolou dessa vez"
                  : hackathon.requiresApproval
                    ? "pedir lugar"
                    : "inscrever-se"}
        </button>
      ) : (
        <a
          href={hackathon.registrationUrl}
          target="_blank"
          rel="noopener"
          className={
            closed
              ? "mt-auto border-[1.5px] border-line px-4 py-2 text-center font-mono text-xs text-muted"
              : "mt-auto border-[1.5px] border-line px-4 py-2 text-center font-mono text-xs text-foreground transition hover:bg-mint hover:text-accent"
          }
        >
          {closed ? "ver evento →" : "inscrever no site oficial →"}
        </a>
      )}
      {reward && (
        <p className="font-mono text-[12px] text-accent">{""}{reward}</p>
      )}
      </div>
    </article>
  );
}
