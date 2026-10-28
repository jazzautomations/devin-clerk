import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ROTULOS } from "@/lib/mascote/acessorios";
import { ESPECIE_DEFS } from "@/lib/mascote/especies";
import { svgDataUri, toSvg } from "@/lib/mascote/isometrico";
import {
  ACESSORIOS,
  BOCAS,
  CENARIOS,
  ENCAIXES,
  ESPECIES,
  ESTAGIOS,
  MAOS,
  OLHOS,
  ROUPAS,
  TOPOS,
  type Encaixe,
  type Especie,
  type MascoteConfig,
  type MontarOpts,
  type Peca,
} from "@/lib/mascote/tipos";
import { montar } from "@/lib/mascote/voxel";
import { currentMember } from "@/lib/session";

// Grade de revisão do bicho (migration 043). "Ficar bonito" não é coisa que
// teste automático confere: esta página mostra cada espécie em cada
// combinação pra uma pessoa olhar antes do merge. Só admin global.

export const metadata: Metadata = { title: "grade dos bichos", robots: { index: false } };

const SECOES = [
  { id: "base", rotulo: "acessório × estágio" },
  { id: "topo", rotulo: "chapéu" },
  { id: "roupa", rotulo: "roupa" },
  { id: "mao", rotulo: "mão" },
  { id: "rosto", rotulo: "olhos e boca" },
  { id: "cenario", rotulo: "cenário" },
] as const;
type Secao = (typeof SECOES)[number]["id"];

const MARCA: Record<Encaixe, string> = {
  topo: "#e8188a",
  olhos: "#00a3e8",
  peito: "#ffb300",
  costas: "#7c3aed",
  mao: "#00b85c",
};

const marcas: Peca[] = ENCAIXES.map((e) => ({
  id: `marca-${e}`,
  encaixe: e,
  cor: MARCA[e] as `#${string}`,
  primitivas: [{ tipo: "pontos", pontos: [[0, 0, 0]] }],
}));

function base(especie: Especie, extra: Partial<MascoteConfig> = {}): MascoteConfig {
  const [corPrincipal, corDetalhe] = ESPECIE_DEFS[especie].cores;
  return {
    v: 1,
    especie,
    corPrincipal,
    corDetalhe,
    olhos: "ponto",
    boca: "sorriso",
    topo: "nada",
    roupa: "nada",
    mao: "nada",
    acessorio: "nada",
    pose: "pula",
    cenario: "nada",
    nome: ESPECIE_DEFS[especie].nome,
    ...extra,
  };
}

function Bicho({ config, opts, legenda }: { config: MascoteConfig; opts?: MontarOpts; legenda: string }) {
  const svg = toSvg(montar(config, opts), { tamanho: 112 });
  return (
    <figure className="flex w-[112px] shrink-0 flex-col items-center gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG gerado aqui, data URI */}
      <img src={svgDataUri(svg)} alt={legenda} width={112} height={112} className="border border-line-soft bg-background" />
      <figcaption className="w-full truncate text-center font-mono text-[11px] text-muted">{legenda}</figcaption>
    </figure>
  );
}

function Linha({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line py-4">
      <h3 className="font-mono text-[13px] font-semibold">{titulo}</h3>
      <div className="flex gap-2 overflow-x-auto pb-1">{children}</div>
    </div>
  );
}

export default async function BichosAdminPage({ searchParams }: PageProps<"/admin/bichos">) {
  const me = await currentMember();
  if (!me || me.role !== "admin") notFound();
  const sp = await searchParams;
  const secao: Secao = SECOES.some((s) => s.id === sp.secao) ? (sp.secao as Secao) : "base";

  return (
    <section className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 py-10 sm:px-6" data-testid="bichos-grade">
      <div className="flex flex-col gap-2">
        <Link href="/admin" className="self-start font-mono text-xs text-muted underline-offset-4 hover:text-accent hover:underline">
          ← admin
        </Link>
        <p className="tag self-start uppercase">revisão visual</p>
        <h1 className="text-[clamp(2rem,5vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.035em]">Grade dos bichos</h1>
        <p className="max-w-[60ch] text-muted">
          Toda espécie em cada combinação, no SVG que vai pras listas. Mudou arte de espécie ou peça? Olhe esta página antes do merge.
        </p>
      </div>

      <nav aria-label="seções da grade" className="flex flex-wrap gap-2">
        {SECOES.map((s) => (
          <Link
            key={s.id}
            href={`/admin/bichos?secao=${s.id}`}
            aria-current={secao === s.id ? "page" : undefined}
            className={`flex min-h-[40px] items-center border-[1.5px] border-line px-3 font-mono text-[13px] ${
              secao === s.id ? "bg-foreground text-band" : "hover:bg-mint"
            }`}
          >
            {s.rotulo}
          </Link>
        ))}
      </nav>

      {secao === "base" && (
        <>
          <div className="flex flex-col gap-2" data-testid="bichos-encaixes">
            <h2 className="text-xl font-extrabold tracking-[-0.03em]">Encaixes</h2>
            <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
              {ENCAIXES.map((e) => (
                <span key={e} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-3 w-3 border border-line" style={{ background: MARCA[e] }} />
                  {e}
                </span>
              ))}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {ESPECIES.map((e) => (
                <Bicho key={e} config={base(e)} opts={{ extras: marcas }} legenda={ESPECIE_DEFS[e].nome} />
              ))}
            </div>
          </div>
          {ESPECIES.map((e) => (
            <div key={e} className="flex flex-col" data-testid={`bichos-especie-${e}`}>
              <h2 className="text-xl font-extrabold tracking-[-0.03em]">{ESPECIE_DEFS[e].nome}</h2>
              {ESTAGIOS.map((est) => (
                <Linha key={est} titulo={est}>
                  {ACESSORIOS.map((a) => (
                    <Bicho key={a} config={base(e, { acessorio: a })} opts={{ estagio: est }} legenda={ROTULOS.acessorio[a]} />
                  ))}
                </Linha>
              ))}
            </div>
          ))}
        </>
      )}

      {secao !== "base" &&
        ESPECIES.map((e) => (
          <Linha key={e} titulo={ESPECIE_DEFS[e].nome}>
            {secao === "topo" && TOPOS.map((t) => <Bicho key={t} config={base(e, { topo: t })} legenda={ROTULOS.topo[t]} />)}
            {secao === "roupa" && ROUPAS.map((t) => <Bicho key={t} config={base(e, { roupa: t })} legenda={ROTULOS.roupa[t]} />)}
            {secao === "mao" && MAOS.map((t) => <Bicho key={t} config={base(e, { mao: t })} legenda={ROTULOS.mao[t]} />)}
            {secao === "rosto" &&
              OLHOS.map((o, i) => (
                <Bicho
                  key={o}
                  config={base(e, { olhos: o, boca: BOCAS[i % BOCAS.length] })}
                  legenda={`${ROTULOS.olhos[o]} · ${ROTULOS.boca[BOCAS[i % BOCAS.length]]}`}
                />
              ))}
            {secao === "cenario" && CENARIOS.map((t) => <Bicho key={t} config={base(e, { cenario: t })} legenda={ROTULOS.cenario[t]} />)}
          </Linha>
        ))}
    </section>
  );
}
