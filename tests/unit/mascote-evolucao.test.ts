import { describe, expect, it } from "vitest";
import { ESTAGIOS, ENCAIXES, ESPECIES, type Estagio, type MascoteConfig } from "@/lib/mascote/tipos";
import { PADRAO } from "@/lib/mascote/validar";
import { montar } from "@/lib/mascote/voxel";
import {
  ITENS,
  ITEM_IDS,
  ITEM_MAX,
  normalizarItens,
  pecaItem,
  type ItemId,
} from "@/lib/mascote/itens";
import {
  avatarDoBicho,
  estagioPorFatos,
  itensDestravados,
  type Contexto,
} from "@/lib/mascote/evolucao";
import { hashMascote, toSvg } from "@/lib/mascote/isometrico";
import type { FactKind } from "@/lib/evidence";

// Itens e evolução do bicho (spec 046, onda 4, migration 047): os 10 itens
// montam nas 8 espécies e nos 3 estágios sem sair da grade, o estágio é puro
// (0/1-3/4+) e só fato verificado destrava item.

const cfg = (especie: MascoteConfig["especie"], extra: Partial<MascoteConfig> = {}): MascoteConfig => ({
  ...PADRAO,
  especie,
  nome: "Teste",
  ...extra,
});

/** contexto falso: só o que cada regra olha */
function ctx(o: {
  fatos?: Partial<Record<FactKind, number>>;
  ultimo?: Partial<Record<FactKind, string>>;
  total?: number;
  sequencia?: number;
  badges?: Record<string, string>;
}): Contexto {
  const fatos = o.fatos ?? {};
  const total = o.total ?? Object.values(fatos).reduce((s, n) => s + (n ?? 0), 0);
  return {
    fatos: fatos as Record<FactKind, number>,
    ultimo: o.ultimo ?? {},
    total,
    semanas: { total: o.sequencia ?? 0, sequencia: o.sequencia ?? 0 },
    badges: new Map(Object.entries(o.badges ?? {})),
  };
}

describe("catálogo de itens", () => {
  it("10 itens, cada um com nome, encaixe, o que destrava e por que ganhou", () => {
    expect(ITEM_IDS).toHaveLength(10);
    expect(new Set(ITEM_IDS).size).toBe(10);
    for (const id of ITEM_IDS) {
      const item = ITENS[id];
      expect(item.id).toBe(id);
      expect(item.nome.length).toBeGreaterThan(2);
      expect(ENCAIXES).toContain(item.encaixe);
      expect(item.destrava.length).toBeGreaterThan(8);
      expect(item.ganhou.length).toBeGreaterThan(8);
      expect(item.primitivas.length).toBeGreaterThan(0);
    }
    // peito, costas, mão e topo: os 4 encaixes que o motor já conhece
    expect(new Set(ITEM_IDS.map((id) => ITENS[id].encaixe))).toEqual(new Set(["peito", "costas", "mao", "topo"]));
  });

  it("o crachá é presença, a mochila é entrega, o megafone é organização", () => {
    expect(ITENS.cracha.encaixe).toBe("peito");
    expect(ITENS.mochila.encaixe).toBe("costas");
    expect(ITENS.medalha.encaixe).toBe("peito");
    expect(ITENS.cachecol.encaixe).toBe("peito");
    expect(ITENS.prancheta.encaixe).toBe("mao");
    expect(ITENS.megafone.encaixe).toBe("mao");
    expect(ITENS.broto.encaixe).toBe("topo");
    expect(ITENS.estrela.encaixe).toBe("topo");
    expect(ITENS.antena.encaixe).toBe("topo");
    expect(ITENS.mapa.encaixe).toBe("mao");
  });

  it("normalizarItens limpa lixo, deduplica e corta em 3", () => {
    expect(normalizarItens(["cracha", "cracha", "nao-existe", 7, "mochila"])).toEqual(["cracha", "mochila"]);
    expect(normalizarItens(["cracha", "mochila", "medalha", "mapa"])).toHaveLength(ITEM_MAX);
    expect(normalizarItens("cracha")).toEqual([]);
    expect(normalizarItens(null)).toEqual([]);
  });
});

describe("montar com itens", () => {
  it("cada um dos 10 itens monta nas 8 espécies e nos 3 estágios, dentro da grade", () => {
    for (const especie of ESPECIES)
      for (const estagio of ESTAGIOS)
        for (const id of ITEM_IDS) {
          const m = montar(cfg(especie), { estagio, itens: [pecaItem(id)] });
          const parte = m.partes.find((p) => p.nome === id);
          expect(parte, `${especie}/${estagio}/${id}`).toBeDefined();
          expect(parte!.voxels.length, `${especie}/${estagio}/${id}`).toBeGreaterThan(0);
          expect(m.fora, `${especie}/${estagio}/${id}`).toBe(0);
        }
  });

  it("os itens não somem quando o bicho encolhe no filhote", () => {
    for (const especie of ESPECIES) {
      const filhote = montar(cfg(especie), { estagio: "filhote", itens: [pecaItem("cracha"), pecaItem("mochila")] });
      expect(filhote.fora).toBe(0);
      for (const id of ["cracha", "mochila"] as ItemId[]) {
        expect(filhote.partes.find((p) => p.nome === id)!.voxels.length).toBeGreaterThan(0);
      }
    }
  });

  it("três itens juntos (um por encaixe) continuam na grade", () => {
    const combinacoes: ItemId[][] = [
      ["cracha", "mochila", "broto"],
      ["medalha", "mochila", "antena"],
      ["prancheta", "cachecol", "estrela"],
      ["megafone", "mochila", "mapa"],
    ];
    for (const especie of ESPECIES)
      for (const estagio of ESTAGIOS)
        for (const combo of combinacoes) {
          const m = montar(cfg(especie), { estagio, itens: combo.map(pecaItem) });
          expect(m.fora, `${especie}/${estagio}/${combo.join("+")}`).toBe(0);
        }
  });

  it("o SVG com itens continua válido e abaixo de 40 KB", () => {
    for (const especie of ESPECIES) {
      const svg = toSvg(montar(cfg(especie), { estagio: "adulto", itens: [pecaItem("mochila"), pecaItem("medalha"), pecaItem("antena")] }));
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.length).toBeLessThan(40_000);
    }
  });
});

