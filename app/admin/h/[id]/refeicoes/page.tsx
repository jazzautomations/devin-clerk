import Link from "next/link";
import { notFound } from "next/navigation";
import { hasEditionRole } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { DIET_OPTIONS, getEditionTerms, mealReport } from "@/lib/eventTerms";
import { PrintButton } from "@/components/PrintButton";

// Refeições e alergias (roadmap 037 #6, pesquisa 035 item 8): contagem por
// restrição só dos aprovados (ou só de quem fez check-in) e a lista de
// alergias com as graves primeiro. CSV e impressão pro buffet.
export default async function RefeicoesPage({ params, searchParams }: PageProps<"/admin/h/[id]/refeicoes">) {
  const { id } = await params;
  const presentes = (await searchParams).presentes === "1";
  const member = await currentMember();
  if (!member || !(await hasEditionRole(member, id, "staff"))) notFound();
  const [terms, report] = await Promise.all([getEditionTerms(id), mealReport(id, { checkedInOnly: presentes })]);
  const csv = `/api/admin/hackathons/${id}/refeicoes?format=csv${presentes ? "&presentes=1" : ""}`;
  const severe = report.allergies.filter((a) => a.severe);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">
          Refeições
        </h2>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a href={csv} className="btn rounded-[6px]">
            baixar csv ↓
          </a>
          <PrintButton />
        </div>
      </div>

      {!terms.dietEnabled && (
        <p className="border-[1.5px] border-dashed border-line p-4 text-[14px] text-muted print:hidden" data-testid="diet-off">
          A pergunta de restrição alimentar está desligada nesta edição.{" "}
          <Link href={`/admin/h/${id}/formulario`} className="text-accent underline">
            ligar no formulário
          </Link>
        </p>
      )}

      <nav aria-label="quem conta" className="flex flex-wrap gap-2 font-mono text-[13px] print:hidden">
        {[
          { on: !presentes, href: `/admin/h/${id}/refeicoes`, label: "todos os aprovados" },
          { on: presentes, href: `/admin/h/${id}/refeicoes?presentes=1`, label: "só com check-in" },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.href}
            aria-current={t.on ? "page" : undefined}
            className={`rounded-[6px] border-[1.5px] border-line px-3 py-1.5 ${t.on ? "bg-foreground text-background" : "hover:border-accent hover:text-accent"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <p className="font-mono text-[13px] text-muted">
        {presentes ? "contando quem fez check-in" : "contando inscrições aprovadas"} · {report.total}{" "}
        {report.total === 1 ? "pessoa" : "pessoas"}
      </p>

      <dl className="grid grid-cols-2 border-[1.5px] border-line sm:grid-cols-5" data-testid="meal-counts">
        {[["sem restrição", report.semRestricao] as const, ...DIET_OPTIONS.map((o) => [o, report.counts[o]] as const)].map(
          ([label, n]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1 border-b-[1.5px] border-line p-3 sm:border-r-[1.5px] sm:border-b-0 sm:p-4">
              <dt className="truncate font-mono text-[11px] tracking-widest text-muted uppercase">{label}</dt>
              <dd className="pix text-3xl sm:text-4xl">{n}</dd>
            </div>
          ),
        )}
      </dl>

      <div className="flex flex-col gap-3">
        <h3 className="text-[18px] font-bold">
          Alergias e intolerâncias
          {severe.length > 0 && (
            <span className="ml-2 font-mono text-[13px] font-normal text-orange">{severe.length} grave(s)</span>
          )}
        </h3>
        {report.allergies.length === 0 ? (
          <p className="font-mono text-[13px] text-muted">ninguém informou alergia.</p>
        ) : (
          <ul className="border-b border-line" data-testid="allergy-list">
            {report.allergies.map((a) => (
              <li key={a.username} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line py-2.5">
                {a.severe && (
                  <span className="shrink-0 border border-orange px-1.5 font-mono text-[11px] text-orange uppercase">grave</span>
                )}
                <span className="min-w-0 font-semibold break-words">{a.name}</span>
                <span className="min-w-0 break-words">{a.text}</span>
                {!presentes && a.checkedIn && <span className="font-mono text-[11px] text-muted">check-in feito</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
