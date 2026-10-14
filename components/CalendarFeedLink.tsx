"use client";

import { useState } from "react";

// Feed .ics pessoal: copiar, assinar (webcal) e revogar o link.
export function CalendarFeedLink({ hackathonId, initialUrl }: { hackathonId: string; initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [msg, setMsg] = useState<string | null>(null);
  const webcal = url.replace(/^https?:/, "webcal:");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMsg("link copiado");
    } catch {
      setMsg("não deu pra copiar — seleciona o link e copia");
    }
  }

  async function revoke() {
    if (!window.confirm("Revogar o link atual? Calendários que assinaram com ele param de atualizar.")) return;
    const res = await fetch(`/api/me/calendar?h=${encodeURIComponent(hackathonId)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error ?? "erro ao revogar");
      return;
    }
    setUrl(data.url);
    setMsg("link antigo revogado — assina de novo com o novo");
  }

  return (
    <div data-testid="personal-feed" className="flex min-w-0 flex-col gap-3 border-[1.5px] border-line p-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">minha agenda</p>
        <p className="text-[14px]">
          Link pessoal com tudo que vale pra você (inclusive itens só do teu papel). Assina uma vez; mudança de horário
          chega sozinha. Não compartilha — quem tiver o link vê tua programação.
        </p>
      </div>
      <input
        readOnly
        value={url}
        aria-label="link do feed pessoal"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-[12px]"
      />
      <div className="flex flex-wrap gap-2">
        <a href={webcal} className="btn rounded-[6px]">
          assinar no calendário
        </a>
        <button type="button" onClick={copy} className="btn-ghost rounded-[6px]">
          copiar link
        </button>
        <button type="button" onClick={revoke} className="btn-ghost rounded-[6px]">
          revogar link
        </button>
      </div>
      {msg && <p className="font-mono text-[12px] text-accent">{msg}</p>}
    </div>
  );
}
