"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// controles da aba entregas (spec 034): prazos/obrigatórios, reabrir com
// motivo, vídeo do palco, finalista e categorias de prêmio. Tudo via API +
// router.refresh(); o servidor é quem valida.

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-accent focus:outline-none";
const label = "font-mono text-[12px] text-muted";

function useApi(hackathonId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  async function call(path: string, method: string, body?: unknown, okText = "salvo") {
    setBusy(true);
    setError("");
    setOk("");
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
    setOk(okText);
    router.refresh();
    return data;
  }
  return { call, busy, error, ok };
}

function Feedback({ error, ok }: { error: string; ok: string }) {
  if (error) {
    return (
      <p role="alert" className="font-mono text-[13px] text-orange">
        {error}
      </p>
    );
  }
  return ok ? <p className="font-mono text-[13px] text-accent">{ok}</p> : null;
}

type Settings = {
  teamFormationDeadline: string;
  submissionOpensAt: string;
  submissionDeadline: string;
  submissionGraceMinutes: number;
  juryDeadline: string;
  requireRepo: boolean;
  requireVideo: boolean;
  requireSlides: boolean;
  requireAiUsage: boolean;
  entriesShowContent: boolean;
};

export function EntriesSettingsForm({ hackathonId, initial }: { hackathonId: string; initial: Settings }) {
  const { call, busy, error, ok } = useApi(hackathonId);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await call("entregas", "PATCH", {
      teamFormationDeadline: String(f.get("teamFormationDeadline") ?? ""),
      submissionOpensAt: String(f.get("submissionOpensAt") ?? ""),
      submissionDeadline: String(f.get("submissionDeadline") ?? ""),
      juryDeadline: String(f.get("juryDeadline") ?? ""),
      submissionGraceMinutes: Number(f.get("submissionGraceMinutes") ?? 0),
      requireRepo: f.get("requireRepo") === "on",
      requireVideo: f.get("requireVideo") === "on",
      requireSlides: f.get("requireSlides") === "on",
      requireAiUsage: f.get("requireAiUsage") === "on",
      entriesShowContent: f.get("entriesShowContent") === "on",
    });
  }

  const dates: [keyof Settings, string][] = [
    ["teamFormationDeadline", "formação de times até"],
    ["submissionOpensAt", "entrega abre em"],
    ["submissionDeadline", "prazo de entrega (trava)"],
    ["juryDeadline", "júri termina em"],
  ];
  const checks: [keyof Settings, string][] = [
    ["requireRepo", "repositório obrigatório"],
    ["requireVideo", "vídeo obrigatório"],
    ["requireSlides", "slides obrigatórios"],
    ["requireAiUsage", "declarar uso de IA obrigatório"],
    ["entriesShowContent", "depois do prazo, mostrar o conteúdo das entregas (senão só nome e status até o resultado)"],
  ];

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-[1.5px] border-line p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {dates.map(([k, l]) => (
          <label key={k} className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{l}</span>
            <input type="datetime-local" name={k} defaultValue={String(initial[k] ?? "")} className={input} />
          </label>
        ))}
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>tolerância depois do prazo (0–10 min)</span>
          <input
            type="number"
            name="submissionGraceMinutes"
            min={0}
            max={10}
            defaultValue={initial.submissionGraceMinutes}
            className={input}
          />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        {checks.map(([k, l]) => (
          <label key={k} className="flex items-start gap-2 text-[14px]">
            <input type="checkbox" name={k} defaultChecked={Boolean(initial[k])} className="mt-1" />
            <span className="min-w-0">{l}</span>
          </label>
        ))}
      </div>
      <p className="text-[13px] text-muted">
        Título, tagline, descrição, trabalho anterior e tecnologias são sempre obrigatórios. Campo vazio de data = sem
        aquele prazo. Sem prazo de entrega, todo time cadastrado vai pro júri e nada trava.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn disabled:opacity-50">
          salvar prazos
        </button>
        <Feedback error={error} ok={ok} />
      </div>
    </form>
  );
}

