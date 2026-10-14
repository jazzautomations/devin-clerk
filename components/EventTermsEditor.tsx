"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[16px] text-foreground focus:border-accent focus:outline-none";
const label = "font-mono text-[12px] tracking-widest text-muted uppercase";

// frente L — termos do evento no painel: idade mínima (padrão 18), pergunta
// de restrição alimentar e o código de conduta da edição. Mudar o texto do
// código cria uma versão nova; quem já aceitou fica com a versão que leu.
export function EventTermsEditor({
  hackathonId,
  minAge: initialMinAge,
  dietEnabled: initialDiet,
  conductText: initialText,
  conductVersion,
  minFloor = 18,
}: {
  hackathonId: string;
  /** piso da plataforma (lib/eventTerms minAgeFloor): 18 sem HACKAHUB_ALLOW_MINORS */
  minFloor?: number;
  minAge: number;
  dietEnabled: boolean;
  conductText: string;
  conductVersion: number;
}) {
  const router = useRouter();
  const [minAge, setMinAge] = useState(String(initialMinAge));
  const [diet, setDiet] = useState(initialDiet);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const age = Number(minAge);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/hackathons/${hackathonId}/terms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minAge: age, dietEnabled: diet, conductText: text }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setMsg({ ok: true, text: `salvo · código de conduta v${data?.conductVersion ?? conductVersion}` });
        router.refresh();
      } else setMsg({ ok: false, text: typeof data?.error === "string" ? data.error : "não deu certo" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5 border-[1.5px] border-line p-4 sm:p-5" data-testid="event-terms-editor">
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] leading-none font-extrabold tracking-[-0.03em]">Termos do evento</h2>
        <p className="text-[14px] text-muted">
          A inscrição sempre pede data de nascimento, aceite do código de conduta e a caixa separada (opcional) de uso
          de imagem.
        </p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={label}>idade mínima na data do evento</span>
        <input
          type="number"
          min={minFloor}
          max={99}
          inputMode="numeric"
          className={`${field} sm:max-w-32`}
          value={minAge}
          onChange={(e) => setMinAge(e.target.value)}
        />
        {age < 18 && age >= minFloor && (
          <span className="border-[1.5px] border-orange p-3 text-[13px] leading-snug text-orange" data-testid="minors-warning">
            Edição com menor de 18 exige nome, e-mail e aceite do responsável na inscrição (o responsável recebe e-mail).
            Antes de abrir, tenha parecer jurídico (ECA Digital, Lei 15.211/2025), 1 adulto pra cada 15 menores e
            nenhuma mentoria 1:1 fora de vista.
          </span>
        )}
      </label>
      <label className="flex cursor-pointer items-start gap-3 text-[15px]">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
          checked={diet}
          onChange={(e) => setDiet(e.target.checked)}
        />
        <span>
          Perguntar restrição alimentar (vegetariano, vegano, sem glúten, sem lactose e alergias) — relatório na aba
          refeições
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>código de conduta · versão {conductVersion}</span>
        <textarea
          className={`${field} min-h-72 font-mono text-[13px] leading-relaxed`}
          value={text}
          maxLength={20000}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="text-[13px] text-muted">
          Texto puro: linha curta sozinha vira título, linha começando com &quot;- &quot; vira item de lista.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-50">
          {busy ? "salvando…" : "salvar termos"}
        </button>
        {msg && (
          <span role="status" className={`font-mono text-[13px] ${msg.ok ? "text-accent" : "text-orange"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
