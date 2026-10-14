"use client";

import { useState } from "react";

// Direitos do titular no /perfil: baixar os dados e excluir a conta.
export function PrivacyPanel() {
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<"idle" | "deleting" | "error">("idle");

  async function remove() {
    setState("deleting");
    const res = await fetch("/api/members/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "excluir" }),
    });
    if (res.ok) window.location.href = "/";
    else setState("error");
  }

  return (
    <section id="dados" className="flex flex-col gap-4 border-t-2 border-line pt-6">
      <h2 className="text-xl font-extrabold tracking-[-0.03em]">Teus dados</h2>
      <p className="max-w-prose text-sm text-muted">
        Tu pode baixar tudo que o HackaHub guarda sobre ti ou excluir tua conta. Excluir apaga
        perfil, posts, comentários, notificações, papéis e certificados; tuas inscrições viram
        anônimas pra a edição não perder a contagem.
      </p>
      <div className="flex flex-wrap gap-3">
        <a href="/api/members/me/export" className="btn-ghost">
          baixar meus dados (JSON)
        </a>
      </div>
      <details className="max-w-md">
        <summary className="cursor-pointer font-mono text-[13px] text-[#ba3919]">excluir minha conta</summary>
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Digite <b className="font-mono">excluir</b> pra confirmar. Não dá pra desfazer.
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm"
              aria-label="confirmação de exclusão"
            />
          </label>
          <button
            type="button"
            disabled={typed !== "excluir" || state === "deleting"}
            onClick={() => void remove()}
            className="btn self-start disabled:opacity-40"
          >
            {state === "deleting" ? "excluindo…" : "excluir conta e dados"}
          </button>
          {state === "error" && <p className="text-sm text-[#ba3919]">Não deu certo. Tenta de novo.</p>}
        </div>
      </details>
    </section>
  );
}
