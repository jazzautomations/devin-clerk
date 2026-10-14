"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS: { value: string; label: string }[] = [
  { value: "aberto", label: "aberto" },
  { value: "em_andamento", label: "em andamento" },
  { value: "resolvido", label: "resolvido" },
];

// frente L — tratar uma denúncia: status e nota interna (nunca sai no
// export do autor, nem é mostrada a ele)
export function IncidentEditor({
  hackathonId,
  incidentId,
  status: initialStatus,
  note: initialNote,
}: {
  hackathonId: string;
  incidentId: number;
  status: string;
  note: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/hackathons/${hackathonId}/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, internalNote: note }),
      });
      setMsg(res.ok ? "salvo" : "não deu certo");
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-widest text-muted uppercase">status</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm sm:max-w-xs"
        >
          {STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-widest text-muted uppercase">nota interna</span>
        <textarea
          value={note}
          maxLength={4000}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-20 w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px]"
          placeholder="o que foi feito, com quem falou (só a organização vê)"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy} className="btn rounded-[6px] disabled:opacity-50">
          {busy ? "salvando…" : "salvar"}
        </button>
        {msg && <span className="font-mono text-[12px] text-muted">{msg}</span>}
      </div>
    </div>
  );
}

export function ConductHandlerToggle({
  hackathonId,
  memberId,
  label,
  on: initial,
}: {
  hackathonId: string;
  memberId: number;
  label: string;
  on: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/hackathons/${hackathonId}/incidents/handlers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, on: next }),
      });
      if (res.ok) setOn(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex cursor-pointer items-start gap-3 py-2 text-[14px]">
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
        checked={on}
        disabled={busy}
        onChange={(e) => void toggle(e.target.checked)}
      />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
}
