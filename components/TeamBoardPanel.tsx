"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { levelFor } from "@/lib/game";
import type { BoardCard } from "@/lib/teamboard";

const input =
  "w-full border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

// board "procuro time" da edição — leitura pública; inscrito (canPost)
// anuncia/desativa o próprio. Lista vem do server e refaz fetch após mutação.
// A nota de cada anúncio só chega pra quem tem inscrição aprovada (o GET
// com sessão traz; a lista da página não traz), então o inscrito busca de
// novo ao abrir.
export function TeamBoardPanel({
  hackathonId,
  canPost,
  myUsername,
  initialEntries,
}: {
  hackathonId: string;
  canPost: boolean;
  myUsername: string | null;
  initialEntries: BoardCard[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState("");
  const [need, setNeed] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const mine =
    canPost && myUsername
      ? entries.find((e) => e.username === myUsername)
      : undefined;

  async function refresh() {
    const res = await fetch(`/api/hackathons/${hackathonId}/team-board`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries);
    }
  }

  useEffect(() => {
    if (!canPost) return;
    let live = true;
    fetch(`/api/hackathons/${hackathonId}/team-board`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (live && data?.entries) setEntries(data.entries);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canPost, hackathonId]);

  function openForm(prefill?: BoardCard) {
    setSkills(prefill?.skills.join(", ") ?? "");
    setNeed(prefill?.need ?? "");
    setNote(prefill?.note ?? "");
    setErr("");
    setOpen(true);
  }

  async function submit() {
    if (!need.trim() || busy) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/hackathons/${hackathonId}/team-board`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skills: skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        need,
        note: note.trim() || undefined,
      }),
    });
    if (res.status === 401) {
      router.push("/sign-in");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(typeof data?.error === "string" ? data.error : "não deu pra anunciar. Tente de novo.");
      setBusy(false);
      return;
    }
    await refresh();
    setOpen(false);
    setBusy(false);
  }

  async function deactivate() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/hackathons/${hackathonId}/team-board`, {
      method: "DELETE",
    });
    if (res.status === 401) {
      router.push("/sign-in");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(typeof data?.error === "string" ? data.error : "não deu pra desativar. Tente de novo.");
      setBusy(false);
      return;
    }
    await refresh();
    setOpen(false);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 ? (
        <p className="border-[1.5px] border-line px-5 py-6 font-mono text-xs text-muted">
          {"ninguém procurando ainda — seja o primeiro a se anunciar"}
        </p>
      ) : (
        <ul className="grid gap-3">
          {entries.map((e) => (
            <li
              key={e.id}
              className={`flex flex-col gap-2 border p-4 ${
                mine?.id === e.id
                  ? "border-accent bg-mint"
                  : "border-line bg-surface"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/u/${e.username}`}
                  className="font-mono text-sm text-accent hover:underline"
                >
                  @{e.username}
                </Link>
                <span className="border border-line px-1.5 font-mono text-[12px] text-muted">
                  LV{levelFor(e.xp).level.n}
                </span>
                {e.persona && (
                  <span className="border border-line bg-mint px-1.5 font-mono text-[12px] text-accent">
                    {e.persona}
                  </span>
                )}
                {e.headline && (
                  <span className="font-mono text-xs text-muted">
                    {e.headline}
                  </span>
                )}
                {mine?.id === e.id && (
                  <span className="ml-auto font-mono text-[12px] text-accent">
                    ← seu anúncio
                  </span>
                )}
              </div>
              {e.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {e.skills.map((s) => (
                    <span
                      key={s}
                      className="border-[1.5px] border-line px-1.5 py-0.5 font-mono text-[12px] text-muted"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <p className="font-mono text-xs text-foreground">
                <span className="text-muted">busca:</span> {e.need}
              </p>
              {e.note && (
                <p className="font-mono text-xs text-muted">{e.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canPost && !open && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => openForm(mine)}
            className="w-fit border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent"
          >
            {mine ? "editar meu anúncio" : "+ procuro time"}
          </button>
          {mine && (
            <button
              type="button"
              onClick={deactivate}
              disabled={busy}
              className="font-mono text-[12px] text-muted uppercase tracking-[0.06em] transition hover:text-orange disabled:opacity-50"
            >
              {busy ? "…" : "desativar — achei time"}
            </button>
          )}
        </div>
      )}

      {canPost && open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3 border border-line bg-surface p-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              o que falta no time? (obrigatório)
            </span>
            <input
              value={need}
              onChange={(e) => setNeed(e.target.value)}
              required
              maxLength={200}
              placeholder="o que falta no time? ex.: dev front + alguém de dados"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              suas habilidades (separadas por vírgula)
            </span>
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="react, typescript, figma"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted">
              nota (opcional: disponibilidade, o que você quer construir)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="chego sexta à noite, prefiro time presencial"
              aria-describedby="board-note-help"
              className={`${input} resize-none`}
            />
            <span id="board-note-help" className="font-mono text-[12px] text-muted">
              Só quem tem inscrição aprovada nesta edição vê a nota. Não coloque telefone nem e-mail: quem se
              interessar chama você pelo perfil.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !need.trim()}
              className="border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
            >
              {busy ? "…" : mine ? "atualizar →" : "anunciar → +10xp"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[12px] text-muted uppercase tracking-[0.06em] hover:text-foreground"
            >
              cancelar
            </button>
          </div>
        </form>
      )}
      <p role="alert" className="font-mono text-xs text-orange empty:hidden">
        {err}
      </p>
    </div>
  );
}

// moderação admin — desativa/reativa anúncio sem apagar (FR-008)
export function TeamBoardToggle({
  entryId,
  hackathonId,
  active,
}: {
  entryId: number;
  hackathonId: string;
  active: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/hackathons/${hackathonId}/team-board`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId, active: !active }),
    });
    if (res.ok) window.location.reload();
    else setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="font-mono text-[12px] text-muted uppercase tracking-[0.06em] transition hover:text-accent disabled:opacity-50"
    >
      {busy ? "…" : active ? "desativar" : "reativar"}
    </button>
  );
}
