"use client";

import Link from "next/link";
import { useState } from "react";
import { MAX_PERSONAS, PERSONAS } from "@/lib/personas";
import { OPEN_TO } from "@/lib/openTo";
import { INTENTS, LIMITS, onboardingNext, type IntentKey } from "@/lib/onboarding";

// spec 039 — /bem-vindo: 3 passos curtos (quem é você, perfil básico,
// links), barra de progresso, voltar e pular. Cada "próximo" grava o passo;
// concluir ou pular marca o onboarding e mostra o próximo passo.

type Initial = {
  name: string;
  headline: string;
  personas: string[];
  intents: string[];
  city: string;
  institution: string;
  course: string;
  github: string;
  linkedin: string;
  openTo: string[];
};

const STEPS = ["quem é você", "teu perfil", "links"] as const;

const label = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";
const input =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

export function OnboardingWizard({
  initial,
  redirectUrl,
  nextEdition,
  helpEdition,
}: {
  initial: Initial;
  redirectUrl: string | null;
  nextEdition: { id: string; name: string } | null;
  helpEdition: { id: string; name: string; kind: "mentor" | "jurado" | "voluntario" } | null;
}) {
  const [step, setStep] = useState(0); // 0..2 passos, 3 = fim
  const [v, setV] = useState<Initial>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Initial>(k: K, val: Initial[K]) => setV((o) => ({ ...o, [k]: val }));
  const toggle = (k: "personas" | "intents" | "openTo", key: string, max?: number) =>
    setV((o) => {
      const cur = o[k];
      if (cur.includes(key)) return { ...o, [k]: cur.filter((x) => x !== key) };
      if (max && cur.length >= max) return o;
      return { ...o, [k]: [...cur, key] };
    });

  const payload = (s: number): Record<string, unknown> =>
    s === 0
      ? { personas: v.personas, intents: v.intents }
      : s === 1
        ? { name: v.name, headline: v.headline, city: v.city, institution: v.institution, course: v.course }
        : { github: v.github, linkedin: v.linkedin, openTo: v.openTo };

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      const data = await res.json().catch(() => null);
      setError(typeof data?.error === "string" ? data.error : "não deu pra salvar; tenta de novo");
      return false;
    } catch {
      setError("sem conexão; tenta de novo");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    const last = step === STEPS.length - 1;
    if (await send({ ...payload(step), ...(last ? { finish: true } : {}) })) setStep(step + 1);
  }

  async function skip() {
    if (await send({ finish: true })) setStep(STEPS.length);
  }

  if (step === STEPS.length) {
    const n = onboardingNext({ intents: v.intents as IntentKey[], redirectUrl, nextEdition, helpEdition });
    return (
      <section className="flex flex-col gap-6" data-testid="onboarding-done" aria-live="polite">
        <div className="border-2 border-line bg-foreground p-6 text-background sm:p-8">
          <p className="font-mono text-[12px] tracking-[0.06em] text-band uppercase">teu próximo passo</p>
          <h2 className="mt-2 text-[clamp(1.8rem,5vw,2.6rem)] leading-[1] font-extrabold tracking-[-0.035em]">{n.title}</h2>
          <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-[#b8cdc0]">{n.detail}</p>
          <Link href={n.href} className="btn-go mt-6 w-full sm:w-auto" data-testid="onboarding-next">
            {n.label} →
          </Link>
        </div>
        <p className="font-mono text-[13px] text-muted">
          dá pra mudar tudo depois em{" "}
          <Link href="/perfil" className="text-accent underline underline-offset-4">
            editar perfil
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-7" aria-labelledby="onb-step-title">
      {/* progresso */}
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[12px] text-muted">
          passo {step + 1} de {STEPS.length} · <span className="text-accent">{STEPS[step]}</span>
        </p>
        <ol className="grid grid-cols-3 gap-1.5" aria-label="progresso do onboarding">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined}>
              <span className={`block h-[4px] ${i < step ? "bg-accent" : i === step ? "bg-foreground" : "bg-chrome"}`} />
              <span className="sr-only">
                {s}
                {i < step ? " (feito)" : i === step ? " (agora)" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-7">
          <h2 id="onb-step-title" className="text-[clamp(1.7rem,5vw,2.4rem)] leading-[1] font-extrabold tracking-[-0.035em]">
            Quem é você por aqui?
          </h2>
          <fieldset className="flex flex-col gap-3">
            <legend className={label}>escolhe até {MAX_PERSONAS}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {PERSONAS.map((p) => {
                const on = v.personas.includes(p.key);
                const full = !on && v.personas.length >= MAX_PERSONAS;
                return (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={on}
                    disabled={full}
                    onClick={() => toggle("personas", p.key, MAX_PERSONAS)}
                    className={`rounded-[6px] border-[1.5px] px-3 py-2 text-[14px] font-medium ${
                      on ? "border-foreground bg-foreground text-band" : "border-line hover:bg-mint disabled:opacity-40"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className={label}>o que tu quer aqui? (pode marcar mais de um)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {INTENTS.map((it) => {
                const on = v.intents.includes(it.key);
                return (
                  <button
                    key={it.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle("intents", it.key)}
                    className={`flex items-center gap-3 rounded-[6px] border-[1.5px] px-4 py-3 text-left text-[15px] font-semibold ${
                      on ? "border-accent bg-mint" : "border-line hover:bg-mint"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-5 w-5 shrink-0 place-items-center border-[1.5px] font-mono text-[13px] ${
                        on ? "border-accent bg-accent text-background" : "border-line"
                      }`}
                    >
                      {on ? "✓" : ""}
                    </span>
                    {it.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-5">
          <h2 id="onb-step-title" className="text-[clamp(1.7rem,5vw,2.4rem)] leading-[1] font-extrabold tracking-[-0.035em]">
            O básico do teu perfil
          </h2>
          <p className="-mt-2 text-[14.5px] text-muted">A foto vem da tua conta. Só o nome aparece de cara; o resto é opcional.</p>
          <label className="flex flex-col gap-1.5">
            <span className={label}>nome de exibição</span>
            <input className={input} value={v.name} maxLength={LIMITS.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>headline (opcional)</span>
            <input
              className={input}
              value={v.headline}
              maxLength={LIMITS.headline}
              placeholder="dev front · estudante de design · founder de healthtech"
              onChange={(e) => set("headline", e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>cidade / UF (opcional)</span>
            <input
              className={input}
              value={v.city}
              maxLength={LIMITS.city}
              placeholder="Sorocaba, SP"
              onChange={(e) => set("city", e.target.value)}
              autoComplete="address-level2"
            />
          </label>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={label}>instituição (opcional)</span>
              <input
                className={input}
                value={v.institution}
                maxLength={LIMITS.institution}
                placeholder="universidade, escola, empresa"
                onChange={(e) => set("institution", e.target.value)}
                autoComplete="organization"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={label}>curso (opcional)</span>
              <input className={input} value={v.course} maxLength={LIMITS.course} onChange={(e) => set("course", e.target.value)} />
            </label>
          </div>
          <p className="font-mono text-[12px] text-muted">instituição e curso ajudam a emitir hora complementar.</p>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-5">
          <h2 id="onb-step-title" className="text-[clamp(1.7rem,5vw,2.4rem)] leading-[1] font-extrabold tracking-[-0.035em]">
            Onde acham teu trabalho
          </h2>
          <label className="flex flex-col gap-1.5">
            <span className={label}>GitHub (opcional)</span>
            <input className={input} value={v.github} placeholder="teuusuario ou github.com/teuusuario" onChange={(e) => set("github", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>LinkedIn (opcional)</span>
            <input className={input} value={v.linkedin} placeholder="in/teuusuario ou o link do perfil" onChange={(e) => set("linkedin", e.target.value)} />
          </label>
          <fieldset className="flex flex-col gap-2 border-t border-line pt-5">
            <legend className={label}>diretório de talentos (opcional)</legend>
            <p className="text-[14.5px] text-muted">
              Marca o que te interessa pra aparecer em /talento, onde marcas procuram gente. Nada marcado, tu fica fora.
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {OPEN_TO.map((o) => {
                const on = v.openTo.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle("openTo", o)}
                    className={`rounded-[6px] border-[1.5px] px-3 py-2 text-[14px] font-medium ${
                      on ? "border-foreground bg-foreground text-band" : "border-line hover:bg-mint"
                    }`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}

      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 border-t-2 border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="font-mono text-[13px] underline-offset-4 hover:underline">
              ← voltar
            </button>
          )}
          <button type="button" onClick={skip} disabled={saving} className="font-mono text-[13px] text-muted underline-offset-4 hover:underline">
            pular por agora
          </button>
        </div>
        <button type="button" onClick={next} disabled={saving} className="btn w-full sm:w-auto" data-testid="onboarding-continue">
          {saving ? "salvando…" : step === STEPS.length - 1 ? "concluir →" : "próximo →"}
        </button>
      </div>
    </section>
  );
}
