"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MascoteViewer } from "@/components/MascoteViewer";
import { ROTULOS } from "@/lib/mascote/acessorios";
import { ESPECIE_DEFS } from "@/lib/mascote/especies";
import { svgDataUri, toSvg } from "@/lib/mascote/isometrico";
import { PALETA, type CorId } from "@/lib/mascote/paleta";
import { sortearConfig, sortearNome } from "@/lib/mascote/semente";
import {
  ACESSORIOS,
  BOCAS,
  COPY_CRESCE,
  CENARIOS,
  ESPECIES,
  MAOS,
  NOME_MAX,
  OLHOS,
  POSES,
  ROUPAS,
  TOPOS,
  type MascoteConfig,
} from "@/lib/mascote/tipos";
import { validarMascote, type ErrosMascote } from "@/lib/mascote/validar";
import { montar } from "@/lib/mascote/voxel";
import { userMessage } from "@/lib/apiError";

// Criador do bicho (migration 043). Tudo liberado desde o começo: trocar é
// instantâneo, o dado sorteia, desfazer volta um passo e só "salvar" grava.
// Item que vem de fato verificado é extra e chega na onda 4.

type CampoLista = "especie" | "olhos" | "boca" | "topo" | "roupa" | "mao" | "acessorio" | "cenario";
type Aba = CampoLista | "cores" | "pose";

const LISTAS: Record<CampoLista, readonly string[]> = {
  especie: ESPECIES,
  olhos: OLHOS,
  boca: BOCAS,
  topo: TOPOS,
  roupa: ROUPAS,
  mao: MAOS,
  acessorio: ACESSORIOS,
  cenario: CENARIOS,
};

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "especie", rotulo: "espécie" },
  { id: "cores", rotulo: "cores" },
  { id: "olhos", rotulo: "olhos" },
  { id: "boca", rotulo: "boca" },
  { id: "topo", rotulo: "chapéu" },
  { id: "roupa", rotulo: "roupa" },
  { id: "mao", rotulo: "mão" },
  { id: "acessorio", rotulo: "rosto" },
  { id: "pose", rotulo: "pose" },
  { id: "cenario", rotulo: "cenário" },
];

const POSE_TEXTO: Record<(typeof POSES)[number], string> = {
  pula: "dá pulinhos no lugar",
  acena: "acena de tempo em tempo",
  danca: "balança no ritmo",
};

const igual = (a: MascoteConfig, b: MascoteConfig) => JSON.stringify(a) === JSON.stringify(b);

function Miniatura({ config }: { config: MascoteConfig }) {
  const src = useMemo(() => svgDataUri(toSvg(montar(config), { tamanho: 96 })), [config]);
  // eslint-disable-next-line @next/next/no-img-element -- SVG gerado no cliente
  return <img src={src} alt="" className="aspect-square w-full object-contain" draggable={false} />;
}

function IconeDado() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="2.5" width="15" height="15" />
      <circle cx="6.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconeDesfazer() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 4 3 8l4 4" />
      <path d="M3.5 8H12a5 5 0 0 1 0 10H8" />
    </svg>
  );
}