export function EntryRowActions({
  hackathonId,
  teamId,
  manage,
  finalist,
  stageVideoUrl,
  hasProject,
}: {
  hackathonId: string;
  teamId: number;
  manage: boolean;
  finalist: boolean;
  stageVideoUrl: string | null;
  hasProject: boolean;
}) {
  const { call, busy, error, ok } = useApi(hackathonId);
  const [open, setOpen] = useState<"" | "reabrir" | "palco">("");

  async function reopen(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const done = await call(
      `entregas/${teamId}`,
      "POST",
      { reason: f.get("reason"), minutes: Number(f.get("minutes")) },
      "reaberto",
    );
    if (done) setOpen("");
  }

  async function stage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const done = await call(`entregas/${teamId}`, "PATCH", { stageVideoUrl: String(f.get("url") ?? "") }, "vídeo do palco salvo");
    if (done) setOpen("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
        {manage && (
          <button type="button" onClick={() => setOpen(open === "reabrir" ? "" : "reabrir")} className="text-muted hover:text-accent">
            reabrir
          </button>
        )}
        {hasProject && (
          <button type="button" onClick={() => setOpen(open === "palco" ? "" : "palco")} className="text-muted hover:text-accent">
            {stageVideoUrl ? "trocar vídeo do palco" : "+ vídeo do palco"}
          </button>
        )}
        {manage && (
          <button
            type="button"
            disabled={busy}
            onClick={() => call(`entregas/${teamId}`, "PATCH", { finalist: !finalist })}
            className="text-muted hover:text-accent"
          >
            {finalist ? "tirar de finalista" : "marcar finalista"}
          </button>
        )}
        {stageVideoUrl && (
          <a href={stageVideoUrl} target="_blank" rel="noopener" className="text-accent hover:underline">
            palco ↗
          </a>
        )}
      </div>
      {open === "reabrir" && (
        <form onSubmit={reopen} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
          <input name="reason" required maxLength={500} placeholder="motivo (fica no log)" aria-label="motivo da reabertura" className={input} />
          <input name="minutes" type="number" min={5} max={1440} defaultValue={60} aria-label="minutos" className={input} />
          <button type="submit" disabled={busy} className="btn disabled:opacity-50">
            reabrir
          </button>
        </form>
      )}
      {open === "palco" && (
        <form onSubmit={stage} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input name="url" defaultValue={stageVideoUrl ?? ""} placeholder="https://youtu.be/… (vazio remove)" aria-label="vídeo do palco" className={input} />
          <button type="submit" disabled={busy} className="btn disabled:opacity-50">
            salvar
          </button>
        </form>
      )}
      <Feedback error={error} ok={ok} />
    </div>
  );
}

export function PrizeCategories({
  hackathonId,
  categories,
  challenges,
}: {
  hackathonId: string;
  categories: { id: number; name: string; kind: "geral" | "desafio"; places: number; finalistsOnly: boolean }[];
  challenges: { id: string; label: string }[];
}) {
  const { call, busy, error, ok } = useApi(hackathonId);
  const [kind, setKind] = useState<"geral" | "desafio">("geral");

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const done = await call(
      "premios",
      "POST",
      {
        kind,
        name: String(f.get("name") ?? ""),
        challengeId: kind === "desafio" ? String(f.get("challengeId") ?? "") : undefined,
        places: Number(f.get("places")),
        finalistsOnly: f.get("finalistsOnly") === "on",
      },
      "categoria criada",
    );
    if (done) form.reset();
  }

  return (
    <div className="flex flex-col gap-3">
      {categories.length > 0 && (
        <ul className="flex flex-col border-t-[1.5px] border-line">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
              <span className="min-w-0 break-words">
                <span className="font-extrabold tracking-[-0.02em]">{c.name}</span>{" "}
                <span className="font-mono text-[12px] text-muted">
                  · {c.kind} · {c.places} {c.places === 1 ? "posição" : "posições"}
                  {c.finalistsOnly ? " · só finalistas" : ""}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => call(`premios/${c.id}`, "DELETE", undefined, "categoria removida")}
                className="font-mono text-[12px] text-muted hover:text-orange"
              >
                remover
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-3 border-[1.5px] border-line p-4">
        <div className="flex flex-wrap gap-4 text-[14px]">
          {(["geral", "desafio"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              {k === "geral" ? "geral" : "desafio patrocinado"}
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {kind === "desafio" ? (
            <select name="challengeId" required aria-label="desafio" className={input}>
              <option value="">escolha o desafio</option>
              {challenges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <input name="name" required maxLength={80} placeholder="nome (ex.: Grande prêmio)" aria-label="nome da categoria" className={input} />
          )}
          <input
            key={kind}
            name="places"
            type="number"
            min={1}
            max={10}
            defaultValue={kind === "geral" ? 3 : 1}
            aria-label="posições premiadas"
            className={input}
          />
        </div>
        {kind === "desafio" && (
          <input name="name" maxLength={80} placeholder="nome (opcional — padrão: Melhor projeto — patrocinador)" aria-label="nome da categoria" className={input} />
        )}
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" name="finalistsOnly" />
          só finalistas (rodada final)
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="btn disabled:opacity-50">
            criar categoria
          </button>
          <Feedback error={error} ok={ok} />
        </div>
      </form>
    </div>
  );
}
