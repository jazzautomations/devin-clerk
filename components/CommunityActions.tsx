"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Ações da página da comunidade que precisam de clique: entrar/sair, seguir,
// aviso da organização, organizadores (dono), denúncia e moderação (admin).

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
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

export function JoinButton({ slug, member }: { slug: string; member: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    if (member && !confirm("Sair da comunidade? Você deixa de receber os avisos dela.")) return;
    setBusy(true);
    setError(null);
    const r = await call(`/api/communities/${slug}/members`, member ? "DELETE" : "POST");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={member ? "btn-ghost min-h-[44px]!" : "btn min-h-[48px]! px-6!"}
        data-testid={member ? "community-leave" : "community-join"}
      >
        {busy ? "um instante…" : member ? "sair da comunidade" : "entrar na comunidade →"}
      </button>
      {error && (
        <p role="alert" className="max-w-[40ch] font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Seguir leve (migration 030): pra quem não quer ser membro. Membro já
 * segue, então este botão só aparece pra quem não está na comunidade.
 */
export function FollowButton({ slug, following, compact = false }: { slug: string; following: boolean; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/communities/${slug}/follow`, following ? "DELETE" : "POST");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  const size = compact ? "min-h-[40px]! px-3! text-[14px]!" : "min-h-[44px]!";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={following}
        className={`btn-ghost ${size}`}
        data-testid={following ? "community-unfollow" : "community-follow"}
      >
        {busy ? "um instante…" : following ? "deixar de seguir" : "seguir"}
      </button>
      {error && (
        <p role="alert" className="max-w-[40ch] font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}

export function NoticeForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call(`/api/communities/${slug}/notices`, "POST", { title, body });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "" });
    const n = r.data?.notified ?? 0;
    setMsg({ ok: true, text: n === 1 ? "aviso publicado. 1 pessoa foi avisada." : `aviso publicado. ${n} pessoas foram avisadas.` });
    setTitle("");
    setBody("");
    router.refresh();
  }
  return (
    <form onSubmit={send} className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid="notice-form">
      <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">novo aviso pra comunidade</p>
      <input className={input} required maxLength={90} placeholder="título" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="título do aviso" />
      <textarea
        className={`${input} resize-none`}
        required
        rows={3}
        maxLength={1000}
        placeholder="o que a comunidade precisa saber"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="texto do aviso"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[12px] text-muted">cada membro recebe uma notificação no HackaHub</span>
        <button type="submit" disabled={busy} className="btn min-h-[40px]!">
          {busy ? "publicando…" : "publicar aviso →"}
        </button>
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`font-mono text-[12.5px] ${msg.ok ? "text-accent" : "text-orange"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}

export function OrganizersPanel({
  slug,
  organizers,
  invites,
}: {
  slug: string;
  organizers: { memberId: number; username: string; name: string | null }[];
  invites: { email: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call(`/api/communities/${slug}/organizers`, "POST", { email });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "" });
    const s = r.data?.status;
    setMsg({
      ok: true,
      text:
        s === "pending"
          ? "convite guardado. Vale quando a pessoa entrar com esse e-mail."
          : s === "already"
            ? "essa pessoa já organiza a comunidade."
            : "pronto. A pessoa já organiza a comunidade.",
    });
    setEmail("");
    router.refresh();
  }
  async function remove(body: { memberId?: number; email?: string }) {
    if (!confirm("Tirar da organização? A pessoa continua na comunidade.")) return;
    const r = await call(`/api/communities/${slug}/organizers`, "DELETE", body);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "" });
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid="organizers-panel">
      <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">quem organiza com você</p>
      {organizers.length + invites.length > 0 && (
        <ul className="border-b border-line">
          {organizers.map((o) => (
            <li key={o.memberId} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[14.5px]">
              <span className="min-w-0 truncate">
                {o.name ?? `@${o.username}`} <span className="font-mono text-[12px] text-muted">@{o.username}</span>
              </span>
              <button type="button" onClick={() => remove({ memberId: o.memberId })} className="font-mono text-[12px] text-orange hover:underline">
                tirar
              </button>
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.email} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[14.5px]">
              <span className="min-w-0 truncate font-mono text-[13px]">
                {i.email} <span className="text-muted">· convite pendente</span>
              </span>
              <button type="button" onClick={() => remove({ email: i.email })} className="font-mono text-[12px] text-orange hover:underline">
                cancelar
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
        <input
          className={input}
          type="email"
          required
          placeholder="e-mail de quem organiza junto"
          aria-label="e-mail do organizador"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={busy} className="btn shrink-0 min-h-[44px]!">
          {busy ? "chamando…" : "chamar →"}
        </button>
      </form>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`font-mono text-[12.5px] ${msg.ok ? "text-accent" : "text-orange"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

export function ReportLink({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const r = await call(`/api/communities/${slug}/report`, "POST", { reason });
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "" });
    setMsg({ ok: true, text: "recebido. A equipe do HackaHub vai olhar." });
    setReason("");
    setOpen(false);
  }
  return (
    <div className="flex flex-col gap-2">
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="self-start font-mono text-[12.5px] text-muted underline-offset-4 hover:underline" data-testid="community-report">
          denunciar esta comunidade
        </button>
      )}
      {open && (
        <form onSubmit={send} className="flex flex-col gap-2">
          <label className="font-mono text-[12px] text-muted" htmlFor="report-reason">
            o que está errado? (só a equipe do HackaHub vê)
          </label>
          <textarea id="report-reason" className={`${input} resize-none`} rows={2} required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-3">
            <button type="submit" className="btn-ghost min-h-[40px]!">
              enviar
            </button>
            <button type="button" onClick={() => setOpen(false)} className="font-mono text-[12.5px] text-muted hover:underline">
              cancelar
            </button>
          </div>
        </form>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`font-mono text-[12.5px] ${msg.ok ? "text-accent" : "text-orange"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

export function ModerationToggles({ slug, hidden, verified }: { slug: string; hidden: boolean; verified: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(patch: { hidden?: boolean; verified?: boolean }) {
    setBusy(true);
    const r = await call(`/api/admin/communities/${slug}`, "PATCH", patch);
    setBusy(false);
    if (!r.ok) return alert(r.error);
    router.refresh();
  }
  return (
    <span className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => set({ verified: !verified })} className="btn-ghost min-h-[36px]! px-3! text-[13px]!">
        {verified ? "tirar selo" : "dar selo"}
      </button>
      <button type="button" disabled={busy} onClick={() => set({ hidden: !hidden })} className="btn-ghost min-h-[36px]! px-3! text-[13px]!" data-testid={`moderate-${slug}`}>
        {hidden ? "mostrar" : "esconder"}
      </button>
    </span>
  );
}
