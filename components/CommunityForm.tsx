"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Criar (POST /api/communities) e editar (PATCH /api/communities/[slug]) a
// comunidade. O endereço só aparece na criação: depois de divulgado, não muda.

type Values = {
  name: string;
  slug: string;
  description: string;
  city: string;
  online: boolean;
  website: string;
  instagram: string;
  linkedin: string;
  discord: string;
  groupUrl: string;
  logoUrl: string;
  coverUrl: string;
};

const EMPTY: Values = {
  name: "",
  slug: "",
  description: "",
  city: "",
  online: false,
  website: "",
  instagram: "",
  linkedin: "",
  discord: "",
  groupUrl: "",
  logoUrl: "",
  coverUrl: "",
};

const label = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";
const input =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none";

function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

const LINKS: { k: keyof Values; label: string; ph: string }[] = [
  { k: "website", label: "site", ph: "https://suacomunidade.com.br" },
  { k: "instagram", label: "Instagram", ph: "https://instagram.com/suacomunidade" },
  { k: "linkedin", label: "LinkedIn", ph: "https://linkedin.com/company/suacomunidade" },
  { k: "discord", label: "Discord", ph: "https://discord.gg/..." },
  { k: "groupUrl", label: "grupo (WhatsApp, Telegram)", ph: "https://chat.whatsapp.com/..." },
];

export function CommunityForm({ initial, slug }: { initial?: Partial<Values>; slug?: string }) {
  const router = useRouter();
  const editing = !!slug;
  const [v, setV] = useState<Values>({ ...EMPTY, ...initial });
  const [slugTouched, setSlugTouched] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Values>(k: K, val: Values[K]) => {
    setSaved(false);
    setV((o) => ({ ...o, [k]: val, ...(k === "name" && !slugTouched ? { slug: slugify(String(val)) } : {}) }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: v.name,
      description: v.description,
      city: v.city,
      online: v.online,
      website: v.website,
      instagram: v.instagram,
      linkedin: v.linkedin,
      discord: v.discord,
      groupUrl: v.groupUrl,
      logoUrl: v.logoUrl,
      coverUrl: v.coverUrl,
    };
    if (!editing) body.slug = v.slug;
    try {
      const res = await fetch(editing ? `/api/communities/${slug}` : "/api/communities", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(userMessage(res, data, "Não deu pra salvar. Tente de novo."));
        return;
      }
      if (editing) {
        setSaved(true);
        router.refresh();
      } else {
        router.push(`/comunidade/${data.community.slug}?criada=1`);
      }
    } catch {
      setError("Sem conexão. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" data-testid="community-form">
      <label className="flex flex-col gap-1.5">
        <span className={label}>nome da comunidade</span>
        <input
          className={input}
          required
          minLength={3}
          maxLength={60}
          value={v.name}
          placeholder="Hack Club Sorocaba"
          onChange={(e) => set("name", e.target.value)}
        />
      </label>
      {!editing && (
        <label className="flex flex-col gap-1.5">
          <span className={label}>endereço da página</span>
          <span className="flex min-w-0 items-stretch">
            <span className="flex items-center rounded-l-[6px] border-[1.5px] border-r-0 border-line bg-mint px-3 font-mono text-[13px] whitespace-nowrap text-muted">
              /comunidade/
            </span>
            <input
              className={`${input} min-w-0 rounded-l-none font-mono`}
              required
              pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
              title="de 3 a 40 letras minúsculas, números ou hífen"
              value={v.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value.toLowerCase());
              }}
            />
          </span>
          <span className="font-mono text-[12px] text-muted">não muda depois que a comunidade é criada</span>
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className={label}>em uma frase, o que vocês fazem</span>
        <textarea
          className={`${input} resize-none`}
          rows={3}
          maxLength={280}
          value={v.description}
          placeholder="Hackathons de fim de semana com estudantes de computação e design da região."
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className={label}>cidade / UF</span>
          <input
            className={input}
            maxLength={60}
            value={v.city}
            placeholder="Sorocaba, SP"
            onChange={(e) => set("city", e.target.value)}
            autoComplete="address-level2"
          />
        </label>
        <label className="flex min-h-[46px] items-center gap-2.5 text-[15px] font-semibold">
          <input
            type="checkbox"
            checked={v.online}
            onChange={(e) => set("online", e.target.checked)}
            className="h-5 w-5 accent-[#047a43]"
          />
          a comunidade é online
        </label>
      </div>

      <details open={editing} className="group border-t border-line pt-4">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between font-mono text-[13px] text-accent">
          links e imagens (opcional)
          <span aria-hidden className="group-open:rotate-45">+</span>
        </summary>
        <div className="mt-3 flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className={label}>onde encontrar vocês</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {LINKS.map((l) => (
            <label key={l.k} className="flex flex-col gap-1.5">
              <span className="text-[14px] font-semibold">{l.label}</span>
              <input
                className={input}
                type="url"
                inputMode="url"
                maxLength={300}
                value={String(v[l.k])}
                placeholder={l.ph}
                onChange={(e) => set(l.k, e.target.value)}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-line pt-5">
        <legend className={label}>imagens (link https)</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-semibold">logo (quadrado)</span>
            <input
              className={input}
              type="url"
              maxLength={300}
              value={v.logoUrl}
              placeholder="https://..."
              onChange={(e) => set("logoUrl", e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-semibold">capa (larga)</span>
            <input
              className={input}
              type="url"
              maxLength={300}
              value={v.coverUrl}
              placeholder="https://..."
              onChange={(e) => set("coverUrl", e.target.value)}
            />
          </label>
        </div>
      </fieldset>
        </div>
      </details>

      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="font-mono text-[13px] text-accent">
          salvo.
        </p>
      )}
      <div className="flex flex-col gap-3 border-t-2 border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-[12px] text-muted">
          {editing ? "o que você mudar aparece na página na hora." : "você vira dono da comunidade e pode chamar quem organiza junto."}
        </p>
        <button type="submit" disabled={saving} className="btn w-full sm:w-auto" data-testid="community-submit">
          {saving ? "salvando…" : editing ? "salvar →" : "criar comunidade →"}
        </button>
      </div>
    </form>
  );
}
