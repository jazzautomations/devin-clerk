"use client";

import { MAX_PERSONAS, PERSONAS } from "@/lib/personas";
import { useState } from "react";
import type { Member } from "@/lib/members";
import { OPEN_TO } from "@/lib/openTo";
import { formatBrPhone } from "@/lib/notify/phone";

export function ProfileForm({
  member,
  openTo: initialOpenTo = [],
  contact,
}: {
  member: Member;
  openTo?: string[];
  contact?: { phone: string | null; whatsappOptIn: boolean };
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
        skills: skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(typeof data.error === "string" ? data.error : null);
    }
    setStatus(res.ok ? "saved" : "error");
  }

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
          <span className="font-mono text-xs text-muted">instituição</span>
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
          quem tu é no ecossistema — até {MAX_PERSONAS}, o primeiro é o principal
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
          open to — como empresas podem te chamar (te lista em /talento)
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
                {v}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          headline — título @ empresa (aparece no wall da comunidade)
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
            placeholder="teuusuario"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">linkedin</span>
          <input
            className={input}
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="in/teuusuario"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">twitter / x</span>
          <input
            className={input}
            value={twitter}
            onChange={(e) => setTwitter(e.target.value)}
            placeholder="@teuusuario"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted">site pessoal</span>
          <input
            className={input}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="teusite.dev"
          />
        </label>
      </div>
      {/* spec 033 FR-010 — telefone + opt-in de WhatsApp, separado do e-mail */}
      <fieldset id="contato" className="flex scroll-mt-24 flex-col gap-3 border-t border-line pt-4">
        <legend className="sr-only">contato para avisos</legend>
        <span className="font-mono text-xs text-muted">
          avisos das edições — chegam sempre no app e no teu e-mail
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
            Quero receber os avisos das edições em que estou inscrito também pelo WhatsApp,
            em mensagem individual (nunca grupo). Dá pra desmarcar quando quiser.
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
        <p className="font-mono text-xs text-orange">
          {errorMsg ?? "erro ao salvar — tenta de novo"}
        </p>
      )}
    </div>
  );
}
