"use client";

import { useEffect, useId, useRef, useState } from "react";

// Campo de texto com autocomplete de @ (spec 046, onda 2, mencoes-e-tags).
// Usado na caixa de postar e na de comentar. Digitar "@ab" (2+ caracteres)
// consulta /api/members/suggest com debounce de 200ms e abre um combobox:
// setas navegam, Enter escolhe, Esc fecha. O texto continua sendo texto —
// quem transforma @ e # em link é components/RichText.tsx na leitura.

export type SuggestPerson = { username: string; name: string | null; avatarUrl: string | null };

const DEBOUNCE_MS = 200;

/** trecho "@ab" antes do cursor: só no começo ou depois de espaço/abre-colchete */
export function mentionQueryBefore(value: string, caret: number): { start: number; q: string } | null {
  const upto = value.slice(0, caret);
  const m = /(^|[\s([{"'>])@([a-z0-9_]{2,20})$/i.exec(upto);
  if (!m) return null;
  return { start: caret - m[2].length - 1, q: m[2].toLowerCase() };
}

export function MentionField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  rows = 3,
  maxLength = 500,
  autoFocus = false,
  className = "",
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [query, setQuery] = useState<{ start: number; q: string } | null>(null);
  const [people, setPeople] = useState<SuggestPerson[]>([]);
  const [index, setIndex] = useState(0);
  const open = !!query && people.length > 0;

  // consulta com debounce: cada tecla cancela a anterior. A lista antiga fica
  // na tela até a resposta nova (evita piscar a cada tecla).
  useEffect(() => {
    if (!query) return;
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/members/suggest?q=${encodeURIComponent(query.q)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { people?: SuggestPerson[] } | null) => {
          if (!alive) return;
          setPeople(Array.isArray(d?.people) ? d!.people.slice(0, 8) : []);
          setIndex(0);
        })
        .catch(() => {
          if (alive) setPeople([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  function sync() {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const next = mentionQueryBefore(el.value, caret);
    // mesma consulta: não reabre/reinicia a lista a cada tecla
    setQuery((cur) => (cur && next && cur.q === next.q && cur.start === next.start ? cur : next));
    if (!next) setPeople([]);
  }

  function pick(person: SuggestPerson) {
    if (!query) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, query.start);
    const after = value.slice(caret);
    const insert = `@${person.username} `;
    const next = `${before}${insert}${after}`.slice(0, maxLength);
    setQuery(null);
    setPeople([]);
    // o campo é controlado: escrever o mesmo texto no DOM antes do onChange
    // deixa o cursor no lugar certo já neste evento (sem frame de espera, que
    // embaralhava quem continuasse digitando)
    if (el) {
      el.value = next;
      el.focus();
      const pos = Math.min(before.length + insert.length, next.length);
      el.setSelectionRange(pos, pos);
    }
    onChange(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) {
      if (e.key === "Escape") setQuery(null);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (i + 1) % people.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i - 1 + people.length) % people.length);
      return;
    }
    if (e.key === "Enter") {
      // Enter escolhe a pessoa; não envia o formulário
      e.preventDefault();
      pick(people[index] ?? people[0]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery(null);
      setPeople([]);
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    // combobox = o container com o campo e a lista (padrão ARIA do campo com
    // sugestões): o textarea continua sendo textbox, então leitor de tela e
    // teste continuam achando o campo como campo.
    <div
      className="relative flex flex-col"
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-haspopup="listbox"
    >
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        maxLength={maxLength}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoFocus={autoFocus}
        data-testid={testId}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(index) : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          // o valor novo ainda não está no DOM: lê do evento
          const el = e.currentTarget;
          const caret = el.selectionStart ?? el.value.length;
          const next = mentionQueryBefore(el.value, caret);
          setQuery(next);
          if (!next) setPeople([]);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          // setas horizontais e cliques movem o cursor: a consulta muda de lugar
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) sync();
        }}
        onClick={sync}
        onBlur={() => setTimeout(() => setPeople([]), 120)}
        className={className}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="pessoas pra mencionar"
          data-testid="mention-suggest"
          className="absolute top-full left-0 z-30 mt-1 flex w-full max-w-[22rem] flex-col border-[1.5px] border-line bg-background py-1 shadow-[4px_4px_0_rgba(12,12,12,0.85)]"
        >
          {people.map((p, i) => (
            <li key={p.username} id={optionId(i)} role="option" aria-selected={i === index}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left font-mono text-[13px] ${
                  i === index ? "bg-mint text-accent" : "hover:bg-mint"
                }`}
              >
                <span className="truncate font-semibold">@{p.username}</span>
                {p.name && <span className="truncate text-muted">{p.name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
