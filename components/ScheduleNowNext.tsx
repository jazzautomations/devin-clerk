import Link from "next/link";
import {
  KIND_LABEL,
  listVisibleScheduleItems,
  nowAndNext,
  scheduleViewerFor,
  timeLabel,
  type ScheduleItem,
} from "@/lib/schedule";

// Bloco "agora / a seguir" (roadmap 037 #4). Reaproveitável: página da
// edição, página da programação, modo palco. Aparece quando tem item
// rolando ou o próximo começa em até 12h (= durante o evento); fora disso,
// com `compact`, vira uma linha "ver programação" (ou nada, sem itens).

const SOON_MS = 12 * 3_600_000;

export async function ScheduleNowNext({
  hackathonId,
  member,
  now = new Date(),
  compact = false,
  items: given,
}: {
  hackathonId: string;
  member: { id: number; role: string } | null;
  now?: Date;
  /** fora do evento mostra só o link pra programação */
  compact?: boolean;
  /** itens já filtrados pro viewer (evita buscar de novo) */
  items?: ScheduleItem[];
}) {
  const items = given ?? (await listVisibleScheduleItems(hackathonId, await scheduleViewerFor(member, hackathonId)));
  if (items.length === 0) return null;
  const nn = nowAndNext(items, now);
  const firstNext = nn.next[0];
  const live =
    nn.now.length > 0 ||
    (firstNext && new Date(`${firstNext.startsAt.replace(" ", "T")}Z`).getTime() - now.getTime() <= SOON_MS);
  const href = `/h/${hackathonId}/programacao`;

  if (!live) {
    if (!compact) return null;
    return (
      <p data-testid="schedule-link" className="flex flex-wrap items-baseline gap-x-3 border-t-2 border-line pt-4 font-mono text-[13px]">
        <span className="text-muted">programação · {items.length} {items.length === 1 ? "item" : "itens"}</span>
        <Link href={href} className="text-accent underline-offset-4 hover:underline">
          ver horários e salas →
        </Link>
      </p>
    );
  }

  const row = (i: ScheduleItem, tone: "now" | "next") => (
    <li key={i.id} className="flex min-w-0 gap-3 border-t border-[#2a5f45] py-2 first:border-t-0">
      <span className={`w-[3.2rem] flex-none font-mono text-[13px] ${tone === "now" ? "text-band" : "text-mint"}`}>
        {timeLabel(i.startsAt)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-sans text-[15px] font-bold break-words text-background">{i.title}</span>
        <span className="block font-mono text-[12px] break-words text-mint">
          {KIND_LABEL[i.kind]}
          {i.room && ` · ${i.room}`} · até {timeLabel(i.endsAt)}
        </span>
      </span>
    </li>
  );

  return (
    <section data-testid="schedule-now-next" aria-label="agora e a seguir" className="window dark hard">
      <div className="tbar">
        <span className="title">AGORA.exe</span>
        <Link href={href} className="font-mono text-[12px] underline-offset-4 hover:underline">
          programação completa →
        </Link>
      </div>
      <div className="tbody gap-4 p-4!">
        <div>
          <p className="pix text-[20px] text-band uppercase">agora</p>
          {nn.now.length > 0 ? (
            <ul data-testid="schedule-now">{nn.now.map((i) => row(i, "now"))}</ul>
          ) : (
            <p className="font-mono text-[13px] text-mint">intervalo — nada na programação neste minuto</p>
          )}
        </div>
        {nn.next.length > 0 && (
          <div>
            <p className="pix text-[20px] text-mint uppercase">a seguir</p>
            <ul data-testid="schedule-next">{nn.next.map((i) => row(i, "next"))}</ul>
          </div>
        )}
      </div>
    </section>
  );
}
