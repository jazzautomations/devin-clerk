"use client";

import { useMemo, useState } from "react";

// Editor da programação (painel do organizador): criar, editar, duplicar,
// remover e publicar itens, com visão por dia. Horários em Brasília.

type Option = { value: string; label: string };
type Item = {
  id: number;
  title: string;
  description: string;
  room: string;
  audience: string;
  kind: string;
  published: boolean;
  date: string;
  start: string;
  endDate: string;
  end: string;
};
type Form = Omit<Item, "id" | "published">;

const dayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
const dayLabel = (date: string) => dayFmt.format(new Date(`${date}T12:00:00Z`));
const sortKey = (i: Item) => `${i.date} ${i.start} ${String(i.id).padStart(9, "0")}`;

export function ScheduleEditor({
  hackathonId,
  initialItems,
  defaultDate,
  window: win,
  audiences,
  kinds,
}: {
  hackathonId: string;
  initialItems: Item[];
  defaultDate: string;
  window: { from: string; to: string } | null;
  audiences: Option[];
  kinds: Option[];
}) {
  const blank = (): Form => ({
    title: "",
    description: "",
    room: "",
    audience: "todos",
    kind: "palestra",
    date: defaultDate,
    start: "09:00",
    endDate: defaultDate,
    end: "10:00",
  });
  const [items, setItems] = useState<Item[]>(initialItems);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const base = `/api/admin/hackathons/${hackathonId}/schedule`;
  const days = useMemo(() => {
    const out: { date: string; items: Item[] }[] = [];
    for (const i of [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
      const last = out.at(-1);
      if (last && last.date === i.date) last.items.push(i);
      else out.push({ date: i.date, items: [i] });
    }
    return out;
  }, [items]);
  const drafts = items.filter((i) => !i.published).length;
  const label = (opts: Option[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "error", text: data.error ?? "erro" });
        return null;
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  function startEdit(i: Item | null) {
    setMsg(null);
    if (i) {
      const { id: _id, published: _p, ...f } = i;
      void _id;
      void _p;
      setForm(f);
      setEditing(i.id);
    } else {
      setForm(blank());
      setEditing("new");
    }
  }

  async function save() {
    const isNew = editing === "new";
    const data = await call(isNew ? base : `${base}/${editing}`, isNew ? "POST" : "PATCH", form);
    if (!data) return;
    const item = data.item as Item;
    setItems((prev) => (isNew ? [...prev, item] : prev.map((p) => (p.id === item.id ? item : p))));
    setEditing(null);
    setMsg({
      kind: "ok",
      text: isNew
        ? "item criado como rascunho"
        : data.announcementId
          ? "salvo. Quem é afetado recebe o aviso da mudança."
          : "salvo",
    });
  }

  async function duplicate(i: Item) {
    const data = await call(base, "POST", { duplicateOf: i.id });
    if (!data) return;
    setItems((prev) => [...prev, data.item as Item]);
    setMsg({ kind: "ok", text: "cópia criada como rascunho. Ajuste o dia e a sala e publique." });
  }

  async function remove(i: Item) {
    if (!window.confirm(`Remover "${i.title}"?`)) return;
    if (!(await call(`${base}/${i.id}`, "DELETE"))) return;
    setItems((prev) => prev.filter((p) => p.id !== i.id));
    if (editing === i.id) setEditing(null);
    setMsg({ kind: "ok", text: "item removido" });
  }

  async function publish(ids?: number[]) {
    const data = await call(`${base}/publish`, "POST", ids ? { ids } : {});
    if (!data) return;
    setItems((prev) => prev.map((p) => (!ids || ids.includes(p.id) ? { ...p, published: true } : p)));
    setMsg({ kind: "ok", text: `${data.published} item(ns) publicado(s)` });
  }

  const field =
    "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] text-foreground focus:border-accent focus:outline-none";
  const lab = "font-mono text-[12px] tracking-widest text-muted uppercase";
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const editor = (
    <form
      data-testid="schedule-form"
      className="flex min-w-0 flex-col gap-4 border-[1.5px] border-line bg-mint/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="font-mono text-[12px] tracking-widest uppercase">{editing === "new" ? "novo item" : "editar item"}</p>
      <label className="flex flex-col gap-1.5">
        <span className={lab}>título</span>
        <input className={field} value={form.title} maxLength={140} required onChange={set("title")} placeholder="Abertura e regras" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={lab}>tipo</span>
          <select className={field} value={form.kind} onChange={set("kind")}>
            {kinds.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={lab}>público</span>
          <select className={field} value={form.audience} onChange={set("audience")}>
            {audiences.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <span className={lab}>dia</span>
          <input
            type="date"
            className={field}
            value={form.date}
            min={win?.from}
            max={win?.to}
            required
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, date: v, endDate: f.endDate === f.date ? v : f.endDate }));
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={lab}>início</span>
          <input type="time" className={field} value={form.start} required onChange={set("start")} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={lab}>fim</span>
          <input type="time" className={field} value={form.end} required onChange={set("end")} />
        </label>
        <label className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <span className={lab}>dia do fim</span>
          <input type="date" className={field} value={form.endDate} min={form.date} max={win?.to} onChange={set("endDate")} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={lab}>sala</span>
        <input className={field} value={form.room} maxLength={80} onChange={set("room")} placeholder="Auditório 2" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={lab}>descrição (opcional)</span>
        <textarea className={`${field} min-h-[90px]`} value={form.description} maxLength={2000} onChange={set("description")} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-50">
          {editing === "new" ? "criar rascunho" : "salvar"}
        </button>
        <button type="button" onClick={() => setEditing(null)} className="btn-ghost rounded-[6px]">
          cancelar
        </button>
      </div>
    </form>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => startEdit(null)} className="btn rounded-[6px]">
          + novo item
        </button>
        {drafts > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Publicar ${drafts} rascunho(s)? Aparecem na página e nos calendários.`)) void publish();
            }}
            className="btn-ghost rounded-[6px] disabled:opacity-50"
          >
            publicar {drafts} rascunho{drafts > 1 ? "s" : ""}
          </button>
        )}
        <a href={`/h/${hackathonId}/programacao`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ver página pública ↗
        </a>
      </div>
      {/* região viva sempre no DOM: leitor de tela só anuncia mudança em região que já existia */}
      <p
        role="status"
        className={msg ? `font-mono text-[13px] ${msg.kind === "error" ? "text-orange" : "text-accent"}` : "sr-only"}
      >
        {msg?.text ?? ""}
      </p>
      {editing === "new" && editor}
      {days.length === 0 && editing !== "new" ? (
        <p className="border-[1.5px] border-line px-5 py-5 font-mono text-[13px] text-muted">
          nenhum item ainda. Comece pela abertura, o almoço e o pitch.
        </p>
      ) : (
        days.map((d) => (
          <section key={d.date} className="flex flex-col gap-2" data-testid="admin-schedule-day">
            <h3 className="border-t-2 border-line pt-3 text-[1.25rem] leading-none font-extrabold tracking-[-0.02em] first-letter:uppercase">
              {dayLabel(d.date)}
            </h3>
            <ol className="flex flex-col">
              {d.items.map((i) => (
                <li key={i.id} className="flex flex-col gap-3 border-t border-line py-3" data-testid="admin-schedule-item">
                  <div className="grid grid-cols-[4.2rem_minmax(0,1fr)] gap-3">
                    <p className="font-mono text-[13px] leading-tight">
                      <span className="block font-bold">{i.start}</span>
                      <span className="block text-muted">
                        {i.end}
                        {i.endDate !== i.date ? " +1" : ""}
                      </span>
                    </p>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-[16px] leading-tight font-bold break-words">{i.title}</p>
                      <p className="flex flex-wrap gap-1.5">
                        <span className={`chip bare ${i.published ? "" : "border-orange! text-orange"}`}>
                          {i.published ? "publicado" : "rascunho"}
                        </span>
                        <span className="chip bare">{label(kinds, i.kind)}</span>
                        <span className="chip bare">{label(audiences, i.audience)}</span>
                        {i.room && <span className="chip bare">sala {i.room}</span>}
                      </p>
                      <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1 font-mono text-[12px]">
                        <button type="button" className="text-accent hover:underline" onClick={() => startEdit(i)}>
                          editar
                        </button>
                        <button type="button" className="text-accent hover:underline" onClick={() => duplicate(i)}>
                          duplicar
                        </button>
                        {!i.published && (
                          <button type="button" className="text-accent hover:underline" onClick={() => publish([i.id])}>
                            publicar
                          </button>
                        )}
                        <button type="button" className="text-orange hover:underline" onClick={() => remove(i)}>
                          remover
                        </button>
                      </p>
                    </div>
                  </div>
                  {editing === i.id && editor}
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
