"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Ações da moderação da própria comunidade (migration 046): apagar post do
// mural, remover membro (com "impedir de voltar"), editar e apagar aviso,
// passar a posse e excluir a comunidade. Tudo chama a API e recarrega a
// página: quem manda no que pode é o servidor.

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Sem conexão. Tente de novo.", data: null };
  const data = await res.json().catch(() => null);
  return { ok: res.ok, error: res.ok ? null : userMessage(res, data, "Não deu certo. Tente de novo."), data };
}

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";
const small = "font-mono text-[12.5px] underline-offset-4 hover:underline";

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="max-w-[40ch] font-mono text-[12.5px] text-orange">
      {text}
    </p>
  );
}

/** apaga um post do mural (a rota já aceita quem modera o espaço) */
export function DeletePostButton({ postId, testId }: { postId: number; testId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!confirm("Apagar este post? Sai do mural pra todo mundo.")) return;
    setBusy(true);
    setError(null);
    const r = await call(`/api/posts/${postId}`, "DELETE");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className={`${small} self-start text-orange disabled:opacity-60`}
        data-testid={testId ?? `mod-delete-post-${postId}`}
      >
        {busy ? "apagando…" : "apagar post"}
      </button>
      <ErrorLine text={error} />
    </span>
  );
}

/**
 * tira a pessoa da comunidade. A caixa "impedir de voltar" grava o ban: ela
 * não entra nem segue de novo até alguém liberar.
 */
export function RemoveMemberButton({
  slug,
  username,
  label = "remover do espaço",
  testId,
}: {
  slug: string;
  username: string;
  label?: string;
  testId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ban, setBan] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/communities/${slug}/members/${username}`, "DELETE", { ban, reason: reason.trim() || null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    setBan(false);
    setReason("");
    router.refresh();
  }
  if (!open) {
    return (
      <span className="flex flex-col gap-1">
        <button type="button" onClick={() => setOpen(true)} className={`${small} self-start text-orange`} data-testid={testId ?? `mod-remove-${username}`}>
          {label}
        </button>
        <ErrorLine text={error} />
      </span>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 border-[1.5px] border-line p-3" data-testid={`mod-remove-form-${username}`}>
      <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">remover @{username}</p>
      <label className="flex items-start gap-2 text-[14px]">
        <input type="checkbox" checked={ban} onChange={(e) => setBan(e.target.checked)} className="mt-1" data-testid="mod-ban-check" />
        <span>
          impedir de voltar
          <span className="block font-mono text-[12px] text-muted">não entra nem segue de novo até alguém liberar.</span>
        </span>
      </label>
      {ban && (
        <input
          className={input}
          maxLength={300}
          placeholder="motivo (só a organização vê)"
          aria-label="motivo do banimento"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <span className="flex flex-wrap gap-3">
        <button type="button" onClick={send} disabled={busy} className="btn-ghost min-h-[40px]! text-orange!" data-testid={`mod-remove-confirm-${username}`}>
          {busy ? "removendo…" : "remover"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={small}>
          cancelar
        </button>
      </span>
      <ErrorLine text={error} />
    </div>
  );
}

/** libera a volta de quem foi impedido */
export function UnbanButton({ slug, username }: { slug: string; username: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function release() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/communities/${slug}/bans/${username}`, "DELETE");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" onClick={release} disabled={busy} className={`${small} text-accent disabled:opacity-60`} data-testid={`mod-unban-${username}`}>
        {busy ? "liberando…" : "liberar"}
      </button>
      <ErrorLine text={error} />
    </span>
  );
}

