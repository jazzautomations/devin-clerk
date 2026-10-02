"use client";

import { useState } from "react";
import type { Member } from "@/lib/members";
import { OPEN_TO } from "@/lib/openTo";

export function ProfileForm({
  member,
  openTo: initialOpenTo = [],
}: {
  member: Member;
  openTo?: string[];
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
  const [persona, setPersona] = useState(member.persona ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

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
        persona,
        openTo,
        skills: skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    setStatus(res.ok ? "saved" : "error");
  }

  const input =
    "w-full border border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 focus:border-accent/50 focus:outline-none";

  return (
    <div className="flex flex-col gap-4 border border-line bg-surface p-6">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">nome</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
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
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          quem tu é no ecossistema
        </span>
        <select
          className={input}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        >
          <option value="">escolhe…</option>
          <option value="dev">dev</option>
          <option value="empreendedor">empreendedor</option>
          <option value="investidor">investidor</option>
          <option value="professor">professor</option>
          <option value="marca">marca / empresa</option>
          <option value="mentor">mentor</option>
          <option value="estudante">estudante</option>
          <option value="organizador">organizador</option>
        </select>
      </label>
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
                className={`border px-3 py-1.5 font-mono text-xs transition ${
                  on
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-line text-muted hover:text-foreground"
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
      <button
        onClick={save}
        disabled={status === "saving"}
        className="mt-2 w-fit bg-accent px-5 py-2 font-mono text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
      >
        {status === "saving"
          ? "salvando…"
          : status === "saved"
            ? "✓ salvo"
            : "salvar perfil"}
      </button>
      {status === "error" && (
        <p className="font-mono text-xs text-red-400">
          {"// erro ao salvar — tenta de novo"}
        </p>
      )}
    </div>
  );
}
