"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Audience, EditionQuestion, QuestionKind } from "@/lib/registrationForm";

const KINDS: { value: QuestionKind; label: string }[] = [
  { value: "short_text", label: "texto curto" },
  { value: "long_text", label: "texto longo" },
  { value: "single", label: "escolha única" },
  { value: "multi", label: "múltipla escolha" },
  { value: "yes_no", label: "sim/não" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<QuestionKind, string>;

const field =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] text-foreground focus:border-accent focus:outline-none";
const mini =
  "font-mono text-[12px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-40 disabled:no-underline";

type Draft = { kind: QuestionKind; label: string; options: string; required: boolean };
const empty: Draft = { kind: "short_text", label: "", options: "", required: false };
const needsOptions = (k: QuestionKind) => k === "single" || k === "multi";
const toPayload = (d: Draft) => ({
  kind: d.kind,
  label: d.label,
  required: d.required,
  options: needsOptions(d.kind) ? d.options.split("\n").map((o) => o.trim()).filter(Boolean) : [],
});

// spec 033 US1 — o organizador monta o formulário da edição: cria, edita,
// reordena e arquiva perguntas. As vagas ficam na aba configurar. Editar uma pergunta que
// já tem resposta cria versão nova (o servidor decide; a tela avisa).
export function QuestionEditor({
  hackathonId,
  questions,
  answered,
  audience = "participante",
}: {
  hackathonId: string;
  questions: EditionQuestion[];
  answered: Record<number, number>;
  audience?: Audience;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "não deu certo");
        return null;
      }
      router.refresh();
      return data ?? {};
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/admin/hackathons/${hackathonId}/questions`;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (await call(base, "POST", { ...toPayload(draft), audience })) setDraft(empty);
  }

  async function saveEdit(id: number) {
    if (await call(`${base}/${id}`, "PATCH", toPayload(editDraft))) setEditing(null);
  }

  const active = questions.filter((q) => !q.archived);
  const archived = questions.filter((q) => q.archived);

  const participant = audience === "participante";

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h2 className="text-[22px] font-extrabold tracking-[-0.02em]">Perguntas ({active.length})</h2>
        <p className="text-[14px] text-muted">
          {participant
            ? "Nome, e-mail e GitHub já vêm do perfil, não precisa perguntar. Sem perguntas extras, a inscrição pede só os termos do evento (nascimento, conduta, imagem)."
            : "Nome, e-mail e GitHub já vêm do perfil. Pergunte o que ajuda a decidir: área, disponibilidade, experiência. Sem perguntas, a candidatura é só o aceite."}
        </p>
        {active.length === 0 && (
          <p className="border-[1.5px] border-dashed border-line p-4 font-mono text-[13px] text-muted">
            nenhuma pergunta ainda
          </p>
        )}
        <ol className="flex flex-col">
          {active.map((q, i) => (
            <li key={q.id} className="flex flex-col gap-2 border-t border-line py-4" data-testid="question-row">
              {editing === q.id ? (
                <div className="flex flex-col gap-3">
                  <DraftFields draft={editDraft} onChange={setEditDraft} />
                  {(answered[q.id] ?? 0) > 0 && (
                    <p className="font-mono text-[12px] text-orange">
                      {answered[q.id]} {answered[q.id] === 1 ? "resposta" : "respostas"}: mudar texto ou opções cria a
                      versão {q.version + 1}; quem já respondeu continua vendo o texto original
                    </p>
                  )}
                  <div className="flex gap-4">
                    <button type="button" className={mini} disabled={busy} onClick={() => saveEdit(q.id)}>
                      salvar
                    </button>
                    <button type="button" className={`${mini} text-muted`} onClick={() => setEditing(null)}>
                      cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="flex items-baseline gap-2.5 text-[16px] font-bold">
                    <span className="font-mono text-[13px] font-medium text-accent">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 break-words">
                      {q.label}
                      {q.required && <span className="ml-1 text-orange">*</span>}
                    </span>
                  </p>
                  <p className="font-mono text-[12px] text-muted">
                    {KIND_LABEL[q.kind]}
                    {q.options.length > 0 && ` · ${q.options.join(" / ")}`}
                    {q.version > 1 && ` · v${q.version}`}
                    {(answered[q.id] ?? 0) > 0 && ` · ${answered[q.id]} resp.`}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <button
                      type="button"
                      className={mini}
                      onClick={() => {
                        setEditing(q.id);
                        setEditDraft({
                          kind: q.kind,
                          label: q.label,
                          options: q.options.join("\n"),
                          required: q.required,
                        });
                      }}
                    >
                      editar
                    </button>
                    <button
                      type="button"
                      className={mini}
                      disabled={busy || i === 0}
                      onClick={() => call(`${base}/${q.id}`, "PATCH", { move: "up" })}
                      aria-label={`subir ${q.label}`}
                    >
                      ↑ subir
                    </button>
                    <button
                      type="button"
                      className={mini}
                      disabled={busy || i === active.length - 1}
                      onClick={() => call(`${base}/${q.id}`, "PATCH", { move: "down" })}
                      aria-label={`descer ${q.label}`}
                    >
                      ↓ descer
                    </button>
                    <button
                      type="button"
                      className={`${mini} text-muted`}
                      disabled={busy}
                      onClick={() => call(`${base}/${q.id}`, "PATCH", { archived: true })}
                    >
                      arquivar
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      </section>

      <form onSubmit={create} className="flex flex-col gap-3 border-[1.5px] border-line bg-mint/40 p-4">
        <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">nova pergunta</h2>
        <DraftFields draft={draft} onChange={setDraft} />
        <button type="submit" disabled={busy || !draft.label.trim()} className="btn rounded-[6px] disabled:opacity-50">
          adicionar pergunta
        </button>
      </form>

      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">
            arquivadas ({archived.length}) — fora do formulário, respostas preservadas
          </h2>
          <ul className="flex flex-col">
            {archived.map((q) => (
              <li key={q.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-2.5">
                <span className="min-w-0 text-[14px] break-words text-muted">{q.label}</span>
                <button
                  type="button"
                  className={mini}
                  disabled={busy}
                  onClick={() => call(`${base}/${q.id}`, "PATCH", { archived: false })}
                >
                  restaurar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DraftFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[12px] text-muted">pergunta</span>
        <input
          className={field}
          maxLength={200}
          placeholder="ex.: Qual seu curso?"
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[12px] text-muted">tipo</span>
          <select
            className={`${field} w-auto`}
            value={draft.kind}
            onChange={(e) => onChange({ ...draft, kind: e.target.value as QuestionKind })}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            className="size-4 accent-[#047a43]"
            checked={draft.required}
            onChange={(e) => onChange({ ...draft, required: e.target.checked })}
          />
          obrigatória
        </label>
      </div>
      {needsOptions(draft.kind) && (
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[12px] text-muted">opções (uma por linha)</span>
          <textarea
            className={`${field} min-h-24`}
            placeholder={"P\nM\nG"}
            value={draft.options}
            onChange={(e) => onChange({ ...draft, options: e.target.value })}
          />
        </label>
      )}
    </>
  );
}
