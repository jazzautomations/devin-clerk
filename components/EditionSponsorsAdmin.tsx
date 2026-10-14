"use client";

import Link from "next/link";
import { userMessage } from "@/lib/apiError";
import { useRouter } from "next/navigation";
import { useState } from "react";
// só tipos: lib/editionSponsors fala com o banco e não entra no bundle do client
import type { EditionSponsor, SponsorPerson } from "@/lib/editionSponsors";

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";
const label = "font-mono text-[12px] tracking-widest text-muted uppercase";
const TIERS = [
  { value: "master", text: "master" },
  { value: "sponsor", text: "patrocínio" },
  { value: "apoio", text: "apoio" },
];

export type SponsorAdminRow = EditionSponsor & {
  people: SponsorPerson[];
  invites: { email: string; createdAt: string }[];
  optInUrl: string;
  qrSvg: string;
  optIns: number;
};

type Msg = { kind: "ok" | "error"; text: string } | null;

// roadmap 037 #8/#12 — o organizador cadastra a marca, liga aos desafios,
// convida as pessoas dela e pega o QR do estande. Cada ação recarrega a
// lista do server component (router.refresh).
export function EditionSponsorsAdmin({
  hackathonId,
  sponsors,
  challenges,
  categories,
}: {
  hackathonId: string;
  sponsors: SponsorAdminRow[];
  challenges: { id: string; title: string; sponsorId: string | null }[];
  categories: { id: number; name: string; sponsorId: string | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const base = `/api/admin/hackathons/${hackathonId}/sponsors`;

  async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "error", text: userMessage(res, data, "não deu certo. Tente de novo.") });
      return null;
    }
    router.refresh();
    return data ?? {};
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await call(base, "POST", {
      name: f.get("name"),
      tier: f.get("tier"),
      logoUrl: f.get("logoUrl"),
      url: f.get("url"),
    });
    if (ok) {
      form.reset();
      setMsg({ kind: "ok", text: "Patrocinador cadastrado na edição." });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={add}
        data-testid="sponsor-add"
        className="grid gap-3 border-[1.5px] border-line p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[1.2fr_150px_1fr_1fr_auto] lg:items-end"
      >
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>nome</span>
          <input name="name" required maxLength={80} className={input} placeholder="Marca" />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>nível</span>
          <select name="tier" defaultValue="sponsor" className={input}>
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.text}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>logo (URL)</span>
          <input name="logoUrl" type="url" className={input} placeholder="https://…/logo.png" />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>site</span>
          <input name="url" type="url" className={input} placeholder="https://marca.com.br" />
        </label>
        <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-60">
          cadastrar
        </button>
      </form>
      {/* região sempre montada: leitor de tela só anuncia o que muda dentro dela */}
      <p
        role="status"
        className={msg ? `font-mono text-[13px] ${msg.kind === "ok" ? "text-accent" : "text-orange"}` : "sr-only"}
      >
        {msg?.text ?? ""}
      </p>

      {sponsors.length === 0 ? (
        <p className="border-[1.5px] border-line px-4 py-5 font-mono text-[13px] text-muted">
          nenhum patrocinador nesta edição ainda
        </p>
      ) : (
        <ul className="flex flex-col gap-6" data-testid="sponsor-list">
          {sponsors.map((s) => (
            <SponsorCard
              key={s.sponsorId}
              s={s}
              base={`${base}/${s.sponsorId}`}
              hackathonId={hackathonId}
              challenges={challenges}
              categories={categories}
              busy={busy}
              call={call}
              setMsg={setMsg}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SponsorCard({
  s,
  base,
  hackathonId,
  challenges,
  categories,
  busy,
  call,
  setMsg,
}: {
  s: SponsorAdminRow;
  base: string;
  hackathonId: string;
  challenges: { id: string; title: string; sponsorId: string | null }[];
  categories: { id: number; name: string; sponsorId: string | null }[];
  busy: boolean;
  call: (url: string, method: string, body?: unknown) => Promise<Record<string, unknown> | null>;
  setMsg: (m: Msg) => void;
}) {
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await call(base, "PATCH", {
      tier: f.get("tier"),
      logoUrl: f.get("logoUrl"),
      url: f.get("url"),
      challengeIds: f.getAll("challengeIds").map(String),
      categoryIds: f.getAll("categoryIds").map(Number),
    });
    if (ok) setMsg({ kind: "ok", text: `${s.name}: salvo.` });
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    const data = await call(`${base}/people`, "POST", { email });
    if (data) {
      form.reset();
      setMsg({
        kind: "ok",
        text:
          data.result === "granted"
            ? `${email} já tinha conta — o acesso ao relatório de ${s.name} vale agora.`
            : `Convite pendente pra ${email}: vale quando a pessoa entrar com esse e-mail.`,
      });
    }
  }

  return (
    <li className="window" data-testid="sponsor-card">
      <div className="tbar">
        <span className="title truncate">{s.name}</span>
        <span className="chip bare">{s.tier}</span>
      </div>
      <div className="tbody flex flex-col gap-5 p-4! sm:p-5!">
        <div className="flex flex-wrap items-center gap-4">
          {s.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo remoto da marca; next/image exigiria remotePatterns
            <img src={s.logoUrl} alt={`logo de ${s.name}`} className="h-12 max-w-[160px] object-contain" />
          ) : (
            <span className="font-mono text-[12px] text-muted">sem logo</span>
          )}
          <Link
            href={`/admin/h/${hackathonId}/patrocinador/${s.sponsorId}`}
            className="inline-flex min-h-11 items-center font-mono text-[13px] text-accent-on-chrome underline-offset-4 hover:underline"
          >
            ver relatório →
          </Link>
        </div>

        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[150px_1fr_1fr]">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={label}>nível</span>
              <select name="tier" defaultValue={s.tier} className={input}>
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.text}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={label}>logo (URL)</span>
              <input name="logoUrl" type="url" defaultValue={s.logoUrl ?? ""} className={input} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={label}>site</span>
              <input name="url" type="url" defaultValue={s.url ?? ""} className={input} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className={label}>desafios da marca</legend>
            {challenges.length === 0 ? (
              <p className="font-mono text-[13px] text-muted">a edição ainda não tem desafio</p>
            ) : (
              challenges.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-[14px] break-words">
                  <input
                    type="checkbox"
                    name="challengeIds"
                    value={c.id}
                    defaultChecked={c.sponsorId === s.sponsorId}
                    className="mt-1 accent-[#047a43]"
                  />
                  <span className="min-w-0">{c.title}</span>
                </label>
              ))
            )}
          </fieldset>
          {categories.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className={label}>categorias gerais oferecidas pela marca</legend>
              {categories.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-[14px] break-words">
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={c.id}
                    defaultChecked={c.sponsorId === s.sponsorId}
                    className="mt-1 accent-[#047a43]"
                  />
                  <span className="min-w-0">{c.name}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-60">
              salvar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(`Tirar ${s.name} da edição? Acessos e opt-ins desta edição vão junto.`)) {
                  void call(base, "DELETE");
                }
              }}
              className="min-h-11 font-mono text-[13px] text-orange-on-chrome underline-offset-4 hover:underline disabled:opacity-60"
            >
              tirar da edição
            </button>
          </div>
        </form>

        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-[140px_1fr]">
          <div
            className="w-[140px] border-[1.5px] border-line [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            aria-label={`QR do opt-in de ${s.name}`}
            dangerouslySetInnerHTML={{ __html: s.qrSvg }}
          />
          <div className="flex min-w-0 flex-col gap-2">
            <p className={label}>QR do estande · contato autorizado</p>
            <a href={s.optInUrl} className="font-mono text-[13px] break-all text-accent-on-chrome underline underline-offset-4">
              {s.optInUrl.replace(/^https?:\/\//, "")}
            </a>
            <p className="text-[14px] text-muted">
              {s.optIns === 1 ? "1 pessoa compartilhou" : `${s.optIns} pessoas compartilharam`} o contato com a marca.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <p className={label}>pessoas da marca (veem só este relatório)</p>
          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input name="email" type="email" required className={input} placeholder="pessoa@marca.com.br" />
            <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-60">
              convidar
            </button>
          </form>
          <ul className="border-b border-line">
            {s.people.map((p) => (
              <li key={p.memberId} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
                <span className="min-w-0 truncate">{p.name ?? `@${p.username}`}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void call(`${base}/people`, "DELETE", { memberId: p.memberId })}
                  className="min-h-11 font-mono text-[13px] text-orange-on-chrome underline-offset-4 hover:underline disabled:opacity-60"
                >
                  tirar acesso
                </button>
              </li>
            ))}
            {s.invites.map((i) => (
              <li key={i.email} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
                <span className="min-w-0 font-mono text-[13px] break-all">{i.email} · pendente</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void call(`${base}/people`, "DELETE", { email: i.email })}
                  className="min-h-11 font-mono text-[13px] text-orange-on-chrome underline-offset-4 hover:underline disabled:opacity-60"
                >
                  cancelar convite
                </button>
              </li>
            ))}
            {s.people.length === 0 && s.invites.length === 0 && (
              <li className="border-t border-line py-2 font-mono text-[13px] text-muted">ninguém convidado ainda</li>
            )}
          </ul>
        </div>
      </div>
    </li>
  );
}
