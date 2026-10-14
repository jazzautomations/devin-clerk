"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  APPLICATION_KINDS,
  KIND_LABEL,
  type ApplicationKind,
  type ApplicationStatus,
} from "@/lib/applicationKinds";

type Row = {
  id: number;
  username: string;
  name: string | null;
  email: string;
  kind: ApplicationKind;
  status: ApplicationStatus;
  note: string | null;
  when: string;
  reviewedBy: string | null;
  answers: { questionId: number; label: string; value: string }[];
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "pendente",
  approved: "aprovada",
  rejected: "recusada",
};

const STATUS_CLASS: Record<ApplicationStatus, string> = {
  pending: "border-orange text-orange",
  approved: "border-accent bg-mint text-accent",
  rejected: "border-line text-muted",
};

const ROLE_HINT: Record<ApplicationKind, string> = {
  voluntario: "vira staff",
  mentor: "vira mentor",
  jurado: "vira jurado",
};

// valor de exibição: multi (JSON) vira "a; b"
function show(value: string): string {
  if (value.startsWith("[")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) return arr.join("; ");
    } catch {
      // não era JSON: mostra cru
    }
  }
  return value;
}

// frente E — painel de candidaturas do organizador: abre/fecha cada tipo,
// filtra, lê respostas e decide. Decisão é final (tirar papel é na aba equipe).
export function ApplicationsBoard({
  hackathonId,
  applications,
  open,
}: {
  hackathonId: string;
  applications: Row[];
  open: ApplicationKind[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<ApplicationKind | "todos">("todos");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(typeof data?.error === "string" ? data.error : "não deu certo");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/admin/hackathons/${hackathonId}/applications`;
  const count = (k: ApplicationKind, st?: ApplicationStatus) =>
    applications.filter((a) => a.kind === k && (!st || a.status === st)).length;
  const shown = filter === "todos" ? applications : applications.filter((a) => a.kind === filter);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">tipos abertos na página da edição</h2>
        <ul className="grid gap-2 sm:grid-cols-3">
          {APPLICATION_KINDS.map((k) => {
            const on = open.includes(k);
            return (
              <li key={k} className="flex items-center justify-between gap-3 border-[1.5px] border-line p-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold first-letter:uppercase">{KIND_LABEL[k]}</p>
                  <p className="font-mono text-[12px] text-muted">
                    {on ? "aberto" : "fechado"} · {count(k, "pending")} pend.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => call(base, "PUT", { kind: k, open: !on })}
                  aria-label={`${on ? "fechar" : "abrir"} candidaturas de ${KIND_LABEL[k]}`}
                  className={`shrink-0 rounded-[6px] border-[1.5px] px-3 py-1.5 font-mono text-[12px] font-semibold disabled:opacity-50 ${
                    on ? "border-line text-foreground hover:border-orange hover:text-orange" : "border-accent bg-accent text-background"
                  }`}
                >
                  {on ? "fechar" : "abrir"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="filtrar por tipo">
          {(["todos", ...APPLICATION_KINDS] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={`rounded-[6px] border-[1.5px] px-3 py-1.5 font-mono text-[12px] ${
                filter === k ? "border-line bg-foreground text-background" : "border-line"
              }`}
            >
              {k === "todos" ? `todos (${applications.length})` : `${KIND_LABEL[k]} (${count(k)})`}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="border-[1.5px] border-dashed border-line p-4 font-mono text-[13px] text-muted">
            nenhuma candidatura {filter === "todos" ? "ainda" : `de ${KIND_LABEL[filter]}`}
          </p>
        ) : (
          <ol className="flex flex-col">
            {shown.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 border-t border-line py-5" data-testid="application-row">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0 text-[16px] font-bold break-words">
                    {a.name ?? a.username}{" "}
                    <span className="font-mono text-[13px] font-normal text-muted">@{a.username}</span>
                  </p>
                  <span className="flex items-center gap-2 font-mono text-[12px]">
                    <span className="text-muted">{KIND_LABEL[a.kind]}</span>
                    <span className={`border px-1.5 py-0.5 ${STATUS_CLASS[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                  </span>
                </div>
                <p className="font-mono text-[12px] break-all text-muted">
                  {a.email} · {a.when}
                  {a.reviewedBy && ` · decidida por @${a.reviewedBy}`}
                </p>
                {a.answers.length > 0 && (
                  <dl className="flex flex-col gap-2 border-l-2 border-line pl-3 text-[14px]">
                    {a.answers.map((ans) => (
                      <div key={ans.questionId} className="min-w-0">
                        <dt className="text-muted">{ans.label}</dt>
                        <dd className="font-semibold break-words whitespace-pre-line">{show(ans.value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {a.note && <p className="text-[13px] text-muted">nota: {a.note}</p>}
                {a.status === "pending" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => call(`${base}/${a.id}`, "PATCH", { action: "approve" })}
                      className="btn rounded-[6px] disabled:opacity-50"
                    >
                      aprovar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => call(`${base}/${a.id}`, "PATCH", { action: "reject" })}
                      className="rounded-[6px] border-[1.5px] border-line px-4 py-2 font-mono text-[13px] hover:border-orange hover:text-orange disabled:opacity-50"
                    >
                      recusar
                    </button>
                    <span className="font-mono text-[12px] text-muted">aprovar {ROLE_HINT[a.kind]} na hora</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
