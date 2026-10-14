import Link from "next/link";
import {
  RARITY_BORDER,
  RARITY_LABEL,
  RARITY_TEXT,
  type Rarity,
} from "@/lib/game";
import { CardArt } from "./CardArt";

export function CollectibleCard({
  hackathonId,
  name,
  startsAt,
  location,
  rarity,
  serial,
  supply,
}: {
  hackathonId: string;
  name: string;
  startsAt: string;
  location: string | null;
  rarity: Rarity;
  serial?: number;
  supply?: number;
}) {
  const date = new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "numeric",
  }).format(new Date(startsAt));

  return (
    <Link
      href={`/h/${hackathonId}`}
      className={`holo group flex flex-col border-2 ${RARITY_BORDER[rarity]} bg-surface transition hover:-translate-y-0.5`}
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2 font-mono text-[12px] tracking-[0.06em] uppercase">
        <span className={RARITY_TEXT[rarity]}>{RARITY_LABEL[rarity]}</span>
        {serial !== undefined && (
          <span className="text-muted">№ {String(serial).padStart(3, "0")}</span>
        )}
        {serial === undefined && supply !== undefined && (
          <span className="text-muted">{supply} mintadas</span>
        )}
      </div>

      <CardArt seed={hackathonId} className="aspect-[4/3] w-full" />

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="font-display text-sm font-extrabold leading-tight tracking-[-0.035em] transition group-hover:text-accent">
          {name}
        </p>
        <p className="font-mono text-[12px] text-muted">
          {date} · {location ?? "online"}
        </p>
      </div>

      <div className="border-t border-line px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] text-muted uppercase">
        hackahub · prova de presença
      </div>
    </Link>
  );
}
