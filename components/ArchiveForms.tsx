"use client";

import { useState } from "react";

const input =
  "w-full border border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none";

// cadastro do arquivo pós-evento — spec 015. Compacto de propósito:
// SC-002 do spec 003 exige time completo em <1 minuto.
export function TeamForm({ hackathonId }: { hackathonId: string }) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [withProject, setWithProject] = useState(false);
  const [ignored, setIgnored] = useState<string[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setError("");
    setIgnored([]);
    const f = new FormData(e.currentTarget);
    const opt = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const memberUsernames = String(f.get("memberUsernames") ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    // projeto só entra se o checkbox tá marcado E tem título (API ignora sem title)
    const project =
      withProject && opt("projectTitle")
        ? {
            title: opt("projectTitle"),
            description: opt("projectDescription"),
            repoUrl: opt("repoUrl"),
            demoUrl: opt("demoUrl"),
          }
        : null;
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        placement: Number(f.get("placement") ?? 0),
        memberUsernames,
        project,
      }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        ignoredUsernames?: string[];
      } | null;
      setStatus("done");
      const missed = data?.ignoredUsernames ?? [];
      if (missed.length > 0) {
        // admin precisa ler quem ficou de fora antes da página virar
        setIgnored(missed);
        setTimeout(() => window.location.reload(), 3500);
      } else {
        window.location.reload();
      }
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "erro ao cadastrar");
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">nome do time</span>
        <input
          name="name"
          required
          className={input}
          placeholder="One Day Hospital"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">colocação</span>
        <select name="placement" defaultValue="0" className={input}>
          <option value="0">participante</option>
          <option value="1">1º lugar</option>
          <option value="2">2º lugar</option>
          <option value="3">3º lugar</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="font-mono text-xs text-muted">
          membros (usernames separados por vírgula, opcional)
        </span>
        <input
          name="memberUsernames"
          className={input}
          placeholder="devana, jp_dev, mari.codes"
        />
      </label>
      <label className="flex items-center gap-2 font-mono text-xs text-muted sm:col-span-2">
        <input
          type="checkbox"
          checked={withProject}
          onChange={(ev) => setWithProject(ev.target.checked)}
          className="accent-(--color-accent)"
        />
        + projeto (o que o time entregou)
      </label>
      {withProject && (
        <fieldset className="grid gap-3 border border-dashed border-line p-4 sm:col-span-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              título do projeto
            </span>
            <input
              name="projectTitle"
              required
              className={input}
              placeholder="One Day Hospital"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              descrição (opcional)
            </span>
            <input
              name="projectDescription"
              className={input}
              placeholder="triage hospitalar por IA"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              repo (opcional)
            </span>
            <input
              name="repoUrl"
              className={input}
              placeholder="https://github.com/time/projeto"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              demo (opcional)
            </span>
            <input
              name="demoUrl"
              className={input}
              placeholder="https://projeto.vercel.app"
            />
          </label>
        </fieldset>
      )}
      <div className="flex items-end sm:col-span-2">
        <button
          type="submit"
          disabled={status === "saving"}
          className="bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "saving" ? "cadastrando…" : "cadastrar time →"}
        </button>
        {status === "error" && (
          <span className="ml-4 font-mono text-xs text-red-400">
            {"// "}
            {error}
          </span>
        )}
        {ignored.length > 0 && (
          <span className="ml-4 font-mono text-xs text-lendario">
            {"// time salvo — usernames ignorados (não existem): "}
            {ignored.join(", ")}
          </span>
        )}
      </div>
    </form>
  );
}

// fotos/slides/materiais da edição — URLs externas (decisão do spec 003)
export function AssetForm({ hackathonId }: { hackathonId: string }) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setError("");
    const f = new FormData(e.currentTarget);
    const opt = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: f.get("type"),
        url: f.get("url"),
        caption: opt("caption"),
      }),
    });
    if (res.ok) {
      setStatus("done");
      window.location.reload();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "erro ao salvar");
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-3"
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">tipo</span>
        <select name="type" defaultValue="foto" className={input}>
          <option value="foto">foto</option>
          <option value="slide">slide</option>
          <option value="material">material</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">url</span>
        <input
          name="url"
          required
          className={input}
          placeholder="https://imgur.com/…"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          legenda (opcional)
        </span>
        <input name="caption" className={input} placeholder="final no palco" />
      </label>
      <div className="flex items-end sm:col-span-3">
        <button
          type="submit"
          disabled={status === "saving"}
          className="bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "saving" ? "salvando…" : "adicionar material →"}
        </button>
        {status === "error" && (
          <span className="ml-4 font-mono text-xs text-red-400">
            {"// "}
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
