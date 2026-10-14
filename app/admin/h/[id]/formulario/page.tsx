import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { getEditionCapacity } from "@/lib/registrations";
import { AUDIENCES, countCurrentAnswers, isAudience, listQuestions, type Audience } from "@/lib/registrationForm";
import { KIND_LABEL } from "@/lib/applicationKinds";
import { getOpenKinds } from "@/lib/roleApplications";
import { QuestionEditor } from "@/components/QuestionEditor";
import { EventTermsEditor } from "@/components/EventTermsEditor";
import { getEditionTerms } from "@/lib/eventTerms";

const AUDIENCE_LABEL: Record<Audience, string> = { participante: "participante", ...KIND_LABEL };

// spec 033 US1 — aba "formulário" do painel da edição (só organizador/admin).
// Frente E: seletor de público — participante (inscrição) ou um tipo de
// candidatura (voluntário/mentor/jurado), cada um com o próprio formulário.
export default async function FormularioPage({ params, searchParams }: PageProps<"/admin/h/[id]/formulario">) {
  const { id } = await params;
  const raw = (await searchParams).publico;
  const audience: Audience = isAudience(raw) ? raw : "participante";
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();
  const [questions, answered, cap, open, terms] = await Promise.all([
    listQuestions(id, { includeArchived: true, audience }),
    countCurrentAnswers(id, audience),
    getEditionCapacity(id),
    getOpenKinds(id),
    getEditionTerms(id),
  ]);
  const participant = audience === "participante";
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <nav aria-label="público do formulário" className="flex flex-col gap-2">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">formulário de</p>
        <ul className="flex flex-wrap gap-2">
          {AUDIENCES.map((a) => {
            const on = a === audience;
            const closed = a !== "participante" && !open.includes(a);
            return (
              <li key={a}>
                <Link
                  href={`/admin/h/${id}/formulario${a === "participante" ? "" : `?publico=${a}`}`}
                  aria-current={on ? "page" : undefined}
                  className={`inline-block rounded-[6px] border-[1.5px] border-line px-3 py-1.5 font-mono text-[13px] ${
                    on ? "bg-foreground text-background" : "hover:border-accent hover:text-accent"
                  }`}
                >
                  {AUDIENCE_LABEL[a]}
                  {closed && <span className={on ? "" : "text-muted"}> · fechado</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {participant ? (
          <p className="font-mono text-[13px] text-muted">
            {cap.approved} {cap.approved === 1 ? "aprovado" : "aprovados"}
            {cap.capacity !== null && ` de ${cap.capacity} vagas`}
            {cap.waitlist > 0 && ` · ${cap.waitlist} na fila`} ·{" "}
            <Link href={`/admin/h/${id}/edicao`} className="text-accent underline-offset-4 hover:underline">
              vagas em configurar →
            </Link>
          </p>
        ) : (
          <p className="font-mono text-[13px] text-muted">
            candidatura de {AUDIENCE_LABEL[audience]} · {open.includes(audience) ? "aberta" : "fechada"} na página da
            edição
          </p>
        )}
        <span className="flex flex-wrap gap-4 font-mono text-[13px]">
          <Link
            href={participant ? `/h/${id}/inscricao` : `/h/${id}/candidatura/${audience}`}
            className="text-accent underline-offset-4 hover:underline"
          >
            ver como a pessoa vê ↗
          </Link>
          <Link
            href={participant ? `/admin/h/${id}/inscritos` : `/admin/h/${id}/candidaturas`}
            className="text-accent underline-offset-4 hover:underline"
          >
            {participant ? "inscritos e respostas →" : "candidaturas →"}
          </Link>
        </span>
      </div>
      <QuestionEditor
        key={audience}
        hackathonId={id}
        questions={questions}
        answered={answered}
        audience={audience}
      />
      {participant && (
        <EventTermsEditor
          hackathonId={id}
          minAge={terms.minAge}
          dietEnabled={terms.dietEnabled}
          conductText={terms.conductText}
          conductVersion={terms.conductVersion}
        />
      )}
    </div>
  );
}
