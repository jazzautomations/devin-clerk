"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Hackathon } from "@/lib/hackathons";

const FORMAT_LABEL: Record<Hackathon["format"], string> = {
  online: "online",
  presencial: "presencial",
  hibrido: "híbrido",
};

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
  const [isRegistered, setIsRegistered] = useState(registered);
  const [loading, setLoading] = useState(false);
  const [reward, setReward] = useState<string | null>(null);
  const starts = new Date(hackathon.startsAt);
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const closed =
    hackathon.registrationDeadline !== null &&
    new Date(hackathon.registrationDeadline) < now;

  async function toggleRegistration() {
    setLoading(true);
    try {
      const res = await fetch(`/api/hackathons/${hackathon.id}/register`, {
        method: isRegistered ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setIsRegistered(data.registered);
        if (data.registered) {
          const parts = [data.xp ? `${data.xp} xp` : null]
            .concat(data.cardSerial ? [`carta №${String(data.cardSerial).padStart(3, "0")} mintada`] : [])
            .concat(data.newBadges?.length ? [`badge nova: ${data.newBadges.join(", ")}`] : [])
            .filter(Boolean);
          setReward(parts.length ? parts.join(" · ") : null);
        } else {
          setReward(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="flex flex-col gap-4 border border-line bg-surface p-5 transition hover:border-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg font-semibold tracking-tight">
            <Link href={`/h/${hackathon.id}`} className="hover:text-accent">
              {hackathon.name}
            </Link>
          </h3>
          <p className="font-mono text-xs text-muted">
            {hackathon.organizer}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="border border-line px-2 py-1 font-mono text-[10px] tracking-widest text-muted uppercase">
            {FORMAT_LABEL[hackathon.format]}
          </span>
          {hackathon.partner && (
            <span className="border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[10px] tracking-widest text-accent uppercase">
              parceiro
            </span>
          )}
        </div>
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

      {hackathon.partner && !closed ? (
        <button
          onClick={toggleRegistration}
          disabled={loading}
          className={
            isRegistered
              ? "mt-auto border border-accent/50 bg-accent/10 px-4 py-2 font-mono text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
              : "mt-auto bg-accent px-4 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          }
        >
          {loading ? "…" : isRegistered ? "✓ inscrito — cancelar" : "inscrever-se em 1 clique"}
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
    </article>
  );
}
