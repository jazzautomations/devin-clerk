"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReportDialog } from "@/components/ReportDialog";
import { readLocal, useLocalStore, useOnline, writeLocal } from "@/components/useLocalStore";
// só tipos: lib/encounters fala com o banco e não entra no bundle do client
import type { ContactChannel, EncounterView, MeetState, PersonCard } from "@/lib/encounters";
import { CARD_KIND_LABEL, CARD_KINDS, cardsOf } from "@/lib/encounterCards";
import { applySyncResults, enqueueRead, isQueuedReads, type QueuedRead } from "@/lib/encounterQueue";
import { userMessage } from "@/lib/apiError";

// Encontros na edição — a parte interativa (spec 046, onda 5).
//
// Ler o código de alguém (câmera ou campo), ver o cartão sem o contato,
// esperar a confirmação da outra pessoa (polling de 10s, só com a aba
// visível), responder "como foi a conversa", marcar "bora fazer junto" e
// pedir a missão. Sem rede, a leitura vai pra uma fila local (mesmo padrão
// do offlineCheckin) e sobe em lote quando a rede volta.

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const DEPTHS = [
  { key: "rapido", label: "papo rápido" },
  { key: "alem", label: "fomos além do oi" },
] as const;

const POLL_MS = 10_000;
const inputCls =
  "w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 font-mono text-sm uppercase tracking-[0.2em] text-foreground placeholder:tracking-normal placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";
const btnGhost =
  "inline-flex min-h-[44px] items-center justify-center rounded-[6px] border-[1.5px] border-line px-3 font-mono text-[13px] transition hover:border-foreground hover:bg-mint";

type Feedback = { kind: "ok" | "error" | "info"; text: string };

