import Link from "next/link";
import { parseEventTime } from "@/lib/eventTime";

// Linha da lista de edições do /admin (admin global). Server component: só
// contadores (um SELECT na página) e dois links, o painel da edição e o
// detalhe de catálogo (?h=), que carrega desafios, quadro e arquivo só dela.

export const RADAR_PAGE = 30;

export type AdminEdition = {
  id: string;
  name: string;
  organizer: string;
  startsAt: string;
  endsAt: string | null;
  format: string;
  location: string | null;
  registrationUrl: string;
  registrationDeadline: string | null;
  tags: string;
  active: number;
  requiresApproval: number;
  inscritos: number;
  pendentes: number;
  scheduleItems: number;
  ours: boolean;
};

const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

export function EditionList({
  events,
  openId,
  q,
  empty,
}: {
  events: AdminEdition[];
  openId: string;
  q: string;
  empty: string;
}) {
  if (events.length === 0) {
    return <p className="border-[1.5px] border-dashed border-line p-4 font-mono text-xs text-muted">{empty}</p>;
  }
  const detailHref = (id: string) => `/admin?${new URLSearchParams({ ...(q ? { q } : {}), h: id })}#edicao-aberta`;
  return (
    <ul className="divide-y divide-line border-y border-line" data-testid="admin-editions">
      {events.map((e) => {
        const start = parseEventTime(e.startsAt);
        return (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 font-mono text-xs">
            <span className="flex min-w-0 flex-col">
              <span className={`truncate ${e.id === openId ? "font-bold" : ""}`}>{e.name}</span>
              <span className="truncate text-muted">
                {e.organizer} · {start ? dateFmt.format(start) : "sem data"} ·{" "}
                {e.active ? "no ar" : "rascunho ou arquivada"} · {e.inscritos} inscritos
                {e.pendentes > 0 && <span className="text-lendario"> · {e.pendentes} pendentes</span>}
              </span>
            </span>
            <span className="flex shrink-0 gap-4">
              <Link
                href={`/admin/h/${e.id}`}
                className="inline-flex min-h-11 items-center text-accent underline-offset-4 hover:underline"
              >
                painel →
              </Link>
              <Link
                href={detailHref(e.id)}
                aria-current={e.id === openId ? "true" : undefined}
                className="inline-flex min-h-11 items-center text-muted underline-offset-4 hover:text-accent hover:underline"
              >
                detalhes
              </Link>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
