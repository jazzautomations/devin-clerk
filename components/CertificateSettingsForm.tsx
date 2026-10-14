"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// configuração do certificado (roadmap 037 #2): horas por papel (vazio =
// default pela duração da edição), presença mínima, instituição promotora e
// qual pergunta do formulário é curso/instituição/matrícula pro CSV.

type Role = "participante" | "staff" | "mentor" | "jurado" | "organizador";

const input =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-accent focus:outline-none";
const lbl = "font-mono text-[11px] tracking-widest text-muted uppercase";

export function CertificateSettingsForm({
  hackathonId,
  roles,
  defaultHours,
  initial,
  institutionDefault,
  questions,
  detected,
}: {
  hackathonId: string;
  roles: { role: Role; label: string }[];
  defaultHours: number;
  initial: {
    hours: Record<Role, number | null>;
    requireLockedEntry: boolean;
    institution: string | null;
    courseQuestionId: number | null;
    institutionQuestionId: number | null;
    enrollmentQuestionId: number | null;
  };
  institutionDefault: string;
  questions: { id: number; label: string }[];
  /** o que vale hoje (apontado ou achado pelo texto da pergunta) */
  detected: { course: number | null; institution: number | null; enrollment: number | null };
}) {
  const router = useRouter();
  const [hours, setHours] = useState<Record<Role, string>>(
    Object.fromEntries(roles.map((r) => [r.role, initial.hours[r.role]?.toString() ?? ""])) as Record<Role, string>,
  );
  const [requireLocked, setRequireLocked] = useState(initial.requireLockedEntry);
  const [institution, setInstitution] = useState(initial.institution ?? "");
  const [map, setMap] = useState({
    courseQuestionId: initial.courseQuestionId?.toString() ?? "",
    institutionQuestionId: initial.institutionQuestionId?.toString() ?? "",
    enrollmentQuestionId: initial.enrollmentQuestionId?.toString() ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    setError("");
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/certificados/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hours: Object.fromEntries(roles.map((r) => [r.role, hours[r.role] === "" ? null : Number(hours[r.role])])),
        requireLockedEntry: requireLocked,
        institution,
        courseQuestionId: map.courseQuestionId || null,
        institutionQuestionId: map.institutionQuestionId || null,
        enrollmentQuestionId: map.enrollmentQuestionId || null,
      }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(data?.error ?? "não deu pra salvar");
      return;
    }
    setMsg("salvo · vale pros próximos certificados emitidos");
    router.refresh();
  }

  const qName = (id: number | null) => questions.find((q) => q.id === id)?.label ?? "nenhuma";
  const mapFields: { key: keyof typeof map; label: string; auto: number | null }[] = [
    { key: "courseQuestionId", label: "curso", auto: detected.course },
    { key: "institutionQuestionId", label: "instituição do aluno", auto: detected.institution },
    { key: "enrollmentQuestionId", label: "matrícula / RA", auto: detected.enrollment },
  ];

  return (
    <form onSubmit={save} className="flex flex-col gap-6 border-[1.5px] border-line p-4 sm:p-5">
      <fieldset className="flex flex-col gap-3">
        <legend className={`${lbl} mb-2`}>carga horária por papel</legend>
        <p className="text-[14px] text-muted">
          Vazio = duração da edição ({defaultHours} h). Certificado já emitido não muda: as horas ficam congeladas
          na emissão.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          {roles.map((r) => (
            <label key={r.role} className="flex flex-col gap-1">
              <span className="font-mono text-[12px] break-words">{r.label}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                step={1}
                placeholder={`${defaultHours}`}
                aria-label={`horas de ${r.label}`}
                value={hours[r.role]}
                onChange={(e) => setHours((h) => ({ ...h, [r.role]: e.target.value }))}
                className={input}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${lbl} mb-2`}>presença mínima do participante</legend>
        <p className="text-[14px] text-muted">Check-in é sempre obrigatório.</p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={requireLocked}
            onChange={(e) => setRequireLocked(e.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
          />
          <span>exigir também entrega do time enviada até a trava</span>
        </label>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className={lbl}>instituição promotora no certificado</span>
        <input
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          maxLength={160}
          placeholder={`vazio = ${institutionDefault}`}
          className={input}
        />
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className={`${lbl} mb-2`}>csv de hora complementar · perguntas do formulário</legend>
        <p className="text-[14px] text-muted">
          O formulário de inscrição é livre, então aponte qual pergunta é o curso, a instituição e a matrícula. Sem
          apontar, o sistema usa a primeira pergunta cujo texto fala de “curso”, “instituição/faculdade/universidade”
          e “matrícula/RA”. Sem pergunta nenhuma, a coluna sai vazia — crie a pergunta na aba formulário.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {mapFields.map((f) => (
            <label key={f.key} className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[12px]">{f.label}</span>
              <select
                value={map[f.key]}
                onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value }))}
                className={input}
              >
                <option value="">automático · {qName(f.auto)}</option>
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "salvando…" : "salvar configuração"}
        </button>
        {msg && <span className="font-mono text-[12px] text-accent">{msg}</span>}
        {error && (
          <span role="alert" className="font-mono text-[12px] text-orange">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
