"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";
import { SUPPORT_KIND_LABELS, SUPPORT_KINDS, type SupportKind } from "@/lib/supportKinds";

// Ações de apoio da comunidade (migration 028): o "quero apoiar" público
// (vira lead em /api/leads, ligado à comunidade) e o painel do dono/
// organizador que cadastra, ordena e remove apoiadores.

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, error: "Sem conexão. Tente de novo.", data: null };
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, error: res.ok ? null : userMessage(res, data, "Não deu certo. Tente de novo."), data };
}

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";
const label = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";

/** "quero apoiar esta comunidade": empresa sem conta deixa o contato */
export function SupportCommunityForm({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  // começa vazio: o tipo só é gravado se a empresa escolher
  const [kind, setKind] = useState<SupportKind | "">("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError("");
    const r = await call("/api/leads", "POST", { company, email, community: slug, supportKind: kind || null, message, website });
    if (r.ok) return setStatus("done");
    setStatus("error");
    setError(r.error ?? "");
  }

  if (status === "done") {
    return (
      <p role="status" className="border-[1.5px] border-line bg-mint px-4 py-3 font-mono text-[13px] text-accent" data-testid="support-done">
        Contato enviado. A organização da comunidade vê seu pedido no painel.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2 border-[1.5px] border-line p-4" data-testid="support-cta">
        <p className="text-[15px] font-bold">Sua empresa quer apoiar a comunidade {name}?</p>
        <p className="text-[14px] leading-snug text-muted">Dinheiro, espaço, comida, prêmio, mentoria ou divulgação. A organização recebe seu contato.</p>
        <button type="button" onClick={() => setOpen(true)} className="btn mt-1 self-start min-h-[44px]!" data-testid="support-open">
          quero apoiar esta comunidade →
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid="support-form">
      <p className="text-[15px] font-bold">Apoiar a comunidade {name}</p>
      <label className="flex flex-col gap-1.5">
        <span className={label}>empresa ou instituição</span>
        <input className={input} required maxLength={120} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Padaria do Centro" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>e-mail</span>
        <input className={input} type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>como quer apoiar</span>
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as SupportKind | "")} data-testid="support-kind">
          <option value="">ainda não sei</option>
          {SUPPORT_KINDS.map((k) => (
            <option key={k} value={k}>
              {SUPPORT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>mensagem (opcional)</span>
        <textarea
          className={`${input} resize-none`}
          rows={3}
          maxLength={1000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="o que vocês oferecem e pra quando"
        />
      </label>
      {/* honeypot — invisível pra humano, bot preenche e é ignorado */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={status === "saving" || !company || !email} className="btn min-h-[44px]!" data-testid="support-submit">
          {status === "saving" ? "enviando…" : "enviar contato →"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="font-mono text-[12.5px] text-muted hover:underline">
          cancelar
        </button>
      </div>
      <p className="font-mono text-[12px] text-muted" data-testid="support-privacy">
        Seu contato vai pra organização da comunidade {name}.
      </p>
      {status === "error" && (
        <p role="alert" className="font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </form>
  );
}

type AdminSupporter = { id: number; name: string; kind: SupportKind; url: string | null; logoUrl: string | null; description: string | null };

/** painel do dono/organizador: cadastrar, ordenar e remover */
export function SupportersAdmin({ slug, supporters }: { slug: string; supporters: AdminSupporter[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  // sem tipo pré-escolhido: quem cadastra escolhe (a página mostra o tipo)
  const [kind, setKind] = useState<SupportKind | "">("");
  const [url, setUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const api = `/api/communities/${slug}/supporters`;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call(api, "POST", { name, kind, url, logoUrl, description });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "" });
    setMsg({ ok: true, text: `${name.trim()} está na página da comunidade.` });
    setName("");
    setUrl("");
    setLogoUrl("");
    setDescription("");
    setKind("");
    router.refresh();
  }

  // 400/404 aqui = a lista na tela ficou velha (outra pessoa cadastrou ou
  // tirou alguém): recarrega pra o próximo clique mandar a lista certa
  function failed(r: { status: number; error: string | null }) {
    const stale = r.status === 400 || r.status === 404;
    setMsg({ ok: false, text: stale ? "A lista mudou. Confira e tente de novo." : (r.error ?? "") });
    if (stale) router.refresh();
  }

  async function move(index: number, delta: -1 | 1) {
    const ids = supporters.map((s) => s.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setBusy(true);
    const r = await call(api, "PATCH", { order: ids });
    setBusy(false);
    if (!r.ok) return failed(r);
    setMsg(null);
    router.refresh();
  }

  async function remove(s: AdminSupporter) {
    if (!confirm(`Tirar ${s.name} da página da comunidade?`)) return;
    setBusy(true);
    const r = await call(api, "DELETE", { id: s.id });
    setBusy(false);
    if (!r.ok) return failed(r);
    setMsg({ ok: true, text: `${s.name} saiu da página.` });
    router.refresh();
  }

  const small = "grid min-h-[40px] min-w-[40px] place-items-center rounded-[6px] border-[1.5px] border-line font-mono text-[14px] hover:bg-mint disabled:opacity-40";

  return (
    <div className="flex flex-col gap-5" data-testid="supporters-admin">
      {supporters.length > 0 ? (
        <ol className="flex flex-col border-b border-line" data-testid="supporters-admin-list">
          {supporters.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3" data-testid="supporters-admin-row">
              <span className="font-mono text-[12.5px] text-muted">{i + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold break-words">{s.name}</span>
                <span className="font-mono text-[12px] text-muted">{SUPPORT_KIND_LABELS[s.kind]}</span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button type="button" className={small} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`subir ${s.name}`}>
                  ↑
                </button>
                <button
                  type="button"
                  className={small}
                  disabled={busy || i === supporters.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`descer ${s.name}`}
                >
                  ↓
                </button>
                <button type="button" className={`${small} px-2 text-orange`} disabled={busy} onClick={() => remove(s)} aria-label={`tirar ${s.name}`}>
                  tirar
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="border-[1.5px] border-dashed border-line px-4 py-4 text-[15px] text-muted" data-testid="supporters-empty">
          Ninguém cadastrado. A seção &quot;Quem apoia&quot; aparece na página quando você cadastrar o primeiro.
        </p>
      )}

      <form onSubmit={add} className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid="supporter-form">
        <p className={label}>cadastrar apoiador</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>nome</span>
            <input className={input} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Padaria do Centro" />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>tipo de apoio</span>
            <select className={input} required value={kind} onChange={(e) => setKind(e.target.value as SupportKind | "")} data-testid="supporter-kind">
              <option value="" disabled>
                escolha
              </option>
              {SUPPORT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SUPPORT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>link (opcional)</span>
            <input className={input} type="url" maxLength={300} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://empresa.com.br" />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>logo (opcional, link https)</span>
            <input className={input} type="url" maxLength={300} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://empresa.com.br/logo.png" />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={label}>o que fazem pela comunidade (opcional)</span>
          <input
            className={input}
            maxLength={160}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="cede o auditório nos hackathons"
          />
        </label>
        <button type="submit" disabled={busy || !name.trim() || !kind} className="btn self-start min-h-[44px]!" data-testid="supporter-submit">
          {busy ? "salvando…" : "cadastrar →"}
        </button>
      </form>
      {msg && (
        <p
          role={msg.ok ? "status" : "alert"}
          className={`font-mono text-[12.5px] ${msg.ok ? "text-accent" : "text-orange"}`}
          data-testid="supporters-msg"
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