describe("estágio por fato", () => {
  it("0 fato = filhote, 1 a 3 = jovem, 4+ = adulto", () => {
    expect(estagioPorFatos(0)).toBe("filhote");
    expect(estagioPorFatos(1)).toBe("jovem");
    expect(estagioPorFatos(3)).toBe("jovem");
    expect(estagioPorFatos(4)).toBe("adulto");
    expect(estagioPorFatos(99)).toBe("adulto");
    expect(estagioPorFatos(-1)).toBe("filhote");
    expect(estagioPorFatos(Number.NaN)).toBe("filhote");
  });

  it("só devolve estágio que o motor conhece", () => {
    for (const n of [0, 1, 2, 3, 4, 10]) expect(ESTAGIOS as readonly Estagio[]).toContain(estagioPorFatos(n));
  });
});

describe("itens destravados", () => {
  it("sem fato, sem item", () => {
    expect(itensDestravados(ctx({}))).toEqual([]);
  });

  it("cada regra responde ao seu fato", () => {
    expect(itensDestravados(ctx({ fatos: { presenca: 1 } }))).toEqual(["cracha"]);
    expect(itensDestravados(ctx({ fatos: { entrega: 1 } }))).toEqual(["mochila"]);
    expect(itensDestravados(ctx({ fatos: { premio: 1 } }))).toEqual(["medalha"]);
    expect(itensDestravados(ctx({ fatos: { presenca: 2 } }))).toEqual(expect.arrayContaining(["cracha", "cachecol"]));
    expect(itensDestravados(ctx({ fatos: { mentoria: 1 } }))).toEqual(["prancheta"]);
    expect(itensDestravados(ctx({ fatos: { organizou: 1 } }))).toEqual(["megafone"]);
    expect(itensDestravados(ctx({ sequencia: 4 }))).toEqual(["broto"]);
    expect(itensDestravados(ctx({ sequencia: 3 }))).toEqual([]);
    expect(itensDestravados(ctx({ badges: { "quatro-semanas": "2025-01-01 00:00:00" } }))).toEqual(["estrela"]);
    expect(itensDestravados(ctx({ badges: { roda: "2025-01-01 00:00:00" } }))).toEqual(["antena"]);
    expect(itensDestravados(ctx({ badges: { ponte: "2025-01-01 00:00:00" } }))).toEqual(["mapa"]);
  });

  it("o mais recente vem primeiro (o perfil mostra os 3 últimos)", () => {
    const lista = itensDestravados(
      ctx({
        fatos: { presenca: 2, entrega: 1, premio: 1 },
        ultimo: {
          presenca: "2025-01-10 10:00:00",
          entrega: "2025-03-01 10:00:00",
          premio: "2025-02-01 10:00:00",
        },
      }),
    );
    expect(lista.slice(0, 3)).toEqual(["mochila", "medalha", "cracha"]);
  });

  it("like, post e comentário não existem no contexto: nada muda", () => {
    // o contexto só tem fato verificado; passar "like" não é nem um FactKind
    const c = ctx({ fatos: { duvida: 3 }, total: 3 });
    expect(itensDestravados(c)).toEqual([]);
    expect(estagioPorFatos(c.total)).toBe("jovem");
  });
});

describe("avatar do bicho na URL", () => {
  const config = cfg("patinho");

  it("leva estágio, itens e hash; sem itens, só estágio e hash", () => {
    const sem = avatarDoBicho(12, config, [], "filhote");
    expect(sem.src).toBe(`/api/mascote/m/12?e=filhote&v=${sem.hash}`);
    const com = avatarDoBicho(12, config, ["cracha", "mochila"], "jovem");
    expect(com.src).toBe(`/api/mascote/m/12?e=jovem&i=cracha,mochila&v=${com.hash}`);
  });

  it("o hash é o mesmo que a rota do SVG calcula (cache imutável casa)", () => {
    const { hash } = avatarDoBicho(7, config, ["medalha"], "adulto");
    expect(hash).toBe(hashMascote(config, { itens: [pecaItem("medalha")], estagio: "adulto" }));
  });

  it("estágio e itens mudam a URL", () => {
    const a = avatarDoBicho(1, config, [], "filhote").src;
    const b = avatarDoBicho(1, config, [], "adulto").src;
    const c = avatarDoBicho(1, config, ["cracha"], "filhote").src;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
