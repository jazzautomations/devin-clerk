"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
// só tipos: lib/checkins fala com o banco e não pode entrar no bundle do client
import type { CheckinCounts, RegistrantHit } from "@/lib/checkins";
import type { WaitlistHit } from "@/lib/walkin";
import {
  applySyncResults,
  checkInOffline,
  isOfflinePack,
  localCheckedInAt,
  mergeIntoPack,
  type LocalResult,
  type OfflinePack,
  type PackEntry,
  type QueuedCheckin,
  type SyncItemResult,
} from "@/lib/offlineCheckin";
import { readLocal, useLocalStore, useOnline, writeLocal } from "@/components/useLocalStore";

// spec 033 US4 — mesa de check-in do staff. Lê o QR pela câmera do celular
// (BarcodeDetector nativo quando existe; senão jsQR num canvas, carregado
// só quando precisa) e tem busca manual pra quando a câmera não ajuda.
// Modo offline (roadmap 037 #5): com o pacote baixado, sem rede a leitura
// valida no aparelho (lib/offlineCheckin), vai pra uma fila local e sobe em
// lote quando a rede volta. Walk-in puxa alguém da fila de espera na hora.

type Feedback = { kind: "ok" | "already" | "error"; text: string };

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const fmt = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
/** "YYYY-MM-DD HH:MM:SS" (UTC do banco) ou ISO → "14:05" */
const hhmm = (at: string) => fmt.format(new Date(at.includes("T") ? at : at.replace(" ", "T") + "Z"));

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

const STATUS_LABEL: Record<RegistrantHit["status"], string> = {
  approved: "aprovado",
  pending: "pendente",
  rejected: "recusado",
  waitlist: "fila de espera",
};

const SYNC_BATCH = 200;

function localMessage(r: LocalResult): Feedback {
  switch (r.kind) {
    case "ok":
      return { kind: "ok", text: `Check-in offline: ${r.entry.name} às ${hhmm(r.at)} (sobe quando a rede voltar).` };
    case "already":
      return { kind: "already", text: `${r.entry.name} já fez check-in às ${hhmm(r.at)}.` };
    case "blocked":
      return { kind: "error", text: `${r.entry.name}: ${STATUS_LABEL[r.entry.status]} — entrada não liberada.` };
    case "unknown":
      return {
        kind: "error",
        text: "Ingresso não está no pacote offline (outra edição, ou inscrição depois do download).",
      };
    case "invalid":
      return { kind: "error", text: "Isso não é um ingresso do HackaHub." };
  }
}

