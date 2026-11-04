"use client";

import { useEffect, useState } from "react";
import type { RankingEntry, StageSnapshot } from "@/lib/stage";
import type { Salao } from "@/lib/salao";
import { fmtAvg, StageTimer, useStageStream } from "@/components/StageLive";
import { TelaoSalao } from "@/components/TelaoSalao";

// Modo palco — o telão. Pensado pra projetor em 1920×1080 visto do fundo
// do auditório: tamanhos em vw, contraste máximo, nada menor que ~22px.
// Três atos: espera (QR + ordem), pitch (projeto, tempo, voto, placar) e
// resultado (ranking revelado de baixo pra cima).
//
// Salão (spec 046, onda 4): quando o controle troca a tela, o mesmo telão
// desenha a ilha com os bichos de quem está presente — a final continua
// montada por trás, só sai do ar até alguém voltar pra 'palco'.

function Win({
  title,
  dark = false,
  className = "",
  children,
  testId,
}: {
  title: string;
  dark?: boolean;
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className={`window hard min-h-0 ${dark ? "dark" : "paper"} ${className}`}>
      <div className="tbar text-[clamp(18px,1.25vw,30px)]!">
        <span className="title">{title}</span>
        <span className="dots" aria-hidden>
          <b />
          <b />
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-[1.4vw]">{children}</div>
    </section>
  );
}

function Logo({ url, title }: { url: string | null; title: string }) {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- logo remoto do time; next/image exigiria remotePatterns só pra isso
    <img src={url} alt="" className="size-[11vw] shrink-0 border-2 border-line bg-background object-contain" />
  ) : (
    <span className="pix flex size-[11vw] shrink-0 items-center justify-center border-2 border-line bg-foreground text-[6vw] text-band">
      {initials}
    </span>
  );
}

function Qr({ svg, url, open, row = false }: { svg: string; url: string; open: boolean | null; row?: boolean }) {
  // `row`: QR à esquerda e texto à direita — cabe na janela baixa do ato "pitch"
  return (
    <div
      className={`flex min-h-0 flex-1 items-center justify-center gap-[1.4vw] ${
        row ? "flex-row text-left" : "flex-col text-center"
      }`}
    >
      <div
        className={`aspect-square shrink-0 border-2 border-line bg-background [&_svg]:block [&_svg]:size-full ${
          row ? "w-[min(17vw,31vh)]" : "w-[min(20vw,40vh)]"
        }`}
        dangerouslySetInnerHTML={{ __html: svg }}
        aria-label={`QR code para votar: ${url}`}
        role="img"
      />
      <div className={`flex min-w-0 flex-col gap-[0.8vw] ${row ? "items-start" : "items-center"}`}>
        <p className="text-[2vw] leading-[1.05] font-extrabold tracking-[-0.02em]">aponta a câmera e vota</p>
        <p className="font-mono text-[1.05vw] break-all text-muted">{url}</p>
        {open !== null && (
          <p
            data-testid="stage-voting"
            className={`pix px-[0.8vw] text-[2.2vw] leading-tight ${open ? "bg-foreground text-band" : "border-2 border-line text-muted"}`}
          >
            {open ? "VOTAÇÃO ABERTA" : "VOTAÇÃO FECHADA"}
          </p>
        )}
      </div>
    </div>
  );
}

