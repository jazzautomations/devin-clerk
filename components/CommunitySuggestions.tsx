"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Onboarding: comunidades da cidade que a pessoa acabou de informar. Passo
// opcional: nada vem marcado, entrar é um clique por comunidade e ignorar
// não muda nada. Sem cidade ou sem comunidade perto, não aparece.

type Suggestion = { slug: string; name: string; city: string | null; members: number; match: "cidade" | "estado" };

export function CommunitySuggestions({ city }: { city: string }) {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [joined, setJoined] = useState<Record<string, "ok" | "busy" | "erro">>({});

  useEffect(() => {
    if (!city.trim()) return;
    let alive = true;
    fetch(`/api/communities?perto=1&city=${encodeURIComponent(city)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setList(Array.isArray(d?.communities) ? d.communities.slice(0, 4) : []))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [city]);

  if (!list || list.length === 0) return null;

  async function join(slug: string) {
    setJoined((j) => ({ ...j, [slug]: "busy" }));
    const res = await fetch(`/api/communities/${slug}/members`, { method: "POST" }).catch(() => null);
    setJoined((j) => ({ ...j, [slug]: res?.ok ? "ok" : "erro" }));
  }

  return (
    <section className="flex flex-col gap-3 border-[1.5px] border-line p-5" data-testid="onboarding-communities">
      <div>
        <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">opcional</p>
        <h3 className="mt-1 text-[20px] font-extrabold tracking-[-0.02em]">Comunidades perto de você</h3>
        <p className="mt-1 text-[14.5px] text-muted">Quem entra recebe o aviso quando a comunidade abre um hackathon.</p>
      </div>
      <ul className="border-b border-line">
        {list.map((c) => {
          const st = joined[c.slug];
          return (
            <li key={c.slug} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3">
              <span className="min-w-0">
                <Link href={`/comunidade/${c.slug}`} className="font-bold underline-offset-4 hover:underline">
                  {c.name}
                </Link>
                <span className="block font-mono text-[12.5px] text-muted">
                  {c.city ?? "online"} · {c.members} {c.members === 1 ? "membro" : "membros"}
                </span>
              </span>
              {st === "ok" ? (
                <span className="font-mono text-[13px] text-accent">você entrou</span>
              ) : (
                <button type="button" onClick={() => join(c.slug)} disabled={st === "busy"} className="btn-ghost min-h-[40px]! text-[14px]!">
                  {st === "busy" ? "entrando…" : st === "erro" ? "tentar de novo" : "entrar"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
