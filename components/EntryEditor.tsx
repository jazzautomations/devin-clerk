"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Entry, EntryFields, EntryLink, EntryStatus } from "@/lib/entries";

// spec 034 — editor da entrega: rascunho com autosave ("último salvamento"),
// enviar = versão nova, trava no prazo (o servidor manda; aqui só reflete) e
// a seção "depois do hackathon", que segue aberta e não é julgada.
// Só tipos de lib/entries aqui — o módulo fala com o banco.

const TAGLINE_MAX = 140;
const STATUS_LABEL: Record<EntryStatus, string> = {
  rascunho: "rascunho",
  enviado: "enviado",
  travado: "entregue e travado",
  nao_entregue: "não entregue",
};

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none disabled:opacity-60";
const label = "font-mono text-[12px] text-muted";

type Form = {
  title: string;
  tagline: string;
  description: string;
  repoUrl: string;
  demoUrl: string;
  videoUrl: string;
  slidesUrl: string;
  logoUrl: string;
  priorWork: string;
  technologies: string;
  links: EntryLink[];
  socialPosts: string;
  aiUsage: string;
  challengeIds: string[];
  priorExisted: boolean | null;
  usedAi: boolean | null;
};

function toForm(f: EntryFields | null, rubric: string[]): Form {
  const template = rubric.length > 0 ? rubric.map((r) => `## ${r}\n\n`).join("") : "";
  return {
    title: f?.title ?? "",
    tagline: f?.tagline ?? "",
    description: f?.description ?? template,
    repoUrl: f?.repoUrl ?? "",
    demoUrl: f?.demoUrl ?? "",
    videoUrl: f?.videoUrl ?? "",
    slidesUrl: f?.slidesUrl ?? "",
    logoUrl: f?.logoUrl ?? "",
    priorWork: f?.priorWork ?? "",
    technologies: (f?.technologies ?? []).join(", "),
    links: f?.links ?? [],
    socialPosts: (f?.socialPosts ?? []).join("\n"),
    aiUsage: f?.aiUsage ?? "",
    challengeIds: f?.challengeIds ?? [],
    priorExisted: f?.priorExisted ?? null,
    usedAi: f?.usedAi ?? null,
  };
}

function toPayload(f: Form) {
  return {
    title: f.title,
    tagline: f.tagline,
    description: f.description,
    repoUrl: f.repoUrl,
    demoUrl: f.demoUrl,
    videoUrl: f.videoUrl,
    slidesUrl: f.slidesUrl,
    logoUrl: f.logoUrl,
    priorWork: f.priorWork,
    technologies: f.technologies.split(",").map((s) => s.trim()).filter(Boolean),
    links: f.links.filter((l) => l.url.trim()),
    socialPosts: f.socialPosts.split("\n").map((s) => s.trim()).filter(Boolean),
    aiUsage: f.aiUsage,
    challengeIds: f.challengeIds,
    priorExisted: f.priorExisted,
    usedAi: f.usedAi,
  };
}

const timeOf = (dbText: string | null) => {
  if (!dbText) return "";
  const d = new Date(`${dbText.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(d);
};
const dateTimeOf = (dbText: string | null) => {
  if (!dbText) return "";
  const d = new Date(`${dbText.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  })
    .format(d)
    .replace(",", "");
};

