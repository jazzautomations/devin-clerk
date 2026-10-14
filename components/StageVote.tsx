"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { StageSnapshot } from "@/lib/stage";
import { fmtAvg, StageTimer, useStageStream } from "@/components/StageLive";

// Modo palco — votar do celular. Uma tela, um gesto: nota de 1 a 5 no
// pitch que está no palco. Muda a nota enquanto a votação estiver aberta.
// A tela segue o palco sozinha (SSE): trocou o pitch, troca o botão.
// As notas são radios nativos (um Tab, setas trocam a nota). Como mexer na
// seta já muda a escolha, o envio espera a pessoa parar (VOTE_DEBOUNCE_MS)
// e manda só a última nota. A região de status fica sempre montada e
// anuncia o voto e a troca de pitch.

const VOTE_DEBOUNCE_MS = 400;

const LABELS: Record<number, string> = {
  1: "fraco",
  2: "ok",
  3: "bom",
  4: "muito bom",
  5: "brabo",
};

export function StageVote({
  hackathonId,
  editionName,
  initial,
  checkedIn,
  ownTeamId,
  initialScore,
}: {
  hackathonId: string;
  editionName: string;
  initial: StageSnapshot;
  checkedIn: boolean;
  ownTeamId: number | null;
  initialScore: number | null;
}) {
  const router = useRouter();
  const { snap, conn } = useStageStream(hackathonId, initial);
  const cur = snap.current;
  const [scores, setScores] = useState<Record<number, number>>(() =>
    initial.current && initialScore !== null ? { [initial.current.teamId]: initialScore } : {},
  );
  const [pending, setPending] = useState<number | null>(null);
  // escolha local (antes do servidor confirmar), presa ao pitch em que foi feita
  const [choice, setChoice] = useState<{ teamId: number; score: number } | null>(null);
  const [msg, setMsg] = useState<{ teamId: number | null; text: string; error: boolean } | null>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const queued = useRef<{ teamId: number; score: number } | null>(null);

  // pitch novo: busca a nota que a pessoa já deu nele (voltou um pitch) — normalmente nenhuma
  const curId = cur?.teamId ?? null;
  useEffect(() => {
    if (curId === null || !checkedIn) return;
    let gone = false;
    fetch(`/api/hackathons/${hackathonId}/stage/vote`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { currentTeamId: number | null; myScore: number | null } | null) => {
        if (gone || !d || d.currentTeamId === null || d.myScore === null) return;
        setScores((s) => ({ ...s, [d.currentTeamId as number]: d.myScore as number }));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [curId, checkedIn, hackathonId]);

  // troca de pitch: anuncia quem subiu (estado derivado do render anterior)
  const [seenPitch, setSeenPitch] = useState(curId);
  const [announce, setAnnounce] = useState("");
  if (seenPitch !== curId) {
    setSeenPitch(curId);
    setAnnounce(cur ? `Agora no palco: ${cur.title}` : "");
  }

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  async function send(teamId: number, score: number) {
    if (inflight.current) {
      queued.current = { teamId, score };
      return;
    }
    inflight.current = true;
    setPending(score);
    setMsg(null);
    try {
      const r = await fetch(`/api/hackathons/${hackathonId}/stage/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId, score }),
      });
      if (r.status === 401) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent(`/h/${hackathonId}/votar`)}`);
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setScores((s) => ({ ...s, [teamId]: score }));
        setMsg({ teamId, text: `voto registrado: ${score}. Dá pra mudar enquanto a votação estiver aberta.`, error: false });
        navigator.vibrate?.(30);
      } else {
        setChoice(null);
        setMsg({ teamId, text: typeof d.error === "string" ? d.error : "não deu certo. Tente de novo.", error: true });
      }
    } catch {
      setChoice(null);
      setMsg({ teamId, text: "sem conexão. Tente de novo.", error: true });
    } finally {
      inflight.current = false;
      setPending(null);
      const next = queued.current;
      queued.current = null;
      if (next && next.teamId === teamId && next.score !== score) void send(next.teamId, next.score);
    }
  }

  function choose(score: number) {
    if (!cur) return;
    const teamId = cur.teamId;
    setChoice({ teamId, score });
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void send(teamId, score), VOTE_DEBOUNCE_MS);
  }

  const mine = cur ? (scores[cur.teamId] ?? null) : null;
  const selected = choice && choice.teamId === curId ? choice.score : mine;
  const own = cur !== null && ownTeamId === cur.teamId;
  const canVote = checkedIn && cur !== null && !own && snap.status === "live" && snap.votingOpen;
  const shownMsg = msg && msg.teamId === curId ? msg : null;

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-6" data-testid="stage-vote">
      <header className="flex items-center justify-between gap-3">
        <span className="tag uppercase">final ao vivo</span>
        <span className={`font-mono text-[12px] ${conn === "ao vivo" ? "text-accent" : "text-orange"}`}>● {conn}</span>
      </header>
      <h1 className="-mt-2 truncate font-mono text-[13px] font-normal text-muted">
        <span className="sr-only">Votação ao vivo: </span>
        {editionName}
      </h1>

      {!checkedIn ? (
        <div className="window dark hard" data-testid="stage-vote-blocked">
          <div className="tbar">
            <span className="title">ACESSO.exe</span>
          </div>
          <div className="tbody gap-3 p-5!">
            <p className="pix text-[30px] leading-none">SEM CHECK-IN</p>
            <p className="text-[15px] leading-snug text-mint">
              Só vota quem fez check-in nesta edição. Assim o voto é de quem está na sala. Passe no
              credenciamento com o QR do seu ingresso e volte aqui.
            </p>
            <Link href={`/h/${hackathonId}/ingresso`} className="btn w-full">
              meu ingresso →
            </Link>
          </div>
        </div>
      ) : snap.status === "ended" ? (
        <div className="window paper hard">
          <div className="tbar">
            <span className="title">RESULTADO.exe</span>
          </div>
          <div className="tbody gap-3 p-5!">
            <p className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">Final encerrada — escolha do público</p>
            {!snap.quorum.met && (
              <p data-testid="vote-no-quorum" className="font-mono text-[13px] text-orange">
                votação sem quórum: {snap.quorum.total} de {snap.quorum.min} votos mínimos
              </p>
            )}
            <ol className="border-b border-line">
              {(snap.ranking ?? []).slice(0, 5).map((r) => (
                <li key={r.teamId} className="flex items-baseline gap-3 border-t border-line py-2">
                  <span className="pix w-8 text-[22px]">{r.avg === null ? "—" : `${r.position}º`}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.title}</span>
                  <span className="font-mono text-[13px]">
                    {fmtAvg(r.avg)}
                    {r.tied ? " · empate" : ""}
                    {r.fewVotes ? " · poucos votos" : ""}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : !cur ? (
        <div className="window paper hard" data-testid="stage-vote-waiting">
          <div className="tbar">
            <span className="title">PALCO.exe</span>
          </div>
          <div className="tbody gap-2 p-5!">
            <p className="pix text-[28px] leading-none text-accent">
              {snap.status === "live" ? "INTERVALO" : "EM INSTANTES"}
            </p>
            <p className="text-[15px] leading-snug">
              {snap.status === "live"
                ? "O próximo pitch já sobe. Deixe esta tela aberta, ela atualiza sozinha."
                : "A final ainda não começou. Deixe esta tela aberta: o voto aparece quando o primeiro pitch subir."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="window dark hard" data-testid="stage-vote-current">
            <div className="tbar">
              <span className="title">
                PITCH {cur.position}/{snap.total}
              </span>
              <span className="dots" aria-hidden>
                <b />
                <b />
              </span>
            </div>
            <div className="tbody gap-2 p-5!">
              <p className="text-[24px] leading-tight font-extrabold tracking-[-0.02em] text-background">{cur.title}</p>
              <p className="truncate font-mono text-[13px] text-mint">time {cur.teamName}</p>
              <StageTimer timer={snap.timer} className="text-[56px]" tone="text-band" />
            </div>
          </div>

          {own ? (
            <p className="border-[1.5px] border-line px-4 py-3 font-mono text-[13px]" data-testid="stage-vote-own">
              É o seu time no palco. Você não vota no próprio time.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <fieldset className="flex min-w-0 flex-col gap-3" disabled={!canVote}>
                <legend className="mb-3 font-mono text-[12px] tracking-widest text-muted uppercase">
                  {snap.votingOpen ? "sua nota pra esse pitch" : "votação fechada"}
                </legend>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="relative">
                      <input
                        type="radio"
                        name={`nota-${cur.teamId}`}
                        value={n}
                        checked={selected === n}
                        onChange={() => choose(n)}
                        aria-label={`nota ${n}, ${LABELS[n]}`}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={`flex aspect-square cursor-pointer flex-col items-center justify-center rounded-[6px] border-2 border-line bg-background transition peer-checked:border-accent peer-checked:bg-accent peer-checked:text-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-45 hover:bg-mint peer-checked:hover:bg-accent ${
                          pending === n ? "animate-pulse" : ""
                        }`}
                      >
                        <span className="pix text-[34px] leading-none">{n}</span>
                        <span className="text-[13px] leading-none">★</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-between font-mono text-[11px] text-muted">
                <span>1 · fraco</span>
                <span>5 · brabo</span>
              </div>
              {!snap.votingOpen && (
                <p className="font-mono text-[13px] text-muted" data-testid="stage-vote-closed">
                  {mine !== null
                    ? `seu voto: ${mine}. A votação desse pitch está fechada.`
                    : "Espere a organização abrir a votação desse pitch."}
                </p>
              )}
            </div>
          )}
        </>
      )}
      {/* sempre montada: leitor de tela só anuncia região que já existia */}
      <p
        role="status"
        data-testid="stage-vote-status"
        className={shownMsg ? `font-mono text-[13px] ${shownMsg.error ? "text-orange" : "text-accent"}` : "sr-only"}
      >
        {shownMsg?.text ?? announce}
      </p>
    </section>
  );
}