function Tally({ tally }: { tally: NonNullable<StageSnapshot["tally"]> }) {
  const max = Math.max(1, ...tally.dist);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[0.8vw]" data-testid="stage-tally">
      <div className="flex items-baseline gap-[0.8vw]">
        <span className="pix text-[6vw] leading-[0.8]">{fmtAvg(tally.avg)}</span>
        <span className="pix text-[2.4vw] text-mint">/5</span>
        <span className="ml-auto font-mono text-[1.2vw] text-mint">
          {tally.count} {tally.count === 1 ? "voto" : "votos"}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-around gap-[0.4vw]">
        {[5, 4, 3, 2, 1].map((n) => (
          <div key={n} className="flex items-center gap-[0.8vw]">
            <span className="pix w-[2.2vw] text-[1.8vw] leading-none">{n}★</span>
            <div className="h-[1.6vw] flex-1 border border-[#2a5f45]">
              <div
                className="h-full bg-band"
                style={{ width: `${(tally.dist[n - 1] / max) * 100}%`, transition: "width 0.6s cubic-bezier(.12,.23,.5,1)" }}
              />
            </div>
            <span className="w-[3vw] text-right font-mono text-[1.2vw] text-mint tabular-nums">{tally.dist[n - 1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ranking({ ranking }: { ranking: RankingEntry[] }) {
  const rows = ranking.slice(0, 8);
  const n = rows.length;
  return (
    <ol className="flex min-h-0 flex-1 flex-col gap-[0.7vw]" data-testid="stage-ranking">
      {rows.map((r, i) => {
        // revela de baixo pra cima: o 1º lugar entra por último
        const delay = (n - 1 - i) * 0.7;
        const first = r.position === 1 && r.avg !== null;
        return (
          <li
            key={r.teamId}
            className={`stage-rise grid max-h-[16vh] min-h-0 flex-1 grid-cols-[6vw_minmax(0,1fr)_17vw_9vw] items-center gap-[1.2vw] border-2 border-line px-[1.2vw] py-[0.5vw] ${
              first ? "bg-foreground text-band" : "bg-background"
            }`}
            style={{ animationDelay: `${delay}s` }}
          >
            <span className="pix text-[4.2vw] leading-none">{r.avg === null ? "—" : `${r.position}º`}</span>
            <span className="min-w-0">
              <span className="block truncate text-[2.5vw] leading-tight font-extrabold tracking-[-0.02em]">
                {r.title}
              </span>
              <span className={`block truncate font-mono text-[1.15vw] ${first ? "text-mint" : "text-muted"}`}>
                {r.teamName}
                {r.tied && <span className="pix ml-[0.8vw] bg-orange px-[0.4vw] text-[1.2vw] text-background">EMPATE</span>}
              </span>
            </span>
            <span className={`h-[1.6vw] border ${first ? "border-band" : "border-line"}`}>
              <span
                className={`stage-grow block h-full ${first ? "bg-band" : "bg-accent"}`}
                style={{ width: `${((r.avg ?? 0) / 5) * 100}%`, animationDelay: `${delay + 0.2}s` }}
              />
            </span>
            <span className="text-right">
              <span className="pix block text-[3.2vw] leading-none">{fmtAvg(r.avg)}</span>
              <span className={`block font-mono text-[0.9vw] ${first ? "text-mint" : "text-muted"}`}>
                {r.votes} {r.votes === 1 ? "voto" : "votos"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function useFullscreen() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const on = () => setFs(Boolean(document.fullscreenElement));
    const key = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }
    };
    document.addEventListener("fullscreenchange", on);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return fs;
}

export function StageScreen({
  hackathonId,
  editionName,
  voteUrl,
  qrSvg,
  initial,
  salaoInicial = null,
}: {
  hackathonId: string;
  editionName: string;
  voteUrl: string;
  qrSvg: string;
  initial: StageSnapshot;
  salaoInicial?: Salao | null;
}) {
  const { snap, conn } = useStageStream(hackathonId, initial);
  const fs = useFullscreen();
  const cur = snap.current;
  const salao = snap.screen === "salao";

  return (
    <div
      data-testid="stage-screen"
      data-status={snap.status}
      data-screen={snap.screen}
      className="desk fixed inset-0 z-[70] flex flex-col overflow-hidden border-0!"
    >
      <style>{`
        @keyframes stage-rise { from { opacity: 0; transform: translateY(1.2vw) } to { opacity: 1; transform: none } }
        @keyframes stage-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        .stage-rise { animation: stage-rise .6s cubic-bezier(.12,.23,.5,1) both }
        .stage-grow { transform-origin: left; animation: stage-grow 1.1s cubic-bezier(.12,.23,.5,1) both }
      `}</style>
      <header className="strip flex items-center gap-[1.6vw] px-[1.6vw] py-[0.4vw] text-[clamp(18px,1.6vw,40px)]!">
        <span>
          HACKAHUB ▸ {salao ? "SALÃO" : snap.status === "ended" ? "RESULTADO" : "FINAL AO VIVO"}
        </span>
        <span className="min-w-0 flex-1 truncate text-background">{editionName}</span>
        {cur && !salao && (
          <span data-testid="stage-position">
            PITCH {cur.position}/{snap.total}
          </span>
        )}
        <span className={conn === "ao vivo" ? "" : "text-[#f2b880]"} title="conexão com o servidor">
          ● {salao ? conn.toUpperCase() : snap.status === "ended" ? "ENCERRADA" : conn.toUpperCase()}
        </span>
        {!fs && (
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.()}
            className="border border-band px-[0.6vw] text-[0.8em] hover:bg-band hover:text-foreground"
          >
            TELA CHEIA [F]
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[1.4vw] p-[1.8vw]">
        {salao ? (
          <TelaoSalao hackathonId={hackathonId} initial={salaoInicial} />
        ) : snap.status === "ended" && snap.ranking ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,0.36fr)] gap-[1.6vw]">
            <Win title="ESCOLHA_DO_PUBLICO.exe" testId="stage-result">
              <h1 className="mb-[1vw] text-[3.4vw] leading-none font-extrabold tracking-[-0.035em]">
                Escolha do público
              </h1>
              {snap.ranking.length > 0 ? (
                <Ranking ranking={snap.ranking} />
              ) : (
                <p className="font-mono text-[1.4vw] text-muted">nenhum pitch na fila</p>
              )}
            </Win>
            <Win title="COMO_FOI.exe">
              <div className="flex flex-1 flex-col justify-center gap-[1vw]">
                <p className="pix text-[2.2vw] leading-tight">VOTAÇÃO ENCERRADA</p>
                <p className="font-mono text-[1.1vw] text-muted">
                  média das notas 1–5 de quem fez check-in · o pódio oficial é do júri
                </p>
              </div>
            </Win>
          </div>
        ) : snap.status === "ended" && !snap.quorum.met ? (
          <Win title="ESCOLHA_DO_PUBLICO.exe" className="flex-1" testId="stage-no-quorum">
            <div className="flex flex-1 flex-col justify-center gap-[1.2vw]">
              <p className="pix text-[4.4vw] leading-none text-orange">VOTAÇÃO SEM QUÓRUM</p>
              <p className="font-mono text-[1.6vw]">
                {snap.quorum.total} de {snap.quorum.min} votos mínimos — a escolha do público não vale nesta final
              </p>
              <p className="font-mono text-[1.1vw] text-muted">o pódio oficial é do júri</p>
            </div>
          </Win>
        ) : cur ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-[1.6vw]">
            <div className="flex min-h-0 flex-col gap-[1.6vw]">
              <Win title="PALCO.exe" className="flex-1" testId="stage-current">
                <div className="flex min-h-0 flex-1 items-center gap-[2vw]">
                  <Logo url={cur.logoUrl} title={cur.title} />
                  <div className="min-w-0">
                    <p className="pix text-[1.8vw] leading-none text-accent">NO PALCO</p>
                    <h1 className="mt-[0.4vw] line-clamp-2 text-[5.4vw] leading-[0.95] font-extrabold tracking-[-0.035em]">
                      {cur.title}
                    </h1>
                    <p className="mt-[0.8vw] truncate font-mono text-[1.7vw]">time {cur.teamName}</p>
                    {cur.members.length > 0 && (
                      <p className="mt-[0.4vw] truncate font-mono text-[1.1vw] text-muted">
                        {cur.members.map((m) => `@${m}`).join("  ")}
                      </p>
                    )}
                  </div>
                </div>
              </Win>
              <Win title="TEMPO.exe" dark className="shrink-0">
                <div className="flex items-end gap-[2vw]">
                  <StageTimer timer={snap.timer} className="text-[13vw]" showBar={false} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[0.8vw] pb-[1vw]">
                    <p className="pix text-[2vw] leading-none text-mint">
                      {snap.timer.running ? "▶ RODANDO" : "❚❚ PAUSADO"}
                    </p>
                    <p className="font-mono text-[1.1vw] text-mint">
                      pitch de {Math.round(snap.timer.pitchSeconds / 60)} min
                    </p>
                  </div>
                </div>
              </Win>
            </div>
            <div className="flex min-h-0 flex-col gap-[1.6vw]">
              <Win title="VOTE.exe" className="flex-[1.15]">
                <Qr svg={qrSvg} url={voteUrl} open={snap.votingOpen} row />
              </Win>
              <Win title="PLACAR.exe" dark className="flex-1">
                {snap.tally && <Tally tally={snap.tally} />}
              </Win>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-[1.6vw]">
            <Win title="FINAL.exe" testId="stage-idle">
              <div className="flex min-h-0 flex-1 flex-col justify-center gap-[2vw]">
                <p className="pix text-[2.2vw] leading-none text-accent">
                  {snap.status === "live" ? "INTERVALO" : "EM INSTANTES"}
                </p>
                <h1 className="text-[6vw] leading-[0.9] font-extrabold tracking-[-0.04em]">
                  A final já vai começar
                </h1>
                {snap.upNext.length > 0 && (
                  <ol className="flex flex-col gap-[0.6vw] border-t-2 border-line pt-[1.2vw]">
                    {snap.upNext.map((t, i) => (
                      <li key={t.teamId} className="flex items-baseline gap-[1.2vw]">
                        <span className="pix text-[2vw] text-accent">{String(i + 1).padStart(2, "0")}</span>
                        <span className="truncate text-[2vw] font-extrabold tracking-[-0.02em]">{t.title}</span>
                        <span className="truncate font-mono text-[1.1vw] text-muted">{t.teamName}</span>
                      </li>
                    ))}
                    {snap.total > snap.upNext.length && (
                      <li className="font-mono text-[1.1vw] text-muted">
                        + {snap.total - snap.upNext.length} na fila
                      </li>
                    )}
                  </ol>
                )}
              </div>
            </Win>
            <Win title="VOTE.exe">
              <Qr svg={qrSvg} url={voteUrl} open={null} />
              <p className="text-center font-mono text-[1vw] text-muted">
                vota quem fez check-in · nota de 1 a 5 por pitch
              </p>
            </Win>
          </div>
        )}

        {cur && snap.upNext.length > 0 && (
          <footer className="strip flex shrink-0 items-center gap-[1.4vw] px-[1.2vw] py-[0.4vw] text-[clamp(18px,1.5vw,36px)]!">
            <span>A SEGUIR ▸</span>
            <span className="min-w-0 truncate text-background">
              {snap.upNext.map((t) => t.title).join("  ·  ")}
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}
