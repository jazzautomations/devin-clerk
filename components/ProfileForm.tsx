"use client";

import { MAX_PERSONAS, PERSONAS } from "@/lib/personas";
import { useState } from "react";
import type { Member } from "@/lib/members";
import { OPEN_TO, openToLabel } from "@/lib/openTo";
import { formatBrPhone } from "@/lib/notify/phone";
import type { ChannelsEnabled } from "@/lib/notify/reach";
import { userMessage } from "@/lib/apiError";
import { AREA_KEYS, MAX_AREAS, areaLabel } from "@/lib/areas";
// só o vocabulário puro: lib/recados fala com o banco e não pode entrar no bundle
import type { RecadosFrom } from "@/lib/recadosText";

// Perfil (spec 039 + perfil rico, migration 041): cidade e faculdade,
// "posso ajudar com" / "quero ajuda com" (chips de lib/areas), projetos
// fixados (até 3), perfil aberto pra quem não tem conta e quem pode deixar
// recado. A validação de verdade mora na API (PATCH /api/members/me).

const RECADOS_LABEL: Record<RecadosFrom, string> = {
  conexoes: "quem tem laço comigo (time, edição, comunidade, seguir mútuo)",
  todos: "qualquer pessoa do HackaHub",
  ninguem: "ninguém",
};
const RECADOS_ORDER: RecadosFrom[] = ["conexoes", "todos", "ninguem"];

