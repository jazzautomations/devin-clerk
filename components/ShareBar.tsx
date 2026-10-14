"use client";

import { useState } from "react";
import { shareLinks } from "@/lib/social";

// Compartilhar: no celular abre a folha nativa (Web Share API); em qualquer
// tela tem LinkedIn, X, WhatsApp, Telegram e copiar link.
export function ShareBar({ url, text, label = "compartilhar" }: { url: string; text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const links = shareLinks(url, text);
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function nativeShare() {
    try {
      await navigator.share({ title: text, text, url });
    } catch {
      // usuário cancelou — nada a fazer
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const item = "font-mono text-[12px] underline-offset-4 hover:text-accent hover:underline";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label={label}>
      <span className="font-mono text-[12px] tracking-widest text-muted uppercase">{label}</span>
      {canNative && (
        <button type="button" onClick={() => void nativeShare()} className={item}>
          enviar…
        </button>
      )}
      <a href={links.linkedin} target="_blank" rel="noopener noreferrer" className={item}>
        linkedin
      </a>
      <a href={links.x} target="_blank" rel="noopener noreferrer" className={item}>
        x
      </a>
      <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className={item}>
        whatsapp
      </a>
      <a href={links.telegram} target="_blank" rel="noopener noreferrer" className={item}>
        telegram
      </a>
      <button type="button" onClick={() => void copy()} className={item} aria-live="polite">
        {copied ? "link copiado" : "copiar link"}
      </button>
    </div>
  );
}
