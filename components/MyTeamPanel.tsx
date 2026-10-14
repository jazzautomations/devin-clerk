"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ArchiveTeam } from "@/lib/archive";
import type { MyInvite } from "@/lib/teamInvites";

const input =
  "w-full border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

// spec 021 — "meu time": o inscrito cria o próprio time+projeto na edição
// (o arquivo se auto-preenche) ou edita o projeto do time que já tem.
// Renderizado só quando !past && registered — o server já garante.
// Frente N #4: colega não entra direto — recebe convite e aceita/recusa
// aqui mesmo (ou pela notificação, que aponta pra cá).
export function MyTeamPanel({
  hackathonId,
  initialTeam,
  initialInvites = [],
  initialPending = [],
}: {
  hackathonId: string;
  initialTeam: ArchiveTeam | null;
  initialInvites?: MyInvite[];
  initialPending?: string[];
}) {
  const router = useRouter();
  const [team, setTeam] = useState(initialTeam);
  const [invites, setInvites] = useState(initialInvites);
  const [pending, setPending] = useState(initialPending);
  const [more, setMore] = useState("");
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
    if (data.invitedUsernames) setPending(data.invitedUsernames);
    const extras = [
      data.xp ? `${data.xp} xp` : null,
      data.invitedUsernames?.length
        ? `convite enviado: ${data.invitedUsernames.map((u: string) => `@${u}`).join(", ")} — entram quando aceitarem`
        : null,
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

  async function respond(inviteId: number, action: "accept" | "decline") {
    if (busy) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/hackathons/${hackathonId}/team/invites`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId, action }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "erro ao responder");
      return;
    }
    if (data.status === "accepted") {
      setTeam(data.team);
      setInvites([]);
      setNote("tu entrou no time");
    } else {
      setInvites((xs) => xs.filter((i) => i.id !== inviteId));
      setNote("convite recusado");
    }
    router.refresh();
  }

  async function inviteMore() {
    const usernames = more
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!usernames.length || busy) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/hackathons/${hackathonId}/team/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "erro ao convidar");
      return;
    }
    setPending(data.pending ?? pending);
    setMore("");
    setNote(
      [
        data.invited?.length ? `convite enviado: ${data.invited.map((u: string) => `@${u}`).join(", ")}` : null,
        data.ignored?.length ? `ignorados: ${data.ignored.map((u: string) => `@${u}`).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  return (
    <div data-testid="my-team" className="flex flex-col gap-3">
      {!team && invites.length > 0 && (
        <ul data-testid="team-invites" className="flex flex-col border-[1.5px] border-accent">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 border-line p-4 not-last:border-b sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-[15px]">
                {i.invitedBy ? `@${i.invitedBy}` : "um time"} te convidou pro time{" "}
                <strong className="font-extrabold">{i.teamName}</strong>
              </p>
              <span className="flex shrink-0 gap-2">
                <button type="button" disabled={busy} onClick={() => respond(i.id, "accept")} className="btn">
                  aceitar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => respond(i.id, "decline")}
                  className="font-mono text-[12px] text-muted uppercase tracking-[0.06em] hover:text-foreground"
                >
                  recusar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {team && !open && (
        <div className="flex flex-col gap-2 border border-line bg-mint p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display font-extrabold tracking-[-0.035em]">{team.name}</p>
            <span className="font-mono text-[12px] text-muted">
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
              {"sem projeto ainda — adiciona quando sair do papel"}
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
              className="font-mono text-[12px] text-muted uppercase tracking-[0.06em] transition hover:text-accent"
            >
              {team.project ? "editar projeto" : "+ adicionar projeto"}
            </button>
          </div>
          {pending.length > 0 && (
            <p data-testid="team-pending" className="font-mono text-[12px] text-muted">
              aguardando aceite: {pending.map((u) => `@${u}`).join(" ")}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              inviteMore();
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              value={more}
              onChange={(e) => setMore(e.target.value)}
              placeholder="convidar: @maria, @joao"
              aria-label="convidar colegas pro time"
              className={`${input} min-w-0 flex-1 bg-surface`}
            />
            <button type="submit" disabled={busy || !more.trim()} className="btn shrink-0">
              convidar
            </button>
          </form>
        </div>
      )}

      {!team && !open && (
        <button
          type="button"
          onClick={() => {
            setErr("");
            setOpen(true);
          }}
          className="w-fit border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent"
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
              automático; eles recebem convite e entram quando aceitarem)
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
              className="border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
            >
              {busy ? "…" : "criar time → +15xp"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[12px] text-muted uppercase tracking-[0.06em] hover:text-foreground"
            >
              cancelar
            </button>
            {err && (
              <span className="font-mono text-xs text-orange">
                {""}
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
              className="border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
            >
              {busy ? "…" : "salvar projeto →"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[12px] text-muted uppercase tracking-[0.06em] hover:text-foreground"
            >
              cancelar
            </button>
            {err && (
              <span className="font-mono text-xs text-orange">
                {""}
                {err}
              </span>
            )}
          </div>
        </form>
      )}

      {note && (
        <p className="font-mono text-xs text-accent">
          {""}
          {note}
        </p>
      )}
    </div>
  );
}
