"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// controles da organização na aba júri (spec 033 US5): rubrica com peso,
// atribuição jurado↔projeto e publicação. Tudo via API + router.refresh().

const input =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-accent focus:outline-none";

type Criterion = { id: number; label: string; weight: number };
type Judge = { memberId: number; username: string; name: string | null };
type Team = { id: number; name: string; title: string | null; members: string[] };

function useApi(hackathonId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(data?.error ?? "algo deu errado");
      return null;
    }
    router.refresh();
    return data;
  }
  return { call, busy, error };
}

function ErrorLine({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="font-mono text-[13px] text-orange">
      {error}
    </p>
  ) : null;
}

export function JuryCriteria({ hackathonId, criteria }: { hackathonId: string; criteria: Criterion[] }) {
  const { call, busy, error } = useApi(hackathonId);
  const total = criteria.reduce((a, c) => a + c.weight, 0);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await call("juri/criteria", "POST", { label: f.get("label"), weight: Number(f.get("weight")) });
    if (ok) form.reset();
  }

  return (
    <div className="flex flex-col gap-3">
      {criteria.length > 0 && (
        <ul className="flex flex-col border-t-[1.5px] border-line">
          {criteria.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2">
              <span className="min-w-0 flex-1 font-extrabold tracking-[-0.02em] break-words">{c.label}</span>
              <label className="flex items-center gap-2 font-mono text-[12px] text-muted">
                peso
                <input
                  key={`${c.id}:${c.weight}`}
                  type="number"
                  min={1}
                  max={1000}
                  defaultValue={c.weight}
                  aria-label={`peso de ${c.label}`}
                  className={`${input} w-20`}
                  onBlur={(e) => {
                    const w = Number(e.currentTarget.value);
                    if (w !== c.weight) call(`juri/criteria/${c.id}`, "PATCH", { weight: w });
                  }}
                />
              </label>
              <span className="w-12 text-right font-mono text-[12px] text-muted">
                {total > 0 ? `${Math.round((c.weight / total) * 100)}%` : ""}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Apagar "${c.label}" e as notas dele?`)) call(`juri/criteria/${c.id}`, "DELETE");
                }}
                className="font-mono text-[12px] text-muted underline-offset-4 hover:text-orange hover:underline"
              >
                apagar
              </button>
            </li>
          ))}
          <li className="flex justify-between py-2 font-mono text-[13px]">
            <span className="text-muted">total dos pesos</span>
            <span>{total}</span>
          </li>
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-[2_1_12rem] flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">critério</span>
          <input name="label" required maxLength={80} placeholder="impacto, execução, pitch…" className={input} />
        </label>
        <label className="flex w-24 flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">peso</span>
          <input name="weight" type="number" required min={1} max={1000} defaultValue={10} className={input} />
        </label>
        <button type="submit" disabled={busy} className="btn">
          adicionar
        </button>
      </form>
      <p className="font-mono text-[12px] text-muted">
        A soma é livre: cada critério pesa a fração dele no total. Mudar peso recalcula o ranking sem perder nota.
      </p>
      <ErrorLine error={error} />
    </div>
  );
}

export function JuryAssignments({
  hackathonId,
  judges,
  teams,
  assignments,
}: {
  hackathonId: string;
  judges: Judge[];
  teams: Team[];
  assignments: { judgeMemberId: number; teamId: number }[];
}) {
  const { call, busy, error } = useApi(hackathonId);
  const [summary, setSummary] = useState("");
  const assigned = new Set(assignments.map((a) => `${a.judgeMemberId}:${a.teamId}`));

  if (judges.length === 0) {
    return (
      <p className="text-muted">
        Nenhum jurado na edição. Convide na aba <span className="font-mono">equipe</span> com o papel jurado.
      </p>
    );
  }
  if (teams.length === 0) return <p className="text-muted">Nenhum time inscrito na edição ainda.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          className="btn-ghost"
          onClick={async () => {
            const r = await call("juri/assignments", "POST", { all: true });
            if (r) setSummary(`${r.created} atribuições novas${r.conflicts ? ` · ${r.conflicts} conflito(s) pulado(s)` : ""}`);
          }}
        >
          atribuir todos os jurados a todos os projetos
        </button>
        {summary && <span className="font-mono text-[12px] text-muted">{summary}</span>}
      </div>
      <ul className="flex flex-col border-t-[1.5px] border-line">
        {teams.map((t) => (
          <li key={t.id} className="flex flex-col gap-2 border-b border-line py-3">
            <p className="font-extrabold tracking-[-0.02em] break-words">
              {t.title ?? t.name}
              {t.title && t.title !== t.name && <span className="ml-2 font-mono text-[12px] font-normal text-muted">{t.name}</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {judges.map((j) => {
                const conflict = t.members.includes(j.username);
                const on = assigned.has(`${j.memberId}:${t.id}`);
                return (
                  <button
                    key={j.memberId}
                    type="button"
                    disabled={busy || conflict}
                    aria-pressed={on}
                    title={conflict ? "jurado é do time — conflito de interesse" : undefined}
                    onClick={() =>
                      call("juri/assignments", on ? "DELETE" : "POST", { judgeMemberId: j.memberId, teamId: t.id })
                    }
                    className={`rounded-[6px] border-[1.5px] px-2.5 py-1 font-mono text-[12px] ${
                      conflict
                        ? "cursor-not-allowed border-line-soft text-muted line-through"
                        : on
                          ? "border-accent bg-mint text-accent"
                          : "border-line text-foreground hover:border-accent"
                    }`}
                  >
                    {on ? "✓ " : ""}@{j.username}
                    {conflict ? " · do time" : ""}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
    </div>
  );
}

export function PublishResultsButton({
  hackathonId,
  published,
  disabled,
}: {
  hackathonId: string;
  published: boolean;
  disabled: boolean;
}) {
  const { call, busy, error } = useApi(hackathonId);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy || disabled}
        className="btn disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => {
          const msg = published
            ? "Republicar recalcula o pódio com as notas e pesos atuais. Continuar?"
            : "Publicar trava as notas e grava o pódio no arquivo da edição. Continuar?";
          if (confirm(msg)) call("juri/publish", "POST");
        }}
      >
        {published ? "republicar resultado" : "publicar resultado"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

// roadmap 037 #9 — liberação do feedback do júri pros times
export function FeedbackReleaseToggle({
  hackathonId,
  released,
  published,
}: {
  hackathonId: string;
  released: boolean;
  published: boolean;
}) {
  const { call, busy, error } = useApi(hackathonId);
  const state = released
    ? published
      ? "liberado · os times já veem"
      : "armado · os times veem quando o resultado sair"
    : "desligado · os times não veem";
  return (
    <div className="flex flex-col gap-2">
      <p className={`font-mono text-[13px] ${released ? "text-accent" : "text-muted"}`}>{state}</p>
      <div>
        <button
          type="button"
          disabled={busy}
          className={`${released ? "btn-ghost" : "btn"} disabled:cursor-not-allowed disabled:opacity-50`}
          onClick={() => call("juri/feedback", "POST", { released: !released })}
        >
          {released ? "recolher feedback" : "liberar feedback pros times"}
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