export function ProfileForm({
  member,
  openTo: initialOpenTo = [],
  contact,
  channels = { email: false, whatsapp: false },
  projects = [],
  pins: initialPins = [],
}: {
  member: Member;
  openTo?: string[];
  contact?: { phone: string | null; whatsappOptIn: boolean };
  /** canais que saem de verdade neste ambiente: a copy só promete o que existe */
  channels?: ChannelsEnabled;
  /** meus projetos (time + título) pra escolher os fixados */
  projects?: { teamId: number; label: string }[];
  pins?: number[];
}) {
  const [name, setName] = useState(member.name ?? "");
  const [openTo, setOpenTo] = useState<string[]>(initialOpenTo);
  const [bio, setBio] = useState(member.bio ?? "");
  const [skills, setSkills] = useState(member.skills.join(", "));
  const [github, setGithub] = useState(member.github ?? "");
  const [linkedin, setLinkedin] = useState(member.linkedin ?? "");
  const [twitter, setTwitter] = useState(member.twitter ?? "");
  const [website, setWebsite] = useState(member.website ?? "");
  const [headline, setHeadline] = useState(member.headline ?? "");
  const [city, setCity] = useState(member.city ?? "");
  const [institution, setInstitution] = useState(member.institution ?? "");
  const [course, setCourse] = useState(member.course ?? "");
  const [personas, setPersonas] = useState<string[]>(
    member.personas.length ? member.personas : member.persona ? [member.persona] : [],
  );
  const [phone, setPhone] = useState(contact?.phone ? formatBrPhone(contact.phone) : "");
  const [whatsappOptIn, setWhatsappOptIn] = useState(contact?.whatsappOptIn ?? false);
  const [helpOffer, setHelpOffer] = useState<string[]>(member.helpOffer ?? []);
  const [helpWant, setHelpWant] = useState<string[]>(member.helpWant ?? []);
  const [publicProfile, setPublicProfile] = useState(member.publicProfile === 1);
  const [recadosFrom, setRecadosFrom] = useState<RecadosFrom>(member.recadosFrom ?? "conexoes");
  const [pins, setPins] = useState<number[]>(initialPins);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function save() {
    setStatus("saving");
    const res = await fetch("/api/members/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        bio,
        github,
        linkedin,
        twitter,
        website,
        headline,
        city,
        institution,
        course,
        personas,
        openTo,
        phone,
        whatsappOptIn,
        helpOffer,
        helpWant,
        publicProfile,
        recadosFrom,
        pins,
        skills: skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(userMessage(res, data, "não deu pra salvar. Tente de novo."));
    }
    setStatus(res.ok ? "saved" : "error");
  }

  // chip de área: oferece e quer são listas independentes, até MAX_AREAS cada
  const areaChips = (keys: string[], setKeys: (next: string[]) => void, label: string, testId: string) => (
    <fieldset className="flex flex-col gap-1.5" data-testid={testId}>
      <legend className="font-mono text-xs text-muted">
        {label}: até {MAX_AREAS}
      </legend>
      <div className="flex flex-wrap gap-2">
        {AREA_KEYS.map((k) => {
          const on = keys.includes(k);
          const full = !on && keys.length >= MAX_AREAS;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              disabled={full}
              onClick={() => setKeys(on ? keys.filter((x) => x !== k) : [...keys, k])}
              className={`min-h-[44px] border-[1.5px] px-2.5 font-mono text-[12px] disabled:opacity-40 ${
                on ? "border-accent bg-mint text-accent" : "border-line text-foreground hover:border-accent"
              }`}
            >
              {areaLabel(k)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );

  const input =
    "w-full border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

  return (
    <div className="flex flex-col gap-4 border border-line bg-surface p-6">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">nome</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">cidade / UF</span>
          <input className={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sorocaba, SP" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">faculdade</span>
          <input className={input} value={institution} onChange={(e) => setInstitution(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">curso</span>
          <input className={input} value={course} onChange={(e) => setCourse(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">bio</span>
        <textarea
          className={input}
          rows={3}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          skills (separadas por vírgula)
        </span>
        <input
          className={input}
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="typescript, react, solidity"
        />
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          quem você é no ecossistema: até {MAX_PERSONAS}, o primeiro é o principal
        </span>
        <div className="flex flex-wrap gap-2">
          {PERSONAS.map((p) => {
            const on = personas.includes(p.key);
            const full = !on && personas.length >= MAX_PERSONAS;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() =>
                  setPersonas((cur) => (on ? cur.filter((k) => k !== p.key) : [...cur, p.key]))
                }
                className={`border-[1.5px] px-2.5 py-1 font-mono text-[12px] disabled:opacity-40 ${
                  on ? "border-accent bg-mint text-accent" : "border-line text-foreground hover:border-accent"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          disponível para: como empresas podem chamar você (aparece em /talento)
        </span>
        <div className="flex flex-wrap gap-2">
          {OPEN_TO.map((v) => {
            const on = openTo.includes(v);
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setOpenTo(
                    on ? openTo.filter((x) => x !== v) : [...openTo, v],
                  )
                }
                className={`border-[1.5px] px-3 py-1.5 font-mono text-[13px] transition ${
                  on
                    ? "border-line bg-foreground text-band"
                    : "border-line text-foreground hover:bg-mint"
                }`}
              >
                {openToLabel(v)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          título: cargo @ empresa (aparece no seu perfil e em /membros)
        </span>
        <input
          className={input}
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="engenheiro de software @ empresa"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">github</span>
          <input
            className={input}
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            placeholder="seuusuario"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">linkedin</span>
          <input
            className={input}
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="in/seuusuario"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">twitter / x</span>
          <input
            className={input}
            value={twitter}
            onChange={(e) => setTwitter(e.target.value)}
            placeholder="@seuusuario"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">site pessoal</span>
          <input
            className={input}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="seusite.dev"
          />
        </label>
      </div>
      {/* perfil rico (migration 041): áreas de ajuda, fixados, perfil aberto
          e quem pode deixar recado */}
      {areaChips(helpOffer, setHelpOffer, "posso ajudar com", "help-offer")}
      {areaChips(helpWant, setHelpWant, "quero ajuda com", "help-want")}
      {projects.length > 0 && (
        <fieldset className="flex flex-col gap-1.5" data-testid="pins">
          <legend className="font-mono text-xs text-muted">
            projetos fixados: até 3, na ordem do clique (o perfil mostra no topo)
          </legend>
          <div className="flex flex-wrap gap-2">
            {projects.map((p) => {
              const on = pins.includes(p.teamId);
              const full = !on && pins.length >= 3;
              return (
                <button
                  key={p.teamId}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => setPins(on ? pins.filter((id) => id !== p.teamId) : [...pins, p.teamId])}
                  className={`min-h-[44px] max-w-full border-[1.5px] px-2.5 font-mono text-[12px] break-words disabled:opacity-40 ${
                    on ? "border-accent bg-mint text-accent" : "border-line text-foreground hover:border-accent"
                  }`}
                >
                  {on ? `${pins.indexOf(p.teamId) + 1}. ` : ""}
                  {p.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      <label className="flex items-start gap-2.5 text-[14px]" data-testid="public-profile">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--accent)]"
          checked={publicProfile}
          onChange={(e) => setPublicProfile(e.target.checked)}
        />
        <span>
          Perfil aberto: quem não tem conta vê sua trajetória, seus projetos e seus números.
          <span className="mt-1 block font-mono text-[12px] text-muted">
            Sem atividade, sem recado e sem seus links. Dá pra desligar quando quiser.
          </span>
        </span>
      </label>
      <label className="flex flex-col gap-1.5" data-testid="recados-from">
        <span className="font-mono text-xs text-muted">quem pode deixar recado no seu perfil</span>
        <select
          className={input}
          value={recadosFrom}
          onChange={(e) => setRecadosFrom(e.target.value as RecadosFrom)}
        >
          {RECADOS_ORDER.map((v) => (
            <option key={v} value={v}>
              {RECADOS_LABEL[v]}
            </option>
          ))}
        </select>
      </label>
      {/* spec 033 FR-010 — telefone + opt-in de WhatsApp, separado do e-mail */}
      <fieldset id="contato" className="flex scroll-mt-24 flex-col gap-3 border-t border-line pt-4">
        <legend className="sr-only">contato para avisos</legend>
        <span className="font-mono text-xs text-muted">
          {channels.email
            ? "avisos das edições: chegam no sino do HackaHub e no seu e-mail"
            : "avisos das edições: chegam no sino do HackaHub e na página da edição"}
        </span>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">celular com DDD</span>
          <input
            className={input}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 99999-9999"
          />
        </label>
        <label className="flex items-start gap-2.5 text-[14px]">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--accent)]"
            checked={whatsappOptIn}
            onChange={(e) => setWhatsappOptIn(e.target.checked)}
          />
          <span>
            Quero receber os avisos das edições em que tenho inscrição também pelo WhatsApp,
            em mensagem individual. Dá pra desmarcar quando quiser.
            {!channels.whatsapp && (
              <span className="mt-1 block font-mono text-[12px] text-muted">
                O envio por WhatsApp ainda não está ligado. Sua escolha fica salva e vale quando ligar.
              </span>
            )}
          </span>
        </label>
      </fieldset>
      <button
        onClick={save}
        disabled={status === "saving"}
        className="mt-2 w-fit border-[1.5px] border-line bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
      >
        {status === "saving"
          ? "salvando…"
          : status === "saved"
            ? "✓ salvo"
            : "salvar perfil"}
      </button>
      {status === "error" && (
        <p role="alert" className="font-mono text-xs text-orange">
          {errorMsg ?? "não deu pra salvar. Tente de novo."}
        </p>
      )}
    </div>
  );
}
