"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";
import { parseEventTime } from "@/lib/eventTime";

// Formulário do desafio aberto com pré-visualização. Novo: POST
// /api/open-challenges. Rascunho: PATCH /api/open-challenges/[id].
// "salvar rascunho" guarda sem avisar ninguém; "publicar" abre as entregas
// e avisa membros e seguidores. Publicado não muda mais.

type Values = { title: string; sponsorName: string; prize: string; deadline: string; brief: string; rules: string };
const EMPTY: Values = { title: "", sponsorName: "", prize: "", deadline: "", brief: "", rules: "" };

const label = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";
const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={`self-end font-mono text-[12px] ${n > max ? "text-orange" : "text-muted"}`}>{n}/{max}</span>;
}

export function ChallengeForm({
  community,
  draftId,
  initial,
}: {
  community: { slug: string; name: string };
  draftId: number | null;
  initial?: Values;
}) {
  const router = useRouter();
  const [v, setV] = useState<Values>(initial ?? EMPTY);
  const [tab, setTab] = useState<"escrever" | "ver">("escrever");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof Values, val: string) => {
    setMsg(null);
    setV((o) => ({ ...o, [k]: val }));
  };
  const deadline = parseEventTime(v.deadline);
  const ready = v.title.trim() && v.brief.trim() && deadline;

  async function save(publish: boolean) {
    if (publish && !window.confirm(`Publicar? Membros e seguidores da ${community.name} recebem um aviso, e o desafio não muda mais.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const body = { ...v, publish, ...(draftId ? {} : { community: community.slug }) };
      const res = await fetch(draftId ? `/api/open-challenges/${draftId}` : "/api/open-challenges", {
        method: draftId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: userMessage(res, data, "Não deu pra salvar. Tente de novo.") });
        return;
      }
      const id = data?.challenge?.id as number | undefined;
      if (publish && id) {
        router.push(`/desafios/${id}`);
        return;
      }
      setMsg({ ok: true, text: "Rascunho salvo. Só a organização vê." });
      if (!draftId && id) router.replace(`/comunidade/${community.slug}/desafios/novo?rascunho=${id}`);
      else router.refresh();
    } catch {
      setMsg({ ok: false, text: "Sem conexão. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!draftId || !window.confirm("Apagar este rascunho?")) return;
    setBusy(true);
    const res = await fetch(`/api/open-challenges/${draftId}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.replace(`/comunidade/${community.slug}/desafios/novo`);
    else setMsg({ ok: false, text: "Não deu pra apagar. Recarregue a página." });
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="formulário do desafio" className="flex border-b-2 border-line">
        {(["escrever", "ver"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            data-testid={`desafio-tab-${t}`}
            className={`-mb-[2px] min-h-[44px] border-b-2 px-4 font-mono text-[13px] ${
              tab === t ? "border-accent font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t === "escrever" ? "escrever" : "pré-visualizar"}
          </button>
        ))}
      </div>

      <form
        hidden={tab !== "escrever"}
        className="flex flex-col gap-6"
        data-testid="desafio-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className={label}>título</span>
          <input
            className={input}
            required
            maxLength={100}
            value={v.title}
            placeholder="App que avisa a fila do bandejão"
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>o que construir</span>
          <textarea
            className={`${input} resize-y`}
            rows={6}
            required
            maxLength={3000}
            value={v.brief}
            placeholder="O problema, pra quem é e o que conta como pronto."
            onChange={(e) => set("brief", e.target.value)}
          />
          <Counter n={v.brief.length} max={3000} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>regras (opcional)</span>
          <textarea
            className={`${input} resize-y`}
            rows={4}
            maxLength={3000}
            value={v.rules}
            placeholder="Solo ou em time, tecnologia livre, código aberto…"
            onChange={(e) => set("rules", e.target.value)}
          />
          <Counter n={v.rules.length} max={3000} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>prazo de entrega</span>
            <input
              className={input}
              type="datetime-local"
              required
              value={v.deadline}
              onChange={(e) => set("deadline", e.target.value)}
              data-testid="desafio-deadline"
            />
            <span className="font-mono text-[12px] text-muted">horário de Brasília</span>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>prêmio (opcional)</span>
            <input
              className={input}
              maxLength={200}
              value={v.prize}
              placeholder="R$ 500 pro 1º e mentoria"
              onChange={(e) => set("prize", e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={label}>patrocinador (opcional)</span>
          <input
            className={input}
            maxLength={80}
            value={v.sponsorName}
            placeholder="nome da empresa que banca o prêmio"
            onChange={(e) => set("sponsorName", e.target.value)}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button type="submit" className="btn" disabled={busy || !ready} data-testid="desafio-publicar">
            publicar
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || !ready}
            onClick={() => void save(false)}
            data-testid="desafio-salvar"
          >
            salvar rascunho
          </button>
          {draftId && (
            <button
              type="button"
              className="font-mono text-[13px] text-muted underline underline-offset-4 hover:text-foreground"
              disabled={busy}
              onClick={() => void discard()}
              data-testid="desafio-apagar"
            >
              apagar rascunho
            </button>
          )}
        </div>
      </form>

      {tab === "ver" && (
        <article className="flex flex-col gap-6 border-[1.5px] border-line p-5 sm:p-7" data-testid="desafio-preview">
          <div className="flex flex-col gap-3">
            <p className="font-mono text-[13px] text-muted">
              <span className="font-semibold text-foreground">{community.name}</span>
              {v.sponsorName.trim() && <> · patrocinado por {v.sponsorName.trim()}</>}
            </p>
            <h2 className="text-[clamp(1.7rem,5vw,2.5rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">
              {v.title.trim() || "Título do desafio"}
            </h2>
            <p className="font-mono text-[13px]">
              {deadline ? <>prazo {fmt.format(deadline).replace(".", "")} <span className="text-muted">(Brasília)</span></> : <span className="text-muted">sem prazo ainda</span>}
            </p>
          </div>
          {v.prize.trim() && (
            <div className="flex flex-col gap-1 border-[1.5px] border-line bg-mint px-4 py-3">
              <span className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">prêmio</span>
              <span className="text-[17px] font-bold break-words">{v.prize.trim()}</span>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <h3 className="text-[20px] font-extrabold tracking-[-0.03em]">O que construir</h3>
            <p className="text-[15.5px] leading-relaxed break-words whitespace-pre-line">
              {v.brief.trim() || <span className="text-muted">Escreva o que é pra construir.</span>}
            </p>
          </div>
          {v.rules.trim() && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[20px] font-extrabold tracking-[-0.03em]">Regras</h3>
              <p className="text-[15px] leading-relaxed break-words whitespace-pre-line text-[#2b2b2b]">{v.rules.trim()}</p>
            </div>
          )}
          <button type="button" className="btn-ghost self-start" onClick={() => setTab("escrever")}>
            voltar a escrever
          </button>
        </article>
      )}

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`font-mono text-[13px] ${msg.ok ? "text-accent" : "text-orange"}`} data-testid="desafio-msg">
          {msg.text}
        </p>
      )}
    </div>
  );
}
