"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ArchiveTeam } from "@/lib/archive";

const input =
  "w-full border border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none";

// spec 021 — "meu time": o inscrito cria o próprio time+projeto na edição
// (o arquivo se auto-preenche) ou edita o projeto do time que já tem.
// Renderizado só quando !past && registered — o server já garante.
export function MyTeamPanel({
  hackathonId,
  initialTeam,
}: {
  hackathonId: string;
  initialTeam: ArchiveTeam | null;
}) {
  const router = useRouter();
  const [team, setTeam] = useState(initialTeam);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mates, setMates] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  function openEdit() {
    setTitle(team?.project?.title ?? "");
    setDescription(team?.project?.description ?? "");
    setRepoUrl(team?.project?.repoUrl ?? "");
    setDemoUrl(team?.project?.demoUrl ?? "");
    setVideoUrl(team?.project?.videoUrl ?? "");
    setLogoUrl(team?.project?.logoUrl ?? "");
    setErr("");
    setOpen(true);
  }

  async function handle(res: Response): Promise<boolean> {
    if (res.status === 401) {
      router.push("/sign-in");
      return false;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "erro ao salvar");
      return false;
    }
    setTeam(data.team);
    const extras = [
      data.xp ? `${data.xp} xp` : null,
      data.ignoredUsernames?.length
        ? `ignorados: ${data.ignoredUsernames.map((u: string) => `@${u}`).join(", ")}`
        : null,
      data.newBadges?.length ? `badge nova: ${data.newBadges.join(", ")}` : null,
    ].filter(Boolean);
    setNote(extras.join(" · "));
    setErr("");
    setOpen(false);
    router.refresh(); // time entra pro arquivo da edição na hora
    return true;
  }

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/hackathons/${hackathonId}/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        memberUsernames: mates
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        project: title.trim()
          ? {
              title,
              description: description || undefined,
              repoUrl: repoUrl || undefined,
              demoUrl: demoUrl || undefined,
              videoUrl: videoUrl || undefined,
              logoUrl: logoUrl || undefined,
            }
          : undefined,
      }),
    });
    await handle(res);
    setBusy(false);
  }

  async function saveProject() {
    if (!team || busy) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/hackathons/${hackathonId}/team`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: team.id,
        title: title || undefined,
        description,
        repoUrl,
        demoUrl,
        videoUrl,
        logoUrl,
      }),
    });
    await handle(res);
    setBusy(false);
  }

  return (
    <div data-testid="my-team" className="flex flex-col gap-3">
      {team && !open && (
        <div className="flex flex-col gap-2 border border-accent/40 bg-accent/5 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display font-bold tracking-tight">{team.name}</p>
            <span className="font-mono text-[10px] text-muted">
              {team.members.map((u) => `@${u}`).join(" ")}
            </span>
          </div>
          {team.project ? (
            <p className="font-mono text-xs text-muted">
              {team.project.title}
              {team.project.repoUrl && " · repo ✓"}
              {team.project.demoUrl && " · demo ✓"}
              {team.project.videoUrl && " · vídeo ✓"}
            </p>
          ) : (
            <p className="font-mono text-xs text-muted">
              {"// sem projeto ainda — adiciona quando sair do papel"}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/p/${team.id}`}
              className="font-mono text-xs text-accent hover:underline"
            >
              ficha pública /p/{team.id} →
            </Link>
            <button
              type="button"
              onClick={openEdit}
              className="font-mono text-[10px] text-muted uppercase tracking-widest transition hover:text-accent"
            >
              {team.project ? "editar projeto" : "+ adicionar projeto"}
            </button>
          </div>
        </div>
      )}

      {!team && !open && (
        <button
          type="button"
          onClick={() => {
            setErr("");
            setOpen(true);
          }}
          className="w-fit bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110"
        >
          + submeter meu time → +15xp
        </button>
      )}

      {!team && open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          className="flex flex-col gap-3 border border-line bg-surface p-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              nome do time (obrigatório — único na edição)
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="ex.: One Day Hospital"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              colegas (usernames inscritos, separados por vírgula — tu entra
              automático)
            </span>
            <input
              value={mates}
              onChange={(e) => setMates(e.target.value)}
              placeholder="@maria, @joao.dev"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              título do projeto (pode preencher depois)
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="o que vocês vão construir"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">descrição</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className={`${input} resize-none`}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-muted">repo (url)</span>
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/…"
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-muted">demo (url)</span>
              <input
                value={demoUrl}
                onChange={(e) => setDemoUrl(e.target.value)}
                placeholder="https://…"
                className={input}
              />
            </label>
          </div>
          {/* spec 030 — pitch em vídeo + logo, estilo portal Colosseum;
              ambos opcionais, validação http(s) é do servidor */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-muted">vídeo (url)</span>
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/…"
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-muted">logo (url)</span>
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://…/logo.png"
                className={input}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "…" : "criar time → +15xp"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[10px] text-muted uppercase tracking-widest hover:text-foreground"
            >
              cancelar
            </button>
            {err && (
              <span className="font-mono text-xs text-red-400">
                {"// "}
                {err}
              </span>
            )}
          </div>
        </form>
      )}

      {team && open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveProject();
          }}
          className="flex flex-col gap-3 border border-line bg-surface p-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              título do projeto
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={120}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">descrição</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className={`${input} resize-none`}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-muted">repo (url)</span>
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/…"
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-muted">demo (url)</span>
              <input
                value={demoUrl}
                onChange={(e) => setDemoUrl(e.target.value)}
                placeholder="https://…"
                className={input}
              />
            </label>
          </div>
          {/* spec 030 — mesmos campos opcionais do create; vazio limpa */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-muted">vídeo (url)</span>
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/…"
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-muted">logo (url)</span>
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://…/logo.png"
                className={input}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "…" : "salvar projeto →"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[10px] text-muted uppercase tracking-widest hover:text-foreground"
            >
              cancelar
            </button>
            {err && (
              <span className="font-mono text-xs text-red-400">
                {"// "}
                {err}
              </span>
            )}
          </div>
        </form>
      )}

      {note && (
        <p className="font-mono text-xs text-accent">
          {"// "}
          {note}
        </p>
      )}
    </div>
  );
}