export function EncountersClient({
  hackathonId,
  editionName,
  initialState,
  channels,
  initialCode,
}: {
  hackathonId: string;
  editionName: string;
  initialState: MeetState;
  channels: { key: ContactChannel; label: string }[];
  initialCode: string | null;
}) {
  const api = `/api/hackathons/${hackathonId}/encounters`;
  const queueKey = `hh-encontros-fila:${hackathonId}`;
  // o código e o QR saem prontos do servidor: ativar, pausar e gerar outro
  // pedem um render novo da página além do estado do cliente
  const router = useRouter();
  const [state, setState] = useState<MeetState>(initialState);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(initialCode ?? "");
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [storedQueue] = useLocalStore<QueuedRead[]>(queueKey);
  const queue = isQueuedReads(storedQueue) ? storedQueue : [];
  const online = useOnline();
  const [netDown, setNetDown] = useState(false);
  const offline = !online || netDown;
  const [channel, setChannel] = useState<ContactChannel>(initialState.me?.channel ?? "linkedin");
  const [newcomer, setNewcomer] = useState(initialState.me?.newcomerOptIn ?? false);
  const [intro, setIntro] = useState(initialState.me?.introOptIn ?? false);
  const [introPeer, setIntroPeer] = useState("");
  const [introRecipient, setIntroRecipient] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastRef = useRef<{ text: string; seen: number } | null>(null);
  const inFlight = useRef(false);
  const autoTried = useRef(false);

  const refresh = useCallback(async (): Promise<MeetState | null> => {
    const res = await fetch(api, { cache: "no-store" }).catch(() => null);
    setNetDown(!res);
    if (!res || !res.ok) return null;
    const next = (await res.json().catch(() => null)) as MeetState | null;
    if (next) setState(next);
    return next;
  }, [api]);

  const post = useCallback(
    async (path: string, body: unknown, method = "POST") => {
      const res = await fetch(`${api}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      setNetDown(!res);
      const data = res ? await res.json().catch(() => null) : null;
      return { res, data } as { res: Response | null; data: Record<string, unknown> | null };
    },
    [api],
  );

  // fila offline: leitura feita sem rede sobe quando a rede volta
  const syncQueue = useCallback(async () => {
    const pending = readLocal<QueuedRead[]>(queueKey) ?? [];
    if (pending.length === 0 || !navigator.onLine) return;
    const { res, data } = await post("/sync", { items: pending.map((q) => ({ code: q.code })) });
    if (!res || !res.ok || !data) return;
    const results = (data.results ?? []) as { code: string; ok: boolean; message: string }[];
    writeLocal(queueKey, applySyncResults(readLocal<QueuedRead[]>(queueKey) ?? [], results.map((r) => r.code)));
    if (data.state) setState(data.state as MeetState);
    const refused = results.filter((r) => !r.ok);
    setFeedback(
      refused.length > 0
        ? { kind: "error", text: `${refused.length} ${refused.length === 1 ? "leitura não entrou" : "leituras não entraram"}: ${refused[0].message}` }
        : { kind: "ok", text: "As leituras feitas sem rede entraram." },
    );
  }, [post, queueKey]);

  useEffect(() => {
    const kick = () => void syncQueue();
    window.addEventListener("online", kick);
    const id = window.setInterval(kick, 20000);
    return () => {
      window.removeEventListener("online", kick);
      window.clearInterval(id);
    };
  }, [syncQueue]);

  const submitCode = useCallback(
    async (raw: string) => {
      if (inFlight.current) return;
      const value = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
      if (value.length !== 5) {
        setFeedback({ kind: "error", text: "O código tem 5 caracteres." });
        return;
      }
      inFlight.current = true;
      setBusy(true);
      if (offline) {
        writeLocal(queueKey, enqueueRead(readLocal<QueuedRead[]>(queueKey) ?? [], { code: value, at: new Date().toISOString() }));
        setFeedback({ kind: "info", text: `Sem rede: a leitura de ${value} sobe quando a conexão voltar.` });
        setCode("");
        inFlight.current = false;
        setBusy(false);
        return;
      }
      const { res, data } = await post("", { code: value });
      inFlight.current = false;
      setBusy(false);
      if (!res) {
        writeLocal(queueKey, enqueueRead(readLocal<QueuedRead[]>(queueKey) ?? [], { code: value, at: new Date().toISOString() }));
        setFeedback({ kind: "info", text: `Sem rede: a leitura de ${value} sobe quando a conexão voltar.` });
        setCode("");
        return;
      }
      if (!res.ok) {
        setFeedback({ kind: "error", text: userMessage(res, data, "Código não encontrado.") });
        return;
      }
      setCode("");
      if (data?.state) setState(data.state as MeetState);
      const peer = (data?.peer ?? null) as PersonCard | null;
      setFeedback(
        data?.status === "confirmed"
          ? { kind: "ok", text: `Encontro com ${peer?.firstName ?? "a pessoa"} confirmado. O contato já está no cartão.` }
          : { kind: "ok", text: `Pedido enviado pra ${peer?.firstName ?? "a pessoa"}. Falta a confirmação dela.` },
      );
      await refresh();
    },
    [offline, post, queueKey, refresh],
  );

  // ?c=CODIGO na URL (o QR abre assim): lê sozinho uma vez
  useEffect(() => {
    if (autoTried.current || !initialCode) return;
    autoTried.current = true;
    void submitCode(initialCode);
  }, [initialCode, submitCode]);

  // polling de 10s, só com a aba visível (a outra pessoa confirma do outro lado)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stop, [stop]);

  async function startScan() {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Este navegador não libera a câmera aqui. Digite o código.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
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
        if (text) {
          const now = Date.now();
          const last = lastRef.current;
          const fresh = !last || last.text !== text || now - last.seen > 5000;
          lastRef.current = { text, seen: now };
          if (fresh) {
            stop();
            await submitCode(text);
            return;
          }
        }
        timerRef.current = window.setTimeout(tick, 250);
      };
      tick();
    } catch {
      stop();
      setCameraError("Não consegui abrir a câmera. Confira a permissão ou digite o código.");
    }
  }

  async function saveConsent() {
    setBusy(true);
    const { res, data } = await post("/me", { enabled: true, channel, newcomerOptIn: newcomer, introOptIn: intro });
    setBusy(false);
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      return;
    }
    await refresh();
    router.refresh();
    setFeedback({ kind: "ok", text: "Encontros ativos. Seu código já vale." });
  }

  async function togglePause(paused: boolean) {
    setBusy(true);
    const { res, data } = await post("/me", { paused });
    setBusy(false);
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      return;
    }
    await refresh();
    router.refresh();
    setFeedback({ kind: "ok", text: paused ? "Código pausado." : "Código ativo de novo." });
  }

  async function rotate() {
    setBusy(true);
    const { res, data } = await post("/me", { rotate: true });
    setBusy(false);
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      return;
    }
    await refresh();
    router.refresh();
    setFeedback({ kind: "ok", text: "Código novo. O antigo não vale mais." });
  }

  async function respond(id: number, action: "confirm" | "decline") {
    setBusy(true);
    const { res, data } = await post(`/${id}`, { action }, "PATCH");
    setBusy(false);
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      await refresh();
      return;
    }
    await refresh();
    setFeedback({
      kind: "ok",
      text: action === "confirm" ? "Encontro confirmado. O contato apareceu pros dois." : "Pronto. A outra pessoa não é avisada.",
    });
  }

  async function setDepth(id: number, depth: "rapido" | "alem") {
    setBusy(true);
    const { res, data } = await post(`/${id}`, { depth }, "PATCH");
    setBusy(false);
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      return;
    }
    await refresh();
  }

  async function saveSide(id: number, body: Record<string, unknown>, message: string) {
    const { res, data } = await post(`/${id}`, body, "PATCH");
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      return;
    }
    await refresh();
    setFeedback({ kind: "ok", text: message });
  }

  async function teamUp(username: string) {
    const res = await fetch("/api/team-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, hackathonId }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      return;
    }
    await refresh();
    const action = (data as { action?: string } | null)?.action;
    setFeedback({
      kind: "ok",
      text:
        action === "convite"
          ? "Vocês dois marcaram: o convite de time já foi enviado."
          : action === "time"
            ? "Vocês dois marcaram: o time nasceu com vocês dois."
            : action === "conexao"
              ? "Vocês dois marcaram. Os dois já têm time: a conexão fica registrada."
              : "Marcado. Só a outra pessoa vê se ela também marcou.",
    });
  }

  async function invite(username: string) {
    const res = await fetch(`/api/hackathons/${hackathonId}/team/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username] }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      return;
    }
    const invited = (data as { invited?: string[] } | null)?.invited ?? [];
    setFeedback({
      kind: "ok",
      text: invited.length > 0 ? `Convite de time enviado pra @${username}.` : `@${username} já tem time ou convite seu nesta edição.`,
    });
  }

  async function introduce() {
    setBusy(true);
    const { res, data } = await post("/introductions", { peer: introPeer, recipient: introRecipient });
    setBusy(false);
    if (!res || !res.ok) {
      setFeedback({ kind: "error", text: res ? userMessage(res, data, "Não deu certo. Tente de novo.") : "Sem conexão. Tente de novo." });
      return;
    }
    setIntroPeer("");
    setIntroRecipient("");
    await refresh();
    setFeedback({ kind: "ok", text: "Apresentação registrada. A ponte conta quando as duas se encontrarem." });
  }

  const gate = state.gate;
  const semAceite = !gate.ok && gate.reason === "consent";
  const bloqueado = !gate.ok && !semAceite;

  return (
    <div className="flex flex-col gap-8">
      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`border-[1.5px] px-3 py-2.5 font-mono text-[13px] ${
            feedback.kind === "error" ? "border-orange text-orange" : "border-accent text-accent-hi"
          }`}
          data-testid="encontros-feedback"
        >
          {feedback.text}
        </p>
      )}

      {offline && queue.length > 0 && (
        <p className="border-[1.5px] border-line px-3 py-2.5 font-mono text-[13px] text-muted" data-testid="encontros-fila">
          {queue.length} {queue.length === 1 ? "leitura" : "leituras"} esperando rede.
        </p>
      )}

      {bloqueado && (
        <section className="border-[1.5px] border-line p-4" data-testid="encontros-bloqueado">
          <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">Ainda não dá pra usar</h2>
          <p className="mt-2 max-w-prose text-[15px]" data-testid="encontros-motivo">
            {gate.ok ? "" : gate.message}
          </p>
        </section>
      )}

      {semAceite && (
        <section className="flex flex-col gap-4 border-[1.5px] border-line p-4" data-testid="encontros-aceite">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">Ativar encontros nesta edição</h2>
            <p className="max-w-prose text-[14px] text-muted">
              Depois de confirmado, a outra pessoa vê seu nome, @, personas, skills, cidade ou faculdade e o canal
              que você escolher. Nada além disso.
            </p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-mono text-[12px] text-muted uppercase">canal de contato</legend>
            {channels.map((c) => (
              <label
                key={c.key}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 border-[1.5px] px-3 py-2 text-[14.5px] ${
                  channel === c.key ? "border-foreground bg-mint" : "border-line-soft hover:border-foreground"
                }`}
              >
                <input
                  type="radio"
                  name="canal-encontro"
                  value={c.key}
                  checked={channel === c.key}
                  onChange={() => setChannel(c.key)}
                  className="accent-[var(--accent)]"
                />
                {c.label}
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 text-[14px]">
            <input type="checkbox" checked={newcomer} onChange={(e) => setNewcomer(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
            <span>
              Pode me mostrar como estreante
              <span className="block text-[13px] text-muted">
                Quem procura alguém no primeiro hackathon encontra você. Nunca diz onde você está.
              </span>
            </span>
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 text-[14px]">
            <input type="checkbox" checked={intro} onChange={(e) => setIntro(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
            <span>
              Aceito intros quinzenais fora do evento
              <span className="block text-[13px] text-muted">
                Duas pessoas por quinzena, por afinidade de área. Revogar aqui vale na hora.
              </span>
            </span>
          </label>
          <button type="button" onClick={saveConsent} disabled={busy} className="btn self-start rounded-[6px] disabled:opacity-60" data-testid="encontros-ativar">
            {busy ? "ativando…" : "ativar encontros"}
          </button>
        </section>
      )}

      {gate.ok && state.me && (
        <>
          <section className="flex flex-col gap-3 border-t-2 border-line pt-5" data-testid="encontros-ler">
            <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">Ler o código de alguém</h2>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void submitCode(code);
              }}
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="font-mono text-[12px] text-muted">código de 5 caracteres</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={12}
                  placeholder="ABCDE"
                  className={inputCls}
                  data-testid="encontros-input"
                />
              </label>
              <div className="flex items-end gap-2">
                <button type="submit" disabled={busy} className="btn min-h-[44px] rounded-[6px] disabled:opacity-60" data-testid="encontros-ler-enviar">
                  {busy ? "lendo…" : "ler código"}
                </button>
                <button type="button" onClick={scanning ? stop : startScan} className={btnGhost} data-testid="encontros-camera">
                  {scanning ? "parar" : "câmera"}
                </button>
              </div>
            </form>
            {cameraError && (
              <p role="alert" className="font-mono text-[12.5px] text-orange">
                {cameraError}
              </p>
            )}
            {scanning && (
              <div className="overflow-hidden border-[1.5px] border-line">
                <video ref={videoRef} playsInline muted className="h-auto w-full" data-testid="encontros-video" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button type="button" onClick={() => togglePause(!state.me!.paused)} className={btnGhost} data-testid="encontros-pausar">
                {state.me.paused ? "voltar o código" : "pausar o código"}
              </button>
              <button type="button" onClick={rotate} className={btnGhost} data-testid="encontros-rotacionar">
                gerar código novo
              </button>
              <span className="font-mono text-[12px] text-muted">
                {state.me.paused ? "pausado" : "ativo"} · canal {channels.find((c) => c.key === state.me!.channel)?.label}
              </span>
            </div>
          </section>

          {state.pendingIn.length > 0 && (
            <section className="flex flex-col gap-3 border-t-2 border-line pt-5" data-testid="encontros-pedidos">
              <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">Pedidos pra você</h2>
              {state.pendingIn.map((e) => (
                <div key={e.id} className="flex flex-col gap-3 border-[1.5px] border-accent p-3" data-testid="encontros-pedido">
                  <p className="text-[15px]">
                    <span className="font-semibold">{e.peer.firstName}</span>{" "}
                    <span className="font-mono text-[12.5px] text-muted">@{e.peer.username}</span> quer registrar o
                    encontro
                  </p>
                  <PersonLine peer={e.peer} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => respond(e.id, "confirm")} disabled={busy} className="btn min-h-[44px] rounded-[6px] disabled:opacity-60" data-testid="encontros-confirmar">
                      confirmar
                    </button>
                    <button type="button" onClick={() => respond(e.id, "decline")} disabled={busy} className={btnGhost} data-testid="encontros-recusar">
                      agora não
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {state.pendingOut.length > 0 && (
            <section className="flex flex-col gap-3" data-testid="encontros-esperando">
              <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">esperando a outra pessoa</h2>
              {state.pendingOut.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border border-line px-3 py-2.5">
                  <p className="min-w-0 text-[14px]">
                    {e.peer.firstName} <span className="font-mono text-[12px] text-muted">@{e.peer.username}</span>
                  </p>
                  <button type="button" onClick={() => respond(e.id, "decline")} className="font-mono text-[12.5px] text-muted underline-offset-4 hover:text-orange hover:underline">
                    cancelar
                  </button>
                </div>
              ))}
            </section>
          )}

          {state.confirmed.length > 0 && (
            <section className="flex flex-col gap-4 border-t-2 border-line pt-5" data-testid="encontros-confirmados">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">Quem você encontrou</h2>
                <p className="font-mono text-[12.5px] text-muted" data-testid="encontros-contadores">
                  {state.counts.people} {state.counts.people === 1 ? "pessoa" : "pessoas"} · {state.counts.deep} além do oi
                </p>
              </div>
              {state.confirmed.map((e) => (
                <ConfirmedCard
                  key={e.id}
                  encounter={e}
                  onDepth={(d) => setDepth(e.id, d)}
                  onCard={(key) => saveSide(e.id, { cardKey: key }, "Carta salva.")}
                  onNote={(note) => saveSide(e.id, { note }, "Nota privada salva. Só você vê.")}
                  onTeamUp={() => teamUp(e.peer.username)}
                  onInvite={() => invite(e.peer.username)}
                  onHide={() => saveSide(e.id, { hide: true }, "Fora da sua lista.")}
                />
              ))}
            </section>
          )}

          {state.missionsOn && state.missions.length > 0 && (
            <section className="flex flex-col gap-3 border-t-2 border-line pt-5" data-testid="encontros-missoes">
              <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">Sugestões da edição</h2>
              <p className="max-w-prose text-[13.5px] text-muted">
                Missões são sugestão, não etapa: nada trava por causa delas.
              </p>
              <ul className="flex flex-col gap-2">
                {state.missions.map((m) => (
                  <li key={m.key} className="flex items-start gap-2.5 border border-line px-3 py-2.5" data-testid={`missao-${m.key}`}>
                    <span aria-hidden className={`font-mono text-[13px] ${m.done ? "text-accent" : "text-muted"}`}>
                      {m.done ? "✓" : "·"}
                    </span>
                    <span className="min-w-0 flex-1 text-[14px]">
                      <span className="font-semibold">{m.label}</span>
                      <span className="block text-[13px] text-muted">{m.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {state.suggestions.length > 0 && (
                <div className="flex flex-col gap-3">
                  {state.suggestions.map((s) => (
                    <div key={s.mission} className="flex flex-col gap-2 border border-line px-3 py-2.5">
                      <p className="font-mono text-[12px] text-muted">
                        pra {s.missionLabel}: procure no evento
                      </p>
                      <ul className="flex flex-wrap gap-x-4 gap-y-1">
                        {s.people.map((p) => (
                          <li key={p.username} className="text-[14px]">
                            {p.firstName} <span className="font-mono text-[12px] text-muted">@{p.username}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              <form
                className="flex flex-col gap-2 border border-line px-3 py-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void introduce();
                }}
              >
                <p className="font-mono text-[12px] text-muted">apresentei uma pessoa a outra</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={introPeer}
                    onChange={(e) => setIntroPeer(e.target.value)}
                    placeholder="@ de uma pessoa"
                    className={inputCls}
                    aria-label="primeira pessoa"
                  />
                  <input
                    value={introRecipient}
                    onChange={(e) => setIntroRecipient(e.target.value)}
                    placeholder="@ da outra"
                    className={inputCls}
                    aria-label="segunda pessoa"
                  />
                  <button type="submit" disabled={busy} className={btnGhost} data-testid="encontros-apresentar">
                    apresentar
                  </button>
                </div>
                <p className="text-[12.5px] text-muted">
                  Conta quando as duas confirmarem um encontro entre si depois da apresentação.
                </p>
              </form>
            </section>
          )}

          {!state.missionsOn && (
            <p className="font-mono text-[12.5px] text-muted" data-testid="encontros-sem-missoes">
              As sugestões da edição estão desligadas. Os encontros funcionam igual.
            </p>
          )}

          <p className="border-t border-line pt-4 font-mono text-[12.5px] text-muted">
            Quem você conheceu fica só pra você:{" "}
            <Link href="/perfil/conexoes" className="text-accent underline-offset-4 hover:underline">
              /perfil/conexoes →
            </Link>
            {" · "}
            <span>{editionName}</span>
          </p>
        </>
      )}
    </div>
  );
}

function PersonLine({ peer }: { peer: PersonCard }) {
  const bits = [
    peer.personas.join(", "),
    peer.skills.slice(0, 4).join(", "),
    peer.institution ?? peer.city,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1">
      {bits.length > 0 && <p className="font-mono text-[12.5px] text-muted [overflow-wrap:anywhere]">{bits.join(" · ")}</p>}
      {peer.need && <p className="text-[13px]">procura: {peer.need}</p>}
    </div>
  );
}

function ConfirmedCard({
  encounter,
  onDepth,
  onCard,
  onNote,
  onTeamUp,
  onInvite,
  onHide,
}: {
  encounter: EncounterView;
  onDepth: (depth: "rapido" | "alem") => void;
  onCard: (key: string) => void;
  onNote: (note: string) => void;
  onTeamUp: () => void;
  onInvite: () => void;
  onHide: () => void;
}) {
  const [note, setNote] = useState(encounter.side.note ?? "");
  const [cardOpen, setCardOpen] = useState(false);
  const contact = encounter.peer.contact;
  return (
    <article className="flex flex-col gap-3 border-[1.5px] border-line p-3" data-testid="encontros-cartao">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15.5px] font-semibold [overflow-wrap:anywhere]">
            {encounter.peer.name ?? encounter.peer.firstName}{" "}
            <span className="font-mono text-[12.5px] font-normal text-muted">@{encounter.peer.username}</span>
          </p>
          <PersonLine peer={encounter.peer} />
        </div>
        <ReportDialog
          targetType="encontro"
          targetId={encounter.id}
          targetLabel="o encontro"
          authorUsername={encounter.peer.username}
          triggerLabel="denunciar"
        />
      </div>

      {encounter.complemento && (
        <p className="border-l-2 border-accent pl-2.5 text-[13.5px]" data-testid="encontros-complemento">
          {encounter.complemento}
        </p>
      )}

      <div className="flex flex-col gap-1" data-testid="encontros-contato">
        <p className="font-mono text-[12px] text-muted uppercase">contato</p>
        {contact ? (
          <p className="text-[14px] [overflow-wrap:anywhere]">
            {contact.label}: <span className="font-mono">{contact.value}</span>
          </p>
        ) : (
          <p className="text-[13.5px] text-muted">
            A pessoa não deixou {encounter.peer.firstName} com esse canal no perfil. Use o{" "}
            <Link href={`/u/${encounter.peer.username}`} className="text-accent underline-offset-4 hover:underline">
              perfil
            </Link>
            .
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="font-mono text-[12px] text-muted uppercase">como foi a conversa</legend>
        <div className="flex flex-wrap gap-2">
          {DEPTHS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => onDepth(d.key)}
              aria-pressed={encounter.side.depth === d.key}
              className={`inline-flex min-h-[44px] items-center rounded-[6px] border-[1.5px] px-3 font-mono text-[13px] transition ${
                encounter.side.depth === d.key ? "border-foreground bg-mint" : "border-line hover:border-foreground"
              }`}
              data-testid={`encontros-depth-${d.key}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="text-[12.5px] text-muted">
          {encounter.deep
            ? "Vocês dois disseram que foi além do oi."
            : encounter.side.depth === "alem"
              ? "Você disse que foi além do oi. Só conta quando a outra pessoa disser o mesmo."
              : "Profundidade só conta quando os dois marcam fomos além do oi."}
        </p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setCardOpen((v) => !v)}
          className="self-start font-mono text-[12.5px] text-muted underline-offset-4 hover:text-accent hover:underline"
          data-testid="encontros-carta-toggle"
        >
          {encounter.side.cardText ? `carta: ${encounter.side.cardText}` : "usamos uma carta? escolha uma"}
        </button>
        {cardOpen && (
          <div className="flex flex-col gap-2" data-testid="encontros-cartas">
            {CARD_KINDS.map((kind) => (
              <div key={kind} className="flex flex-col gap-1">
                <p className="font-mono text-[11.5px] tracking-widest text-muted uppercase">{CARD_KIND_LABEL[kind]}</p>
                <ul className="flex flex-col">
                  {cardsOf(kind).map((c) => (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => {
                          onCard(c.key);
                          setCardOpen(false);
                        }}
                        className={`w-full px-2 py-2 text-left text-[13.5px] underline-offset-4 hover:bg-mint hover:underline ${
                          encounter.side.cardKey === c.key ? "font-semibold" : ""
                        }`}
                      >
                        {c.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[12px] text-muted">nota privada (só você vê)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          rows={2}
          className="w-full resize-none rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[14px] focus:border-accent focus:outline-none"
          data-testid="encontros-nota"
        />
        <button
          type="button"
          onClick={() => onNote(note)}
          className="self-start font-mono text-[12.5px] text-muted underline-offset-4 hover:text-accent hover:underline"
          data-testid="encontros-nota-salvar"
        >
          salvar nota
        </button>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onTeamUp}
          aria-pressed={encounter.myTeamUp}
          className={`inline-flex min-h-[44px] items-center rounded-[6px] border-[1.5px] px-3 font-mono text-[13px] transition ${
            encounter.myTeamUp ? "border-foreground bg-mint" : "border-line hover:border-foreground"
          }`}
          data-testid="encontros-bora"
        >
          bora fazer junto?
        </button>
        <button type="button" onClick={onInvite} className={btnGhost} data-testid="encontros-convidar">
          convidar pro meu time
        </button>
        <button type="button" onClick={onHide} className="font-mono text-[12.5px] text-muted underline-offset-4 hover:text-orange hover:underline">
          tirar da minha lista
        </button>
      </div>
      {encounter.teamUp && (
        <p className="font-mono text-[12.5px] text-accent-hi" data-testid="encontros-bora-mutuo">
          vocês dois marcaram bora fazer junto
        </p>
      )}
    </article>
  );
}
