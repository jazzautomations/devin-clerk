"use client";

import { useState } from "react";
import type { Member } from "@/lib/members";

export function ProfileForm({ member }: { member: Member }) {
  const [name, setName] = useState(member.name ?? "");
  const [bio, setBio] = useState(member.bio ?? "");
  const [skills, setSkills] = useState(member.skills.join(", "));
  const [github, setGithub] = useState(member.github ?? "");
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
        <span className="font-mono text-xs text-muted">github user</span>
        <input
          className={input}
          value={github}
          onChange={(e) => setGithub(e.target.value)}
          placeholder="teuusuario"
        />
      </label>
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
