"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
// só tipos: lib/checkins fala com o banco e não pode entrar no bundle do client
import type { CheckinCounts, RegistrantHit } from "@/lib/checkins";

// spec 033 US4 — mesa de check-in do staff. Lê o QR pela câmera do celular
// (BarcodeDetector nativo quando existe; senão jsQR num canvas, carregado
// só quando precisa) e tem busca manual pra quando a câmera não ajuda.

type Feedback = { kind: "ok" | "already" | "error"; text: string };

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const hhmm = (at: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(at.replace(" ", "T") + "Z"));

const input =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";

const STATUS_LABEL: Record<RegistrantHit["status"], string> = {
  approved: "aprovado",
  pending: "pendente",
  rejected: "recusado",
  waitlist: "fila de espera",
};

export function CheckinDesk({
  hackathonId,
  initialCounts,
}: {
  hackathonId: string;
  initialCounts: CheckinCounts;
}) {
  const router = useRouter();
  const api = `/api/admin/hackathons/${hackathonId}/checkin`;
  const [counts, setCounts] = useState(initialCounts);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RegistrantHit[]>([]);
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastRef = useRef<{ text: string; t: number } | null>(null);
  const inFlight = useRef(false);

  const submit = useCallback(
    async (body: { token: string } | { registrationId: number }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const res = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
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
        setFeedback({ kind: "error", text: "sem conexão — tente de novo" });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [api, router],
  );

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
        {results.length > 0 && (
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
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && results.length === 0 && (
          <p className="font-mono text-[13px] text-muted">ninguém inscrito com esse termo</p>
        )}
      </div>
    </div>
  );
}
