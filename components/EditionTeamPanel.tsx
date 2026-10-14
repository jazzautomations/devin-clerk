"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
// só tipos: lib/roles fala com o banco e não pode entrar no bundle do client
import type { EditionRole, EditionTeamEntry } from "@/lib/roles";

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

type Invite = { email: string; role: EditionRole; createdAt: string };

// spec 033 US7 — o organizador convida por e-mail e tira papel. Depois de
// cada ação o server component recarrega a lista (router.refresh).
export function EditionTeamPanel({
  hackathonId,
  meId,
  roles,
  team,
  invites,
}: {
  hackathonId: string;
  meId: number;
  roles: readonly EditionRole[];
  team: EditionTeamEntry[];
  invites: Invite[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const api = `/api/admin/hackathons/${hackathonId}/roles`;

  async function call(method: "POST" | "DELETE", body: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(api, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "error", text: data?.error ?? "não deu certo, tente de novo" });
      return null;
    }
    router.refresh();
    return data;
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const email = String(f.get("email") ?? "");
    const data = await call("POST", { email, role: f.get("role") });
    if (data) {
      form.reset();
      setMsg({
        kind: "ok",
        text:
          data.result === "granted"
            ? `${email} já tinha conta — o papel vale agora.`
            : `Convite pendente pra ${email}: vale quando a pessoa entrar com esse e-mail.`,
      });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={invite}
        className="grid gap-3 border-[1.5px] border-line p-4 sm:grid-cols-[1fr_180px_auto] sm:items-end sm:p-5"
      >
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[12px] tracking-widest text-muted uppercase">e-mail</span>
          <input name="email" type="email" required className={input} placeholder="pessoa@exemplo.com" />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[12px] tracking-widest text-muted uppercase">papel</span>
          <select name="role" defaultValue="staff" className={input}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-60">
          convidar
        </button>
        {msg && (
          <p
            role="status"
            className={`font-mono text-[13px] sm:col-span-3 ${msg.kind === "ok" ? "text-accent" : "text-orange"}`}
          >
            {msg.text}
          </p>
        )}
      </form>

      <div className="flex flex-col gap-3">
        <h3 className="font-mono text-[12px] tracking-widest text-muted uppercase">
          time ({team.length})
        </h3>
        {team.length === 0 ? (
          <p className="border-[1.5px] border-line px-4 py-5 font-mono text-[13px] text-muted">
            ninguém com papel nesta edição ainda
          </p>
        ) : (
          <ul className="border-b border-line" data-testid="edition-team">
            {team.map((t) => (
              <li
                key={`${t.memberId}-${t.role}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3"
              >
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="truncate font-semibold">{t.name ?? `@${t.username}`}</span>
                  {t.name && <span className="font-mono text-[12px] text-muted">@{t.username}</span>}
                  <span className="chip bare">{t.role}</span>
                </div>
                {!(t.memberId === meId && t.role === "organizador") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => call("DELETE", { memberId: t.memberId, role: t.role })}
                    className="font-mono text-[13px] text-orange underline-offset-4 hover:underline disabled:opacity-60"
                  >
                    remover {t.role}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-mono text-[12px] tracking-widest text-muted uppercase">
          convites pendentes ({invites.length})
        </h3>
        {invites.length === 0 ? (
          <p className="font-mono text-[13px] text-muted">nenhum convite esperando login</p>
        ) : (
          <ul className="border-b border-line">
            {invites.map((i) => (
              <li
                key={`${i.email}-${i.role}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3"
              >
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="min-w-0 font-mono text-[13px] break-all">{i.email}</span>
                  <span className="chip bare">{i.role}</span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => call("DELETE", { email: i.email, role: i.role })}
                  className="font-mono text-[13px] text-orange underline-offset-4 hover:underline disabled:opacity-60"
                >
                  cancelar convite
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
