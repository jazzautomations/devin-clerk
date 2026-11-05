"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { userMessage } from "@/lib/apiError";
import { SPACE_LIMITS, SPACE_POLICY_LABEL, type CommunitySpace, type SpacePolicy } from "@/lib/spaceConsts";

// Gestão dos espaços (migration 057), pra dono, organizador e admin:
// criar (nome, descrição e quem posta), renomear, subir/descer na barra e
// arquivar — arquivado sai do seletor e mantém os posts, e volta por aqui.
// O geral não é arquivável: é pra ele que cai o post sem espaço.

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; error: string | null }> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, error: "Sem conexão. Tente de novo." };
  if (res.ok) return { ok: true, status: res.status, error: null };
  const data = await res.json().catch(() => null);
  return { ok: false, status: res.status, error: userMessage(res, data, "não deu. Tente de novo.") };
}

const small =
  "grid min-h-[40px] min-w-[40px] place-items-center rounded-[6px] border-[1.5px] border-line font-mono text-[14px] hover:bg-mint disabled:opacity-40";

export function SpaceAdmin({ slug, spaces }: { slug: string; spaces: CommunitySpace[] }) {
  const router = useRouter();
  const active = spaces.filter((s) => !s.archivedAt);
  const archived = spaces.filter((s) => s.archivedAt);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [postPolicy, setPostPolicy] = useState<SpacePolicy>("membros");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const api = `/api/communities/${slug}/spaces`;

  async function run(r: Promise<{ ok: boolean; status: number; error: string | null }>, okText?: string) {
    setBusy(true);
    const res = await r;
    setBusy(false);
    if (!res.ok) {
      const stale = res.status === 400 || res.status === 404;
      setMsg({ ok: false, text: stale ? "A lista mudou. Confira e tente de novo." : (res.error ?? "") });
      if (stale) router.refresh();
      return false;
    }
    setMsg(okText ? { ok: true, text: okText } : null);
    router.refresh();
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (
      await run(call(api, "POST", { name, description: description || undefined, postPolicy }), `#${name.trim()} está no ar.`)
    ) {
      setName("");
      setDescription("");
      setPostPolicy("membros");
    }
  }

  async function move(index: number, delta: -1 | 1) {
    const ids = active.map((s) => s.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await run(call(api, "PATCH", { order: ids }));
  }

  async function saveRename(s: CommunitySpace) {
    if (await run(call(`${api}/${s.id}`, "PATCH", { name: editName, description: editDesc || null }), `#${s.slug} atualizado.`)) {
      setEditing(null);
    }
  }

  async function setArchived(s: CommunitySpace, archived: boolean) {
    if (archived && !confirm(`Arquivar #${s.slug}? Ele sai do seletor e os posts ficam.`)) return;
    await run(
      call(`${api}/${s.id}`, "PATCH", { archived }),
      archived ? `#${s.slug} arquivado.` : `#${s.slug} de volta na barra.`,
    );
  }

  const input =
    "w-full border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

  return (
    <div className="flex flex-col gap-8" data-testid="spaces-admin">
      {active.length > 0 ? (
        <ol className="flex flex-col border-b border-line" data-testid="spaces-admin-list">
          {active.map((s, i) => (
            <li key={s.id} className="flex flex-col gap-2 border-t border-line py-3" data-testid={`space-row-${s.slug}`}>
              {editing === s.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveRename(s);
                  }}
                >
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={SPACE_LIMITS.name} className={input} aria-label="nome do espaço" required />
                  <input
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    maxLength={SPACE_LIMITS.description}
                    className={input}
                    aria-label="descrição do espaço"
                    placeholder="descrição (opcional)"
                  />
                  <span className="flex gap-2">
                    <button type="submit" disabled={busy} className="btn-ghost min-h-[40px]!">
                      salvar
                    </button>
                    <button type="button" disabled={busy} className="btn-ghost min-h-[40px]!" onClick={() => setEditing(null)}>
                      cancelar
                    </button>
                  </span>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[12.5px] text-muted">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold break-words">#{s.slug}</span>
                    <span className="font-mono text-[12px] text-muted">
                      {SPACE_POLICY_LABEL[s.postPolicy]}
                      {s.description ? ` · ${s.description}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <button type="button" className={small} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`subir ${s.slug}`}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className={small}
                      disabled={busy || i === active.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`descer ${s.slug}`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={`${small} px-2`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(s.id);
                        setEditName(s.name);
                        setEditDesc(s.description ?? "");
                      }}
                      aria-label={`renomear ${s.slug}`}
                      data-testid={`space-edit-${s.slug}`}
                    >
                      renomear
                    </button>
                    {s.slug !== "geral" && (
                      <button
                        type="button"
                        className={`${small} px-2 text-orange`}
                        disabled={busy}
                        onClick={() => setArchived(s, true)}
                        aria-label={`arquivar ${s.slug}`}
                        data-testid={`space-archive-${s.slug}`}
                      >
                        arquivar
                      </button>
                    )}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="border-[1.5px] border-dashed border-line px-4 py-4 text-[15px] text-muted">Nenhum espaço ativo.</p>
      )}

      <form onSubmit={add} className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid="space-form">
        <p className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">novo espaço</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={SPACE_LIMITS.name}
          className={input}
          placeholder="nome (vira #nome na barra)"
          aria-label="nome do espaço"
          required
          data-testid="space-name"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={SPACE_LIMITS.description}
          className={input}
          placeholder="descrição (opcional)"
          aria-label="descrição do espaço"
          data-testid="space-description"
        />
        <label className="flex items-center gap-2 font-mono text-[12px] text-muted">
          quem posta
          <select
            value={postPolicy}
            onChange={(e) => setPostPolicy(e.target.value as SpacePolicy)}
            className="border-[1.5px] border-line bg-background px-2 py-1.5 font-mono text-[12px] text-foreground focus:border-accent focus:outline-none"
            aria-label="quem posta"
            data-testid="space-policy"
          >
            <option value="membros">{SPACE_POLICY_LABEL.membros}</option>
            <option value="organizacao">{SPACE_POLICY_LABEL.organizacao}</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !name.trim() || active.length >= SPACE_LIMITS.active} className="btn min-h-[44px]! self-start" data-testid="space-create">
          criar espaço
        </button>
      </form>

      {archived.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="spaces-archived">
          <p className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">arquivados</p>
          <ul className="flex flex-col border-b border-line">
            {archived.map((s) => (
              <li key={s.id} className="flex items-center gap-3 border-t border-line py-3" data-testid={`space-archived-${s.slug}`}>
                <span className="min-w-0 flex-1 font-bold text-muted">#{s.slug}</span>
                <button type="button" className={`${small} px-2`} disabled={busy} onClick={() => setArchived(s, false)} aria-label={`desarquivar ${s.slug}`}>
                  desarquivar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && (
        <p role="status" className={`font-mono text-xs ${msg.ok ? "text-accent" : "text-orange"}`} data-testid="spaces-admin-msg">
          {msg.text}
        </p>
      )}
    </div>
  );
}
