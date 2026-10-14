import { notFound } from "next/navigation";
import { BADGE_ROLES, listBadges, PER_SHEET, ROLE_COLOR, ROLE_LABEL, SHEET } from "@/lib/crachas";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";

// Crachás em lote (roadmap 037 #5, 035 #7): organizador baixa o PDF na
// véspera e imprime em folha de etiqueta. Form GET puro — sem JS.
export default async function EditionBadgesPage({ params }: PageProps<"/admin/h/[id]/crachas">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canManageEdition(member, id))) notFound();
  const all = await listBadges(id);
  const byRole = BADGE_ROLES.map((r) => ({ role: r, n: all.filter((b) => b.role === r).length }));
  const withQr = all.filter((b) => b.token).length;
  const sheets = Math.ceil(all.length / PER_SHEET);
  const api = `/api/admin/hackathons/${id}/crachas`;

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">
        Crachás
      </h2>
      <p className="max-w-2xl text-[15px] text-muted">
        PDF A4 para folha de etiqueta <strong className="text-foreground">{SHEET.name}</strong>. Nome, papel pela
        cor da faixa, time e o QR do ingresso (quem tem inscrição aprovada) — em ordem alfabética. Imprima em
        escala 100% (&quot;tamanho real&quot;), sem ajustar à página.
      </p>

      <dl className="grid grid-cols-3 border-[1.5px] border-line" data-testid="badge-counts">
        {[
          ["crachás", all.length],
          ["com QR", withQr],
          ["folhas", sheets],
        ].map(([label, n]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1 border-line p-3 not-last:border-r-[1.5px] sm:p-5">
            <dt className="truncate font-mono text-[11px] tracking-widest text-muted uppercase sm:text-[12px]">{label}</dt>
            <dd className="pix text-3xl sm:text-4xl">{n}</dd>
          </div>
        ))}
      </dl>

      <ul className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[13px]">
        {byRole.map(({ role, n }) => (
          <li key={role} className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-3" style={{ background: ROLE_COLOR[role] }} />
            {ROLE_LABEL[role]} · {n}
          </li>
        ))}
      </ul>

      <form method="get" action={api} className="flex flex-col gap-4 border-[1.5px] border-line p-4 sm:p-5">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[12px] tracking-widest text-muted uppercase">papel</span>
          <select
            name="papel"
            defaultValue="todos"
            className="w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 font-mono text-sm sm:max-w-xs"
          >
            <option value="todos">todos</option>
            {BADGE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" name="guias" value="1" className="mt-1" />
          <span>desenhar o contorno das etiquetas (teste de alinhamento em papel comum)</span>
        </label>
        <div>
          <button type="submit" className="btn rounded-[6px]">
            baixar PDF
          </button>
        </div>
      </form>
    </section>
  );
}
