import { describe, expect, it } from "vitest";
import { isPublicApi, decideAccess } from "@/lib/access";
import { ESPECIE_DEFS } from "@/lib/mascote/especies";
import { hashMascote, mascoteSrc, svgDoBicho, tamanhoDoCache, toSvg } from "@/lib/mascote/isometrico";
import { COR_IDS, PALETA, corDoOlho } from "@/lib/mascote/paleta";
import { NOMES, configFromSeed, mulberry32, resolveMascote, sortearConfig, sortearNome } from "@/lib/mascote/semente";
import {
  ACESSORIOS,
  BOCAS,
  CENARIOS,
  ENCAIXES,
  ESPECIES,
  ESTAGIOS,
  GRADE,
  MAOS,
  OLHOS,
  POSES,
  ROUPAS,
  TOPOS,
  type Encaixe,
  type Especie,
  type MascoteConfig,
  type Modelo,
  type Peca,
} from "@/lib/mascote/tipos";
import { PADRAO, lerMascoteSalvo, normalizarNome, validarMascote } from "@/lib/mascote/validar";
import { NORMAL_CANONICA, achatar, dentroDaGrade, montar, rotacao } from "@/lib/mascote/voxel";

// Bicho do builder (migration 043): validar, semente, motor (montar com e
// sem opts, estágio, encaixes), SVG isométrico (tamanho, sem script, cache).

function cfg(especie: Especie, extra: Partial<MascoteConfig> = {}): MascoteConfig {
  const [corPrincipal, corDetalhe] = ESPECIE_DEFS[especie].cores;
  return { ...PADRAO, especie, corPrincipal, corDetalhe, nome: "Teste", ...extra };
}

const semCenario = (m: Modelo) => m.partes.filter((p) => p.nome !== "cenario");
const contagem = (m: Modelo) => semCenario(m).reduce((n, p) => n + p.voxels.length, 0);