export function CheckinDesk({
  hackathonId,
  initialCounts,
  canManage = false,
}: {
  hackathonId: string;
  initialCounts: CheckinCounts;
  /** organizador: pode reenviar o e-mail do ingresso */
  canManage?: boolean;
}) {
  const router = useRouter();
  const api = `/api/admin/hackathons/${hackathonId}/checkin`;
  const packKey = `hh-checkin-pack:${hackathonId}`;
  const queueKey = `hh-checkin-queue:${hackathonId}`;
  const [storedPack, setPack] = useLocalStore<OfflinePack>(packKey);
  const pack = isOfflinePack(storedPack) ? storedPack : null;
  const [storedQueue] = useLocalStore<QueuedCheckin[]>(queueKey);
  const queue = Array.isArray(storedQueue) ? storedQueue : [];
  const online = useOnline();
  // navigator.onLine diz "online" com Wi-Fi conectado e sem internet: falha
  // de fetch também conta como offline até um fetch dar certo
  const [netDown, setNetDown] = useState(false);
  const offline = !online || netDown;

  const [counts, setCounts] = useState(initialCounts);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RegistrantHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [walkQ, setWalkQ] = useState("");
  const [walkList, setWalkList] = useState<WaitlistHit[] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastRef = useRef<{ text: string; t: number } | null>(null);
  const inFlight = useRef(false);

  // lê pacote e fila do storage NA HORA (não do render): duas leituras
  // seguidas do mesmo QR nunca veem a fila velha
  const submitLocal = useCallback(
    async (body: { token: string } | { registrationId: number }): Promise<boolean> => {
      const pk = readLocal<OfflinePack>(packKey);
      if (!isOfflinePack(pk)) return false;
      const cur = readLocal<QueuedCheckin[]>(queueKey) ?? [];
      const by = "token" in body ? { token: body.token } : { rid: body.registrationId };
      const { result, queue: next } = await checkInOffline(pk, cur, by);
      if (next !== cur) writeLocal(queueKey, next);
      setFeedback(localMessage(result));
      if (result.kind === "ok") navigator.vibrate?.(80);
      else if (result.kind !== "already") navigator.vibrate?.([60, 60, 60]);
      return true;
    },
    [packKey, queueKey],
  );

  const submit = useCallback(
    async (body: { token: string } | { registrationId: number }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        if (!navigator.onLine && (await submitLocal(body))) return;
        const res = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setNetDown(false);
        const data = await res.json().catch(() => null);
        if (res.ok) {
          setFeedback({ kind: data.already ? "already" : "ok", text: data.message });
          if (data.counts) setCounts(data.counts);
          if (!data.already) navigator.vibrate?.(80);
          router.refresh();
        } else {
          setFeedback({ kind: "error", text: data?.error ?? "não deu certo, tente de novo" });
          navigator.vibrate?.([60, 60, 60]);
        }
      } catch {
        setNetDown(true);
        if (!(await submitLocal(body))) {
          setFeedback({ kind: "error", text: "sem conexão — baixe o pacote offline enquanto houver rede" });
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [api, router, submitLocal],
  );

  const syncNow = useCallback(async () => {
    const pending = readLocal<QueuedCheckin[]>(queueKey) ?? [];
    if (pending.length === 0 || !navigator.onLine) return;
    setSyncing(true);
    try {
      const batch = pending.slice(0, SYNC_BATCH);
      const res = await fetch(`${api}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: batch.map((x) => (x.token ? { token: x.token, at: x.at } : { registrationId: x.rid, at: x.at })),
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { results: SyncItemResult[]; counts: CheckinCounts };
      setNetDown(false);
      writeLocal(queueKey, applySyncResults(readLocal<QueuedCheckin[]>(queueKey) ?? [], batch, data.results));
      const pk = readLocal<OfflinePack>(packKey);
      if (isOfflinePack(pk)) writeLocal(packKey, mergeIntoPack(pk, data.results));
      setCounts(data.counts);
      const refused = data.results.filter((r) => !r.ok).length;
      if (refused > 0) {
        setFeedback({
          kind: "error",
          text: `${refused} check-in(s) offline recusado(s) pelo servidor (inscrição mudou ou ingresso inválido).`,
        });
      }
      router.refresh();
    } catch {
      setNetDown(true);
    } finally {
      setSyncing(false);
    }
  }, [api, packKey, queueKey, router]);

  async function downloadPack() {
    setPackBusy(true);
    try {
      const res = await fetch(`${api}/pack`, { cache: "no-store" });
      const data = res.ok ? await res.json().catch(() => null) : null;
      setNetDown(false);
      if (isOfflinePack(data)) {
        setPack(data);
        setFeedback({ kind: "ok", text: `Pacote offline baixado: ${data.entries.length} inscrições.` });
      } else {
        setFeedback({ kind: "error", text: "não consegui baixar o pacote — tente de novo" });
      }
    } catch {
      setNetDown(true);
      setFeedback({ kind: "error", text: "sem conexão — o pacote precisa de rede pra baixar" });
    } finally {
      setPackBusy(false);
    }
  }

  async function loadWalkIns(term: string) {
    const res = await fetch(`${api}/walkin?q=${encodeURIComponent(term)}`).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    setWalkList(data?.results ?? []);
  }

  async function doWalkIn(registrationId: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await fetch(`${api}/walkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setFeedback({ kind: "ok", text: data.message });
        if (data.counts) setCounts(data.counts);
        setWalkList((l) => l?.filter((w) => w.registrationId !== registrationId) ?? null);
        router.refresh();
      } else {
        setFeedback({ kind: "error", text: data?.error ?? "não deu certo, tente de novo" });
      }
    } catch {
      setFeedback({ kind: "error", text: "walk-in precisa de rede (a aprovação é no servidor)" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function resendTicket(registrationId: number) {
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/ticket-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationId }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setFeedback(
      res?.ok
        ? { kind: "ok", text: data?.message ?? "ingresso reenviado" }
        : { kind: "error", text: data?.error ?? "não consegui reenviar agora" },
    );
  }

  // rede voltou → sobe a fila; e tenta de tempos em tempos (Wi-Fi que volta sem evento)
  useEffect(() => {
    const kick = () => void syncNow();
    window.addEventListener("online", kick);
    const id = window.setInterval(kick, 15000);
    return () => {
      window.removeEventListener("online", kick);
      window.clearInterval(id);
    };
  }, [syncNow]);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("este navegador não libera câmera aqui — use a busca manual");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setScanning(true);

      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      const detector = Native ? new Native({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (!streamRef.current) return;
        let text: string | null = null;
        try {
          if (video.readyState >= 2) {
            if (detector) {
              const codes = await detector.detect(video);
              text = codes[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              const w = video.videoWidth;
              const h = video.videoHeight;
              const scale = Math.min(1, 640 / Math.max(w, h));
              canvas.width = Math.round(w * scale);
              canvas.height = Math.round(h * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
          }
        } catch {
          // frame ruim: segue pro próximo
        }
        const now = Date.now();
        const last = lastRef.current;
        // o mesmo QR fica na frente da câmera por vários frames — uma leitura a cada 4s
        if (text && !(last && last.text === text && now - last.t < 4000)) {
          lastRef.current = { text, t: now };
          await submit({ token: text });
        }
        timerRef.current = window.setTimeout(tick, 250);
      };
      tick();
    } catch {
      stop();
      setCameraError("não consegui abrir a câmera — confira a permissão ou use a busca manual");
    }
  }

  // contador ao vivo: outros staffs também estão marcando presença
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch(`${api}?q=`).catch(() => null);
      setNetDown(!res);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (data?.counts) setCounts(data.counts);
    }, 5000);
    return () => window.clearInterval(id);
  }, [api]);

  // busca manual com debounce
  useEffect(() => {
    const term = q.trim();
    const id = window.setTimeout(async () => {
      if (term.length < 2) {
        setResults([]);
        return;
      }
      const res = await fetch(`${api}?q=${encodeURIComponent(term)}`).catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (data) {
        setResults(data.results);
        setCounts(data.counts);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [q, api, feedback]);

  const term = q.trim().toLocaleLowerCase("pt-BR");
  const offlineHits: PackEntry[] =
    offline && pack && term.length >= 2
      ? pack.entries
          .filter(
            (e) =>
              e.name.toLocaleLowerCase("pt-BR").includes(term) ||
              e.username.toLocaleLowerCase("pt-BR").includes(term),
          )
          .slice(0, 20)
      : [];
  const noHits = term.length >= 2 && (offline ? offlineHits.length === 0 : results.length === 0);

  const stats = [
    ["inscritos", counts.inscritos],
    ["aprovados", counts.aprovados],
    ["presentes", counts.presentes],
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-3 border-[1.5px] border-line" data-testid="checkin-counts">
        {stats.map(([label, n]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1 border-line p-3 not-last:border-r-[1.5px] sm:p-5">
            <dt className="truncate font-mono text-[11px] tracking-widest text-muted uppercase sm:text-[12px]">
              {label}
            </dt>
            <dd className={`pix text-3xl sm:text-4xl ${label === "presentes" ? "text-accent" : ""}`}>{n}</dd>
          </div>
        ))}
      </dl>

      <div
        data-testid="offline-bar"
        className={`flex flex-col gap-3 border-[1.5px] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4 ${
          offline ? "border-orange" : "border-line"
        }`}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 font-mono text-[13px] font-bold tracking-widest uppercase">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 ${offline ? "bg-orange" : "bg-accent"}`} />
            <span className={offline ? "text-orange" : "text-accent"} data-testid="net-status">
              {offline ? "offline" : "online"}
            </span>
          </p>
          <p className="font-mono text-[12px] text-muted">
            {pack
              ? `pacote offline de ${hhmm(pack.issuedAt)} · ${pack.entries.length} inscrições`
              : "sem pacote offline — baixe antes do Wi-Fi cair"}
          </p>
          <p
            className={`font-mono text-[12px] ${queue.length ? "font-bold text-orange" : "text-muted"}`}
            data-testid="pending-sync"
          >
            {queue.length} pendente{queue.length === 1 ? "" : "s"} de sincronizar
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadPack}
            disabled={packBusy || !online}
            className="btn-ghost rounded-[6px] disabled:opacity-60"
          >
            {pack ? "atualizar pacote" : "baixar pacote offline"}
          </button>
          {queue.length > 0 && (
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing || !online}
              className="btn rounded-[6px] disabled:opacity-60"
            >
              {syncing ? "sincronizando…" : "sincronizar agora"}
            </button>
          )}
        </div>
      </div>

      <div
        aria-live="polite"
        role="status"
        className={
          feedback
            ? `border-[1.5px] px-4 py-3 text-[16px] font-semibold ${
                feedback.kind === "ok"
                  ? "border-accent bg-mint text-accent-hi"
                  : feedback.kind === "already"
                    ? "border-line bg-chrome text-foreground"
                    : "border-orange text-orange"
              }`
            : "sr-only"
        }
      >
        {feedback?.text ?? ""}
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative aspect-square w-full max-w-[420px] overflow-hidden border-[1.5px] border-line bg-foreground sm:aspect-[4/3]">
          <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${scanning ? "" : "hidden"}`} />
          {!scanning && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center font-mono text-[13px] text-mint">
              aponte a câmera pro QR do ingresso
            </div>
          )}
          {scanning && (
            <div aria-hidden className="pointer-events-none absolute inset-[18%] border-2 border-band" />
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {scanning ? (
            <button type="button" onClick={stop} className="btn-ghost rounded-[6px]">
              parar câmera
            </button>
          ) : (
            <button type="button" onClick={start} className="btn rounded-[6px]">
              abrir câmera
            </button>
          )}
        </div>
        {cameraError && <p className="font-mono text-[13px] text-orange">{cameraError}</p>}
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[12px] tracking-widest text-muted uppercase">
            busca manual — nome, e-mail ou username
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={input}
            placeholder="ex.: beatriz"
            autoComplete="off"
            inputMode="search"
          />
        </label>
        {offlineHits.length > 0 && (
          <ul className="border-b border-line" data-testid="checkin-results-offline">
            {offlineHits.map((e) => {
              const at = localCheckedInAt(e, queue);
              return (
                <li
                  key={e.rid}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{e.name}</span>
                    <span className="truncate font-mono text-[12px] text-muted">@{e.username} · pacote offline</span>
                  </div>
                  {at ? (
                    <span className="font-mono text-[13px] text-accent">entrou às {hhmm(at)}</span>
                  ) : e.status === "approved" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit({ registrationId: e.rid })}
                      className="btn rounded-[6px] disabled:opacity-60"
                    >
                      marcar presença
                    </button>
                  ) : (
                    <span className="chip bare text-orange">{STATUS_LABEL[e.status]}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!offline && results.length > 0 && (
          <ul className="border-b border-line" data-testid="checkin-results">
            {results.map((r) => (
              <li
                key={r.registrationId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{r.name ?? `@${r.username}`}</span>
                  <span className="truncate font-mono text-[12px] text-muted">
                    @{r.username} · {r.email}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canManage && r.status === "approved" && (
                    <button
                      type="button"
                      onClick={() => void resendTicket(r.registrationId)}
                      className="btn-ghost rounded-[6px]"
                    >
                      reenviar ingresso
                    </button>
                  )}
                  {r.checkedInAt ? (
                    <span className="font-mono text-[13px] text-accent">entrou às {hhmm(r.checkedInAt)}</span>
                  ) : r.status === "approved" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit({ registrationId: r.registrationId })}
                      className="btn rounded-[6px] disabled:opacity-60"
                    >
                      marcar presença
                    </button>
                  ) : (
                    <span className="chip bare text-orange">{STATUS_LABEL[r.status]}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {noHits && (
          <p className="font-mono text-[13px] text-muted">
            {offline && !pack ? "sem rede e sem pacote offline" : "ninguém inscrito com esse termo"}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3" data-testid="walkin">
        <h3 className="font-mono text-[12px] tracking-widest text-muted uppercase">walk-in — fila de espera na porta</h3>
        <p className="text-[14px] text-muted">
          Aprova e faz o check-in na hora se a sala ainda tem lugar (presentes abaixo da capacidade). Precisa de rede.
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void loadWalkIns(walkQ);
          }}
        >
          <input
            value={walkQ}
            onChange={(e) => setWalkQ(e.target.value)}
            className={input}
            placeholder="nome ou username (vazio = toda a fila)"
            autoComplete="off"
            inputMode="search"
            aria-label="buscar na fila de espera"
          />
          <button type="submit" disabled={offline} className="btn-ghost shrink-0 rounded-[6px] disabled:opacity-60">
            ver fila
          </button>
        </form>
        {walkList && walkList.length === 0 && (
          <p className="font-mono text-[13px] text-muted">ninguém na fila de espera com esse termo</p>
        )}
        {walkList && walkList.length > 0 && (
          <ul className="border-b border-line" data-testid="walkin-results">
            {walkList.map((w) => (
              <li
                key={w.registrationId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{w.name ?? `@${w.username}`}</span>
                  <span className="truncate font-mono text-[12px] text-muted">
                    @{w.username} · {STATUS_LABEL[w.status]}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy || offline}
                  onClick={() => void doWalkIn(w.registrationId)}
                  className="btn rounded-[6px] disabled:opacity-60"
                >
                  aprovar + check-in
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