/** editar e apagar um aviso da comunidade */
export function NoticeActions({
  slug,
  noticeId,
  title,
  body,
}: {
  slug: string;
  noticeId: number;
  title: string;
  body: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextTitle, setNextTitle] = useState(title);
  const [nextBody, setNextBody] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call(`/api/communities/${slug}/notices/${noticeId}`, "PATCH", { title: nextTitle, body: nextBody });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  async function remove() {
    if (!confirm("Apagar este aviso? Ele sai da página da comunidade.")) return;
    setBusy(true);
    setError(null);
    const r = await call(`/api/communities/${slug}/notices/${noticeId}`, "DELETE");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  if (!open) {
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen(true)} className={`${small} text-accent`} data-testid={`notice-edit-${noticeId}`}>
          editar
        </button>
        <button type="button" onClick={remove} disabled={busy} className={`${small} text-orange disabled:opacity-60`} data-testid={`notice-delete-${noticeId}`}>
          apagar
        </button>
        <ErrorLine text={error} />
      </span>
    );
  }
  return (
    <form onSubmit={save} className="flex w-full flex-col gap-2" data-testid={`notice-form-${noticeId}`}>
      <input
        className={input}
        required
        maxLength={90}
        aria-label="título do aviso"
        value={nextTitle}
        onChange={(e) => setNextTitle(e.target.value)}
      />
      <textarea
        className={`${input} resize-none`}
        required
        rows={3}
        maxLength={1000}
        aria-label="texto do aviso"
        value={nextBody}
        onChange={(e) => setNextBody(e.target.value)}
      />
      <span className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="btn min-h-[40px]!" data-testid={`notice-save-${noticeId}`}>
          {busy ? "salvando…" : "salvar aviso"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={small}>
          cancelar
        </button>
      </span>
      <ErrorLine text={error} />
    </form>
  );
}

/** dono passa a posse pra um organizador */
export function TransferOwnership({ slug, organizers }: { slug: string; organizers: { username: string; name: string | null }[] }) {
  const router = useRouter();
  const [username, setUsername] = useState(organizers[0]?.username ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Passar a posse da comunidade pra @${username}? Você continua como organizador.`)) return;
    setBusy(true);
    setError(null);
    const r = await call(`/api/communities/${slug}/transfer`, "POST", { username });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    // a área do dono deixa de existir pra quem passou: volta pra comunidade,
    // onde o papel novo aparece no topo da página
    router.push(`/comunidade/${slug}`);
    router.refresh();
  }
  if (organizers.length === 0) {
    return (
      <p className="font-mono text-[12.5px] text-muted" data-testid="mod-transfer-empty">
        Chame um organizador primeiro: a posse passa pra quem já organiza com você.
      </p>
    );
  }
  return (
    <form onSubmit={send} className="flex flex-col gap-2" data-testid="mod-transfer">
      <label className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase" htmlFor="mod-transfer-select">
        passar a posse
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id="mod-transfer-select"
          className={input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          data-testid="mod-transfer-select"
        >
          {organizers.map((o) => (
            <option key={o.username} value={o.username}>
              {o.name ?? `@${o.username}`} (@{o.username})
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className="btn-ghost shrink-0 min-h-[44px]!" data-testid="mod-transfer-send">
          {busy ? "passando…" : "passar →"}
        </button>
      </div>
      <ErrorLine text={error} />
    </form>
  );
}

/** dono exclui a comunidade digitando o endereço */
export function DeleteCommunity({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call(`/api/communities/${slug}`, "DELETE", { confirm: typed });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push("/comunidades");
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${small} self-start text-orange`} data-testid="mod-delete-open">
        excluir esta comunidade
      </button>
    );
  }
  return (
    <form onSubmit={send} className="flex flex-col gap-2 border-[1.5px] border-orange p-3" data-testid="mod-delete-form">
      <p className="text-[14.5px] font-bold">A comunidade sai do ar e o endereço passa a dar 404.</p>
      <p className="font-mono text-[12.5px] text-muted">Os hackathons que já rolaram ficam no arquivo.</p>
      <input
        className={input}
        placeholder={slug}
        aria-label="endereço da comunidade pra confirmar"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        data-testid="mod-delete-confirm"
      />
      <span className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="btn-ghost min-h-[40px]! text-orange!" data-testid="mod-delete-send">
          {busy ? "excluindo…" : "excluir de vez"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={small}>
          cancelar
        </button>
      </span>
      <ErrorLine text={error} />
    </form>
  );
}