describe("validarMascote", () => {
  it("aceita o config completo e devolve igual", () => {
    const c = cfg("patinho", { topo: "cartola", roupa: "gravata", mao: "lapis", acessorio: "fone", pose: "danca", cenario: "palco" });
    const r = validarMascote(c);
    expect(r).toEqual({ ok: true, config: c });
  });

  it("preenche o que falta com o padrão", () => {
    const r = validarMascote({ especie: "mouse", nome: "Bit" });
    expect(r.ok && r.config).toEqual({ ...PADRAO, especie: "mouse", nome: "Bit" });
  });

  it("aceita a versão antiga {v, especie, cor, acessorio, olhos, nome}", () => {
    const r = validarMascote({ v: 1, especie: "teclado", cor: "azul", acessorio: "bone", olhos: "sono", nome: "Velho" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.corPrincipal).toBe("azul");
    expect(r.config.topo).toBe("bone");
    expect(r.config.acessorio).toBe("nada");
    expect(r.config.olhos).toBe("sono");
    const oculos = validarMascote({ v: 1, especie: "cracha", cor: "rosa", acessorio: "oculos", olhos: "ponto", nome: "Ana" });
    expect(oculos.ok && oculos.config.acessorio).toBe("oculos");
  });

  it.each([
    ["especie", "dragao"],
    ["corPrincipal", "#ff0000"],
    ["corDetalhe", "vermelho"],
    ["olhos", "laser"],
    ["boca", "bico"],
    ["topo", "tiara"],
    ["roupa", "terno"],
    ["mao", "espada"],
    ["acessorio", "bone-de-aba"],
    ["pose", "voa"],
    ["cenario", "praia"],
  ])("campo %s inválido dá erro só nele", (campo, valor) => {
    const r = validarMascote({ ...cfg("cracha"), [campo]: valor });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual([campo]);
    expect(r.erro).toBe(r.erros[campo as keyof typeof r.erros]);
  });

  it("sem espécie, sem nome, versão errada ou lixo é erro", () => {
    expect(validarMascote({ nome: "x" }).ok).toBe(false);
    expect(validarMascote({ especie: "cracha" }).ok).toBe(false);
    expect(validarMascote({ ...cfg("cracha"), v: 2 }).ok).toBe(false);
    for (const lixo of [null, "x", 1, [], undefined]) expect(validarMascote(lixo).ok).toBe(false);
  });

  it("nome: até 20, sem link, sem controle, espaço normalizado", () => {
    expect(normalizarNome("  Bolota   da  Silva ")).toEqual({ ok: true, nome: "Bolota da Silva" });
    expect(normalizarNome("a".repeat(20)).ok).toBe(true);
    expect(normalizarNome("a".repeat(21)).ok).toBe(false);
    expect(normalizarNome("Ção🦆".padEnd(20, "x")).ok).toBe(true);
    for (const ruim of ["https://x.dev", "www.golpe", "meu.site.com.br", "pix.com", "", "   ", 5]) expect(normalizarNome(ruim).ok).toBe(false);
    expect(normalizarNome("Bit\u0000‮Byte")).toEqual({ ok: true, nome: "BitByte" });
  });

  it("lerMascoteSalvo: JSON inválido ou config ruim vira null", () => {
    expect(lerMascoteSalvo(null)).toBeNull();
    expect(lerMascoteSalvo("{")).toBeNull();
    expect(lerMascoteSalvo(JSON.stringify({ especie: "x", nome: "y" }))).toBeNull();
    expect(lerMascoteSalvo(JSON.stringify(cfg("cafe")))).toEqual(cfg("cafe"));
  });
});

describe("semente", () => {
  it("mulberry32 é determinístico", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it("mesmo id, mesmo bicho; o config é sempre válido", () => {
    for (let id = 0; id < 300; id++) {
      const c = configFromSeed(id);
      expect(configFromSeed(id)).toEqual(c);
      expect(validarMascote(c)).toEqual({ ok: true, config: c });
      expect(NOMES).toContain(c.nome);
      expect(c.corPrincipal).not.toBe(c.corDetalhe);
    }
  });

  it("ids diferentes espalham pelas espécies e nomes", () => {
    const especies = new Set<string>();
    const nomes = new Set<string>();
    for (let id = 1; id <= 200; id++) {
      especies.add(configFromSeed(id).especie);
      nomes.add(configFromSeed(id).nome);
    }
    expect(especies.size).toBe(ESPECIES.length);
    expect(nomes.size).toBeGreaterThan(25);
  });

  it("40 nomes curtos, sem repetir", () => {
    expect(NOMES).toHaveLength(40);
    expect(new Set(NOMES).size).toBe(40);
    for (const n of NOMES) expect(normalizarNome(n)).toEqual({ ok: true, nome: n });
  });

  it("resolveMascote: salvo válido ganha; inválido ou vazio cai na semente", () => {
    const salvo = cfg("foguete", { nome: "Meu" });
    expect(resolveMascote({ id: 7, mascote: JSON.stringify(salvo) })).toEqual(salvo);
    expect(resolveMascote({ id: 7, mascote: null })).toEqual(configFromSeed(7));
    expect(resolveMascote({ id: 7, mascote: "lixo" })).toEqual(configFromSeed(7));
  });

  it("sortear mantém o nome pedido; sortearNome troca o nome", () => {
    const r = mulberry32(1);
    expect(sortearConfig(r, "Fixo").nome).toBe("Fixo");
    expect(validarMascote(sortearConfig(r, "Fixo")).ok).toBe(true);
    expect(sortearNome(r, "Bit")).not.toBe("Bit");
  });
});

describe("paleta", () => {
  it("12 cores, ids únicos, olho troca pra papel na cor escura", () => {
    expect(PALETA).toHaveLength(12);
    expect(new Set(COR_IDS).size).toBe(12);
    expect(corDoOlho("#34363a")).toBe("#fefefe");
    expect(corDoOlho("#ffd23f")).toBe("#0c0c0c");
  });
});

describe("montar", () => {
  it("montar(config) e montar(config, {}) dão o mesmo resultado (adulto, sem itens)", () => {
    for (const e of ESPECIES) {
      const c = cfg(e, { topo: "bone", mao: "caneca" });
      expect(montar(c, {})).toEqual(montar(c));
      expect(montar(c, { estagio: "adulto", itens: [], extras: [] })).toEqual(montar(c));
    }
  });

  it("toda espécie fica dentro da grade 16 e tem corpo, braço e olhos", () => {
    for (const e of ESPECIES) {
      const m = montar(cfg(e));
      expect(m.fora).toBe(0);
      for (const p of semCenario(m)) for (const [x, y, z] of p.voxels) expect(dentroDaGrade([x, y, z])).toBe(true);
      const nomes = m.partes.map((p) => p.nome);
      expect(nomes).toContain("corpo");
      expect(nomes).toContain("braco-d");
      expect(m.partes.find((p) => p.nome === "olhos")!.voxels.length).toBeGreaterThan(0);
      expect(m.partes.find((p) => p.nome === "boca")!.voxels.length).toBeGreaterThan(0);
    }
  });

  it("estágio encolhe o corpo: filhote < jovem < adulto, olho do mesmo tamanho", () => {
    for (const e of ESPECIES) {
      const c = cfg(e);
      const [f, j, a] = ESTAGIOS.map((estagio) => montar(c, { estagio }));
      const corpo = (m: Modelo) => m.partes.find((p) => p.nome === "corpo")!.voxels.length;
      expect(corpo(f)).toBeLessThan(corpo(j));
      expect(corpo(j)).toBeLessThan(corpo(a));
      const olhos = (m: Modelo) => m.partes.find((p) => p.nome === "olhos")!.voxels.length;
      // olho não encolhe: o filhote fica com cara maior (pode perder um pixel na borda)
      expect(olhos(f)).toBeGreaterThanOrEqual(olhos(a) - 2);
      expect(contagem(f)).toBeLessThan(contagem(a));
    }
  });

  it("os 5 encaixes existem nas 8 espécies, nos 3 estágios, com a normal canônica", () => {
    for (const e of ESPECIES)
      for (const estagio of ESTAGIOS) {
        const m = montar(cfg(e), { estagio });
        for (const enc of ENCAIXES) {
          const p = m.encaixes[enc];
          expect(p, `${e}/${estagio}/${enc}`).toBeDefined();
          expect(dentroDaGrade(p.pos), `${e}/${estagio}/${enc} ${p.pos}`).toBe(true);
          expect(p.normal).toEqual(NORMAL_CANONICA[enc]);
        }
      }
  });

  it("uma Peca de teste em cada encaixe monta encostada e sem sair da grade", () => {
    for (const e of ESPECIES)
      for (const estagio of ESTAGIOS)
        for (const enc of ENCAIXES) {
          const teste: Peca = { id: "teste", encaixe: enc, cor: "#ff00aa", primitivas: [{ tipo: "caixa", de: [0, 0, 0], ate: [0, 1, 0] }] };
          const m = montar(cfg(e), { estagio, itens: [teste] });
          const parte = m.partes.find((p) => p.nome === "teste")!;
          expect(parte.voxels.length, `${e}/${estagio}/${enc}`).toBeGreaterThan(0);
          expect(m.fora, `${e}/${estagio}/${enc}`).toBe(0);
          // a origem fica numa célula vazia colada no bicho
          const [x, y, z] = m.encaixes[enc].pos;
          const n = m.encaixes[enc].normal;
          const sem = montar(cfg(e), { estagio });
          const cel = achatar(sem);
          expect(cel.has(`${x},${y},${z}`), `${e}/${estagio}/${enc} vazia`).toBe(false);
          expect(cel.has(`${x - n[0]},${y - n[1]},${z - n[2]}`), `${e}/${estagio}/${enc} encostada`).toBe(true);
        }
  });

  it("toda opção de peça cabe na grade em toda espécie", () => {
    const campos: [keyof MascoteConfig, readonly string[]][] = [
      ["topo", TOPOS],
      ["roupa", ROUPAS],
      ["mao", MAOS],
      ["acessorio", ACESSORIOS],
      ["olhos", OLHOS],
      ["boca", BOCAS],
      ["pose", POSES],
    ];
    for (const e of ESPECIES)
      for (const [campo, lista] of campos)
        for (const v of lista)
          for (const estagio of ESTAGIOS) expect(montar(cfg(e, { [campo]: v }), { estagio }).fora, `${e} ${campo}=${v} ${estagio}`).toBe(0);
  });

  it("itens e extras viram partes presas no dono do encaixe; nome repetido ganha sufixo", () => {
    const flag: Peca = { id: "bandeira", encaixe: "mao", cor: "detalhe", primitivas: [{ tipo: "caixa", de: [0, 0, 0], ate: [0, 2, 0] }] };
    const m = montar(cfg("cracha"), { extras: [flag, flag] });
    const partes = m.partes.filter((p) => p.nome.startsWith("bandeira"));
    expect(partes.map((p) => p.nome)).toEqual(["bandeira", "bandeira-2"]);
    expect(partes[0].pai).toBe("braco-d");
  });

  it("peça desenhada pra +x gira certo quando o encaixe aponta pra outro lado", () => {
    const R = rotacao([1, 0, 0], [0, 0, 1]);
    const ap = (v: [number, number, number]) => R.map((l) => l[0] * v[0] + l[1] * v[1] + l[2] * v[2]);
    expect(ap([1, 0, 0])).toEqual([0, 0, 1]);
    expect(ap([0, 1, 0])).toEqual([0, 1, 0]);
    const meia = rotacao([0, 0, 1], [0, 0, -1]);
    expect(meia.map((l) => l[2])).toEqual([0, 0, -1]);
  });

  it("cenário fica fora da grade e não conta como 'fora'", () => {
    for (const c of CENARIOS) {
      const m = montar(cfg("servidor", { cenario: c }));
      expect(m.fora).toBe(0);
      expect(m.partes.some((p) => p.nome === "cenario")).toBe(c !== "nada");
    }
  });
});

describe("toSvg", () => {
  const svgs: { nome: string; svg: string }[] = [];
  for (const e of ESPECIES)
    for (const a of ACESSORIOS)
      for (const estagio of ESTAGIOS) svgs.push({ nome: `${e}/${a}/${estagio}`, svg: toSvg(montar(cfg(e, { acessorio: a }), { estagio })) });

  it(`${ESPECIES.length} espécies x ${ACESSORIOS.length} acessórios x ${ESTAGIOS.length} estágios: SVG válido abaixo de 40 KB`, () => {
    expect(svgs).toHaveLength(8 * 5 * 3);
    for (const { nome, svg } of svgs) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), nome).toBe(true);
      expect(svg.endsWith("</svg>"), nome).toBe(true);
      expect(Buffer.byteLength(svg), nome).toBeLessThan(40 * 1024);
      expect(svg).not.toMatch(/<script|on\w+=|javascript:|href=/i);
      expect((svg.match(/<path /g) ?? []).length, nome).toBeGreaterThan(3);
      expect(svg).toMatch(/viewBox="-?\d+ -?\d+ \d+ \d+"/);
    }
  });

  it("o pior caso (tudo + cenário) também fica abaixo de 40 KB", () => {
    for (const e of ESPECIES)
      for (const cenario of CENARIOS) {
        const svg = toSvg(montar(cfg(e, { topo: "helice", roupa: "suspensorio", mao: "balao", acessorio: "fone", cenario })));
        expect(Buffer.byteLength(svg), `${e}/${cenario}`).toBeLessThan(40 * 1024);
      }
  });

  it("só desenha face que aparece: um cubo sozinho vira 3 faces (topo, esquerda, direita)", () => {
    const m: Modelo = {
      partes: [{ nome: "x", pai: null, pivo: [0, 0, 0], voxels: [[0, 0, 0, "#3ecf8e"]] }],
      encaixes: {} as Modelo["encaixes"],
      fora: 0,
    };
    const svg = toSvg(m);
    expect(svg).toContain('fill="#3ecf8e"'); // topo 100%
    expect(svg).toContain('fill="#33aa74"'); // esquerda 82%
    expect(svg).toContain('fill="#29895e"'); // direita 66%
    expect((svg.match(/<path /g) ?? []).length).toBe(3);
  });

  it("face escondida atrás de outro voxel não entra", () => {
    // dois cubos na diagonal de visão: o de trás some inteiro
    const m: Modelo = {
      partes: [
        {
          nome: "x",
          pai: null,
          pivo: [0, 0, 0],
          voxels: [
            [0, 0, 0, "#111111"],
            [1, 1, 1, "#eeeeee"],
          ],
        },
      ],
      encaixes: {} as Modelo["encaixes"],
      fora: 0,
    };
    expect(toSvg(m)).not.toContain("#111111");
  });

  it("título vem escapado", () => {
    const svg = toSvg(montar(cfg("cracha")), { titulo: '<b>"x"&' });
    expect(svg).toContain("<title>&lt;b&gt;&quot;x&quot;&amp;</title>");
  });
});