export function EntryEditor({
  hackathonId,
  initial,
  rubric,
  challenges,
  techSuggestions,
}: {
  hackathonId: string;
  initial: Entry;
  rubric: string[];
  challenges: { id: string; title: string; sponsor: string }[];
  techSuggestions: string[];
}) {
  const router = useRouter();
  const [entry, setEntry] = useState(initial);
  const [form, setForm] = useState<Form>(() => toForm(initial.fields, rubric));
  const [afterNotes, setAfterNotes] = useState(initial.afterNotes ?? "");
  const [save, setSave] = useState<"idle" | "pending" | "saving" | "error">("idle");
  const [err, setErr] = useState("");
  const [submitMsg, setSubmitMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);
  const s = entry.settings;
  const locked = entry.locked;

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/hackathons/${hackathonId}/entry`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      router.push("/sign-in");
      return false;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "erro ao salvar");
      return false;
    }
    setEntry(data.entry);
    setErr("");
    return true;
  }

  // autosave: 1,2 s depois da última tecla; sem título não dá pra criar o projeto
  useEffect(() => {
    if (!dirtyRef.current || locked) return;
    if (!form.title.trim()) return;
    const t = setTimeout(async () => {
      setSave("saving");
      const ok = await patch(toPayload(form));
      if (ok) dirtyRef.current = false;
      setSave(ok ? "idle" : "error");
    }, 1200);
    return () => clearTimeout(t);
    // patch muda a cada render; o gatilho é o formulário
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, locked]);

  // sair da página com alteração não salva pede confirmação do navegador
  // (sem título o autosave não roda, então o texto só existe aqui)
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    dirtyRef.current = true;
    setSave("pending");
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (busy || entry.missing.length > 0) return;
    if (!window.confirm(`Enviar a versão ${entry.versions.length + 1}? O júri avalia a última versão enviada até o prazo.`)) return;
    setBusy(true);
    setSubmitMsg("");
    if (dirtyRef.current && form.title.trim()) {
      const ok = await patch(toPayload(form));
      if (!ok) {
        setBusy(false);
        return;
      }
      dirtyRef.current = false;
    }
    const res = await fetch(`/api/hackathons/${hackathonId}/entry`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "erro ao enviar");
      return;
    }
    setEntry(data.entry);
    setErr("");
    setSubmitMsg(`versão ${data.version} enviada — o time recebeu a confirmação`);
    setSave("idle");
    router.refresh();
  }

  async function saveAfter() {
    setBusy(true);
    const ok = await patch({ afterNotes });
    setBusy(false);
    if (ok) setSubmitMsg("\"depois do hackathon\" salvo");
  }

  const techs = toPayload(form).technologies;
  const lastVersion = entry.versions.at(-1);
  const missing = entry.missing;
  const needsTitle = !form.title.trim();
  const statusTone =
    entry.status === "rascunho" || entry.status === "nao_entregue" ? "border-orange text-orange" : "border-accent text-accent";

  return (
    <div data-testid="entry-editor" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 border-[1.5px] border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span data-testid="entry-status" className={`border-[1.5px] px-2 py-1 font-mono text-[12px] uppercase ${statusTone}`}>
            {STATUS_LABEL[entry.status]}
          </span>
          <span className="font-mono text-[12px] text-muted" aria-live="polite">
            {save === "saving"
              ? "salvando…"
              : save === "pending"
                ? "alterações não salvas"
                : save === "error"
                  ? "não salvou — veja o erro abaixo"
                  : entry.lastSavedAt
                    ? `último salvamento ${timeOf(entry.lastSavedAt)}`
                    : "nada salvo ainda"}
          </span>
        </div>
        <p className="text-[14px] text-muted">
          {lastVersion
            ? `Versão ${lastVersion.version} enviada em ${dateTimeOf(lastVersion.submittedAt)}${lastVersion.submittedBy ? ` por @${lastVersion.submittedBy}` : ""}.`
            : "Nada enviado ainda. Rascunho não vai pro júri."}
          {entry.dirty && !locked && lastVersion && " Tem mudança que ainda não foi enviada."}
          {locked && " Prazo encerrado: o projeto está travado."}
          {entry.reopenedUntil && !locked && s.submissionDeadline && entry.reopenedUntil > s.submissionDeadline &&
            ` Reaberto pela organização até ${dateTimeOf(entry.reopenedUntil)}.`}
        </p>
        <p className="font-mono text-[12px] text-muted">
          integrantes: {entry.members.map((u) => `@${u}`).join(" ")} ·{" "}
          <Link href={`/p/${entry.teamId}`} className="text-accent hover:underline">
            ficha pública →
          </Link>
        </p>
      </div>

      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-5">
        <legend className="mb-4 font-mono text-[12px] tracking-widest text-muted uppercase">projeto · avaliado pelo júri</legend>
        <label className="flex flex-col gap-1.5">
          <span className={label}>título *</span>
          <input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={120}
            aria-describedby={needsTitle ? "entry-title-hint" : undefined}
            className={input}
          />
          {needsTitle && (
            <span id="entry-title-hint" className="font-mono text-[12px] text-orange">
              preencha o título pra começar a salvar o rascunho
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>
            tagline * · {form.tagline.length}/{TAGLINE_MAX}
          </span>
          <input
            value={form.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            maxLength={TAGLINE_MAX}
            placeholder="o projeto numa frase"
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>descrição * (markdown; o modelo segue os critérios do júri)</span>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={10}
            maxLength={10000}
            className={`${input} font-mono text-[14px]`}
          />
        </label>
        <YesNo
          name="priorExisted"
          legend="já existia algo do projeto antes do evento?"
          value={form.priorExisted}
          onChange={(v) => set("priorExisted", v)}
        />
        <label className="flex flex-col gap-1.5">
          <span className={label}>
            {form.priorExisted === false
              ? "trabalho anterior (opcional)"
              : "trabalho anterior * — o que já existia antes do evento (ou \"nada\")"}
          </span>
          <textarea
            value={form.priorWork}
            onChange={(e) => set("priorWork", e.target.value)}
            rows={3}
            maxLength={2000}
            className={input}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5">
            <span className={label}>tecnologias * (separadas por vírgula)</span>
            <input
              value={form.technologies}
              onChange={(e) => set("technologies", e.target.value)}
              placeholder="Next.js, Postgres, Whisper"
              className={input}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {techSuggestions
              .filter((t) => !techs.some((x) => x.toLowerCase() === t.toLowerCase()))
              .slice(0, 14)
              .map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("technologies", [...techs, t].join(", "))}
                  className="chip cursor-pointer hover:border-accent hover:text-accent"
                >
                  {t}
                </button>
              ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["repoUrl", `repositório${s.requireRepo ? " *" : ""}`, "https://github.com/…"],
              ["videoUrl", `vídeo do time${s.requireVideo ? " *" : ""} (até 3 min)`, "YouTube, Loom ou Drive"],
              ["demoUrl", "demo / deploy", "https://…"],
              ["slidesUrl", `slides${s.requireSlides ? " *" : ""}`, "https://…"],
              ["logoUrl", "logo (url da imagem)", "https://…/logo.png"],
            ] as const
          ).map(([k, l, ph]) => (
            <label key={k} className="flex min-w-0 flex-col gap-1.5">
              <span className={label}>{l}</span>
              <input value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} className={input} />
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <span className={label}>links com rótulo (até 10)</span>
          {form.links.map((l, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
              <input
                aria-label="rótulo do link"
                value={l.label}
                onChange={(e) => set("links", form.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="figma"
                className={input}
              />
              <input
                aria-label="url do link"
                value={l.url}
                onChange={(e) => set("links", form.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                placeholder="https://…"
                className={input}
              />
              <button
                type="button"
                onClick={() => set("links", form.links.filter((_, j) => j !== i))}
                className="font-mono text-[12px] text-muted hover:text-orange"
                aria-label="remover link"
              >
                remover
              </button>
            </div>
          ))}
          {form.links.length < 10 && (
            <button
              type="button"
              onClick={() => set("links", [...form.links, { label: "", url: "" }])}
              className="w-fit font-mono text-[12px] text-accent hover:underline"
            >
              + link
            </button>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={label}>posts nas redes (um link por linha)</span>
          <textarea
            value={form.socialPosts}
            onChange={(e) => set("socialPosts", e.target.value)}
            rows={2}
            placeholder="https://www.linkedin.com/posts/…"
            className={input}
          />
        </label>
        <YesNo name="usedAi" legend="usou IA no projeto?" value={form.usedAi} onChange={(v) => set("usedAi", v)} />
        <label className="flex flex-col gap-1.5">
          <span className={label}>uso de IA{s.requireAiUsage ? " *" : ""} — como: o que foi feito com IA e onde</span>
          <textarea
            value={form.aiUsage}
            onChange={(e) => set("aiUsage", e.target.value)}
            rows={2}
            maxLength={2000}
            className={input}
          />
        </label>

        {challenges.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className={label}>desafios patrocinados que o time disputa</span>
            {challenges.map((c) => (
              <label key={c.id} className="flex items-start gap-2 text-[15px]">
                <input
                  type="checkbox"
                  checked={form.challengeIds.includes(c.id)}
                  onChange={(e) =>
                    set(
                      "challengeIds",
                      e.target.checked ? [...form.challengeIds, c.id] : form.challengeIds.filter((x) => x !== c.id),
                    )
                  }
                  className="mt-1"
                />
                <span className="min-w-0 break-words">
                  <span className="font-mono text-[12px] text-accent uppercase">{c.sponsor}</span> · {c.title}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {!locked && (
        <div className="flex flex-col gap-3 border-t-2 border-line pt-5">
          {missing.length > 0 && (
            <p id="entry-missing" className="font-mono text-[12px] text-orange">
              falta pra enviar: {missing.join(", ")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy || missing.length > 0}
              aria-describedby={missing.length > 0 ? "entry-missing" : undefined}
              className="btn disabled:opacity-50"
            >
              {busy ? "enviando…" : `enviar versão ${entry.versions.length + 1}`}
            </button>
            <span className="text-[13px] text-muted">dá pra reenviar até o prazo; cada envio vira uma versão</span>
          </div>
          {err && (
            <p role="alert" className="font-mono text-[13px] text-orange">
              {err}
            </p>
          )}
          {submitMsg && <p className="font-mono text-[13px] text-accent">{submitMsg}</p>}
        </div>
      )}

      <section className="flex flex-col gap-3 border-[1.5px] border-line bg-mint p-4">
        <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">depois do hackathon · não é julgado</h2>
        <p className="text-[14px] text-muted">
          O que aconteceu depois: piloto, prêmio, deploy novo, startup. Fica aberto mesmo depois da trava.
        </p>
        <textarea
          aria-label="depois do hackathon"
          value={afterNotes}
          onChange={(e) => setAfterNotes(e.target.value)}
          rows={3}
          maxLength={4000}
          className={input}
        />
        <button type="button" onClick={saveAfter} disabled={busy || !entry.fields} className="btn w-fit disabled:opacity-50">
          salvar
        </button>
        {locked && err && (
          <p role="alert" className="font-mono text-[13px] text-orange">
            {err}
          </p>
        )}
        {locked && submitMsg && <p className="font-mono text-[13px] text-accent">{submitMsg}</p>}
      </section>
    </div>
  );
}

/** sim / não (nenhum marcado = não respondeu) — declaração do time (dossiê, migration 029) */
function YesNo({
  name,
  legend,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const opts: [string, boolean][] = [
    ["sim", true],
    ["não", false],
  ];
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" data-testid={`decl-${name}`}>
      <legend className={`${label} mb-1.5`}>{legend} (opcional)</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {opts.map(([text, v]) => (
          <label key={text} className="flex min-h-[44px] items-center gap-2 text-[15px] sm:min-h-0">
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
