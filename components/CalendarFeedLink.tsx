"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";

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
      setMsg("não deu pra copiar. Selecione o link e copie.");
    }
  }

  async function revoke() {
    if (!window.confirm("Revogar o link atual? Calendários que assinaram com ele param de atualizar.")) return;
    const res = await fetch(`/api/me/calendar?h=${encodeURIComponent(hackathonId)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(userMessage(res, data, "não deu pra revogar. Tente de novo."));
      return;
    }
    setUrl(data.url);
    setMsg("link antigo revogado. Assine de novo com o link novo.");
  }

  return (
    <div data-testid="personal-feed" className="flex min-w-0 flex-col gap-3 border-[1.5px] border-line p-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">minha agenda</p>
        <p className="text-[14px]">
          Link pessoal com tudo que vale pra você, inclusive o que é só do seu papel. Assine uma vez e as mudanças de
          horário chegam sozinhas. Não compartilhe: quem tiver o link vê sua programação.
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