describe("hash, src e cache", () => {
  it("hash estável e sensível a config, estágio e itens", () => {
    const c = cfg("pizza");
    expect(hashMascote(c)).toBe(hashMascote({ ...c }));
    expect(hashMascote(c)).toBe(hashMascote(c, {}));
    expect(hashMascote(c)).toBe(hashMascote(c, { estagio: "adulto", itens: [] }));
    expect(hashMascote(c)).not.toBe(hashMascote({ ...c, olhos: "sono" }));
    expect(hashMascote(c)).not.toBe(hashMascote(c, { estagio: "filhote" }));
    const item: Peca = { id: "i", encaixe: "topo", cor: "corpo", primitivas: [] };
    expect(hashMascote(c)).not.toBe(hashMascote(c, { itens: [item] }));
    expect(hashMascote(c)).toMatch(/^[0-9a-z]+$/);
  });

  it("mascoteSrc aponta pra rota pública", () => {
    expect(mascoteSrc(12, "abc")).toBe("/api/mascote/m/12?v=abc");
    expect(mascoteSrc(12)).toBe("/api/mascote/m/12");
    expect(isPublicApi("/api/mascote/m/12")).toBe(true);
    expect(decideAccess("/api/mascote/m/12", { signedIn: false, onboarded: false })).toBe("next");
    expect(decideAccess("/api/members/me/mascote", { signedIn: false, onboarded: false })).toBe("unauthorized");
    expect(decideAccess("/perfil/bicho", { signedIn: false, onboarded: false })).toBe("signup");
  });

  it("svgDoBicho guarda no cache e nunca passa de 500", () => {
    const a = svgDoBicho(cfg("mouse"));
    expect(svgDoBicho(cfg("mouse")).svg).toBe(a.svg);
    for (let i = 0; i < 520; i++) svgDoBicho(configFromSeed(i));
    expect(tamanhoDoCache()).toBeLessThanOrEqual(500);
  });

  it("encaixe tem tipo fechado", () => {
    const e: Encaixe[] = ["topo", "olhos", "peito", "costas", "mao"];
    expect([...ENCAIXES]).toEqual(e);
    expect(GRADE).toBe(16);
  });
});