export function MascoteEditor({
  inicial,
  salvo: salvoInicial,
  onSalvo,
  rotuloSalvar = "salvar",
  extra,
}: {
  inicial: MascoteConfig;
  /** false = bicho da semente, ainda não salvo */
  salvo: boolean;
  onSalvo?: (r: { config: MascoteConfig; src: string }) => void;
  rotuloSalvar?: string;
  /** ação ao lado do salvar (o "pular" do onboarding) */
  extra?: ReactNode;
}) {
  const [config, setConfig] = useState<MascoteConfig>(inicial);
  const [historico, setHistorico] = useState<MascoteConfig[]>([]);
  const [gravado, setGravado] = useState<MascoteConfig | null>(salvoInicial ? inicial : null);
  const [aba, setAba] = useState<Aba>("especie");
  const [estado, setEstado] = useState<"livre" | "salvando" | "salvo">("livre");
  const [erros, setErros] = useState<ErrosMascote>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  function trocar(next: MascoteConfig) {
    if (igual(next, config)) return;
    setHistorico((h) => [...h.slice(-49), config]);
    setConfig(next);
    setEstado("livre");
    setErros({});
  }
  const escolher = <K extends keyof MascoteConfig>(campo: K, valor: MascoteConfig[K]) => trocar({ ...config, [campo]: valor });

  function desfazer() {
    const anterior = historico.at(-1);
    if (!anterior) return;
    setHistorico((h) => h.slice(0, -1));
    setConfig(anterior);
    setEstado("livre");
    setErros({});
  }

  async function salvar() {
    const local = validarMascote(config);
    if (!local.ok) {
      setErros(local.erros);
      setErroGeral(local.erro);
      return;
    }
    setEstado("salvando");
    setErroGeral(null);
    const res = await fetch("/api/members/me/mascote", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(local.config),
    }).catch(() => null);
    if (!res) {
      setEstado("livre");
      return setErroGeral("Sem conexão. Tente de novo.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setEstado("livre");
      setErros(data?.campos ?? {});
      return setErroGeral(userMessage(res, data, "Não deu pra salvar. Tente de novo."));
    }
    setConfig(data.config);
    setGravado(data.config);
    setEstado("salvo");
    onSalvo?.({ config: data.config, src: data.src });
  }

  const sujo = !gravado || !igual(gravado, config);
  const def = ESPECIE_DEFS[config.especie];
  const lista = aba !== "cores" && aba !== "pose" ? aba : null;

  return (
    <div className="window hard @container min-w-0" data-testid="mascote-editor">
      <div className="tbar">
        <span className="title">BICHO — {config.nome || "sem nome"}</span>
        <span className="dots" aria-hidden>
          <b />
          <b />
        </span>
      </div>
      <div className="grid min-w-0 @3xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* palco */}
        <div className="desk flex min-w-0 flex-col items-center gap-3 border-t-0! px-4 pt-5 pb-4 @3xl:border-r-2 @3xl:border-b-0!">
          <div className="w-full max-w-[300px] border-2 border-line bg-background">
            <MascoteViewer config={config} girar tamanho={300} />
          </div>
          <div className="w-full max-w-[300px] border-2 border-line bg-background px-3 py-2 text-center">
            <p className="truncate text-[18px] font-extrabold tracking-[-0.02em]" data-testid="mascote-nome-palco">
              {config.nome || "sem nome"}
            </p>
            <p className="font-mono text-[12px] text-muted">
              {def.nome} · {def.frase}
            </p>
          </div>
          <div className="flex w-full max-w-[300px] gap-2">
            <button
              type="button"
              onClick={() => trocar(sortearConfig(Math.random, config.nome))}
              className="btn min-h-[44px]! flex-1 px-3! font-mono text-[14px]!"
              data-testid="mascote-sortear"
            >
              <IconeDado />
              sortear
            </button>
            <button
              type="button"
              onClick={desfazer}
              disabled={historico.length === 0}
              className="btn-ghost min-h-[44px]! flex-1 bg-background! px-3! font-mono text-[14px]! disabled:opacity-40"
              data-testid="mascote-desfazer"
            >
              <IconeDesfazer />
              desfazer
            </button>
          </div>
          <p className="font-mono text-[11.5px] text-foreground/80">arraste pra girar · toque pra acenar</p>
        </div>

        {/* painel */}
        <div className="flex min-w-0 flex-col bg-background font-sans">
          <div className="flex flex-col gap-1.5 border-b-2 border-line p-4">
            <label htmlFor="mascote-nome" className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
              nome do bicho
            </label>
            <div className="flex gap-2">
              <input
                id="mascote-nome"
                value={config.nome}
                maxLength={NOME_MAX}
                onChange={(e) => {
                  setConfig({ ...config, nome: e.target.value });
                  setEstado("livre");
                  setErros({});
                }}
                aria-invalid={!!erros.nome}
                aria-describedby={erros.nome ? "mascote-nome-erro" : undefined}
                className="min-w-0 flex-1 border-[1.5px] border-line bg-background px-3 py-2 text-[15px] focus:border-accent focus:outline-none"
                data-testid="mascote-nome"
              />
              <button
                type="button"
                onClick={() => trocar({ ...config, nome: sortearNome(Math.random, config.nome) })}
                className="btn-ghost min-h-[44px]! shrink-0 px-3! font-mono text-[13px]!"
                data-testid="mascote-sortear-nome"
              >
                sortear nome
              </button>
            </div>
            {erros.nome && (
              <p id="mascote-nome-erro" className="font-mono text-[12.5px] text-orange">
                {erros.nome}
              </p>
            )}
          </div>

          <div role="tablist" aria-label="partes do bicho" className="flex min-w-0 overflow-x-auto border-b-2 border-line [scrollbar-width:thin]">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                id={`aba-${a.id}`}
                aria-selected={aba === a.id}
                aria-controls="mascote-opcoes"
                onClick={() => setAba(a.id)}
                className={`min-h-[44px] shrink-0 border-r border-line px-3.5 font-mono text-[13px] whitespace-nowrap ${
                  aba === a.id ? "bg-foreground text-band" : "hover:bg-mint"
                }`}
                data-testid={`mascote-aba-${a.id}`}
              >
                {a.rotulo}
              </button>
            ))}
          </div>

          <div id="mascote-opcoes" role="tabpanel" aria-labelledby={`aba-${aba}`} className="min-w-0 p-4">
            {lista && (
              <div role="radiogroup" aria-label={ABAS.find((a) => a.id === aba)?.rotulo} className="grid grid-cols-3 gap-2 @md:grid-cols-4">
                {LISTAS[lista].map((op) => {
                  const on = config[lista] === op;
                  const rotulo = (ROTULOS[lista] as Record<string, string>)[op] ?? op;
                  return (
                    <button
                      key={op}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={rotulo}
                      onClick={() => escolher(lista, op as never)}
                      className={`flex min-w-0 flex-col items-center gap-1 border-[1.5px] p-1.5 transition ${
                        on ? "border-foreground bg-mint shadow-[3px_3px_0_var(--line)]" : "border-line-soft hover:border-line"
                      }`}
                      data-testid={`mascote-op-${lista}-${op}`}
                    >
                      <Miniatura config={{ ...config, [lista]: op }} />
                      <span className="w-full truncate text-center font-mono text-[12px]">{rotulo}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {aba === "cores" && (
              <div className="flex flex-col gap-5">
                {(
                  [
                    ["corPrincipal", "cor principal"],
                    ["corDetalhe", "cor de detalhe"],
                  ] as const
                ).map(([campo, titulo]) => (
                  <div key={campo} className="flex flex-col gap-2">
                    <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">{titulo}</p>
                    <div role="radiogroup" aria-label={titulo} className="grid grid-cols-6 gap-2">
                      {PALETA.map((c) => {
                        const on = config[campo] === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={c.nome}
                            title={c.nome}
                            onClick={() => escolher(campo, c.id as CorId)}
                            className={`aspect-square min-h-[40px] border-[1.5px] border-line ${on ? "outline-2 outline-offset-2 outline-foreground" : ""}`}
                            style={{ background: c.hex }}
                            data-testid={`mascote-op-${campo}-${c.id}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {aba === "pose" && (
              <div role="radiogroup" aria-label="pose" className="grid gap-2 @md:grid-cols-3">
                {POSES.map((p) => {
                  const on = config.pose === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => escolher("pose", p)}
                      className={`flex flex-col items-start gap-0.5 border-[1.5px] px-3 py-2.5 text-left ${
                        on ? "border-foreground bg-mint shadow-[3px_3px_0_var(--line)]" : "border-line-soft hover:border-line"
                      }`}
                      data-testid={`mascote-op-pose-${p}`}
                    >
                      <span className="font-bold">{ROTULOS.pose[p]}</span>
                      <span className="font-mono text-[12px] text-muted">{POSE_TEXTO[p]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-auto flex flex-col gap-3 border-t-2 border-line p-4">
            <p className="text-[14px] text-muted">{COPY_CRESCE}</p>
            {erroGeral && (
              <p role="alert" className="font-mono text-[13px] text-orange" data-testid="mascote-erro">
                {erroGeral}
              </p>
            )}
            <div className="flex flex-col-reverse gap-3 @md:flex-row @md:items-center @md:justify-between">
              <p className="font-mono text-[12.5px] text-muted" aria-live="polite" data-testid="mascote-estado">
                {estado === "salvando" ? "salvando…" : estado === "salvo" && !sujo ? "salvo" : sujo ? (gravado ? "mudanças não salvas" : "ainda não salvo") : "salvo"}
              </p>
              <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
                {extra}
                <button
                  type="button"
                  onClick={salvar}
                  disabled={estado === "salvando"}
                  className="btn w-full font-mono @md:w-auto"
                  data-testid="mascote-salvar"
                >
                  {estado === "salvando" ? "salvando…" : rotuloSalvar}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
