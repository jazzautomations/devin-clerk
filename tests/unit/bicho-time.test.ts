import { describe, expect, it } from "vitest";
import { ESPECIE_DEFS } from "@/lib/mascote/especies";
import { hashMascote } from "@/lib/mascote/isometrico";
import { bandeiraPeca, iniciaisDoTime, matrizBandeira, teamConfig, type IntegranteDoTime } from "@/lib/mascote/time";
import { PADRAO } from "@/lib/mascote/validar";
import { montar } from "@/lib/mascote/voxel";
import { MAX_MALHA, planSalao, type SalaoBicho, type SalaoTime } from "@/lib/telaoLayout";
import type { Especie, MascoteConfig } from "@/lib/mascote/tipos";

// Bicho do time e salão do telão (spec 046, onda 4 — telao-e-bicho-do-time):
// composição determinística a partir dos integrantes, bandeira no encaixe da
// mão e o plano da ilha com o limite de malhas medido em 300 bichos.

function cfg(especie: Especie, extra: Partial<MascoteConfig> = {}): MascoteConfig {
  const [corPrincipal, corDetalhe] = ESPECIE_DEFS[especie].cores;
  return { ...PADRAO, especie, corPrincipal, corDetalhe, nome: "Teste", ...extra };
}

const ana: IntegranteDoTime = { username: "ana", config: cfg("patinho", { corPrincipal: "amarelo", acessorio: "nada" }) };
const bia: IntegranteDoTime = { username: "bia", config: cfg("mouse", { corPrincipal: "azul", corDetalhe: "ceu", acessorio: "fone" }) };
const caio: IntegranteDoTime = { username: "caio", config: cfg("cafe", { corPrincipal: "rosa", acessorio: "oculos" }) };

describe("teamConfig", () => {
  it("monta com uma parte do bicho de cada integrante", () => {
    const t = teamConfig([ana, bia, caio], "Time Alfa");
    expect(t.especie).toBe("patinho"); // espécie do 1º por username
    expect(t.corPrincipal).toBe("azul"); // cor do 2º
    expect(t.corDetalhe).toBe("ceu");
    expect(t.acessorio).toBe("oculos"); // acessório do 3º
    expect(t.nome).toBe("Time Alfa");
  });

  it("não depende da ordem em que os integrantes chegam", () => {
    const a = teamConfig([ana, bia, caio], "Time Alfa");
    const b = teamConfig([caio, ana, bia], "Time Alfa");
    expect(b).toEqual(a);
  });

  it("time de uma pessoa usa o bicho dela", () => {
    const t = teamConfig([bia], "Solo");
    expect(t.especie).toBe("mouse");
    expect(t.corPrincipal).toBe("azul");
    expect(t.acessorio).toBe("fone");
    expect(t.nome).toBe("Solo");
  });

  it("time de dois: cor do 2º e acessório do 1º", () => {
    const t = teamConfig([ana, bia], "Dupla");
    expect(t.corPrincipal).toBe("azul");
    expect(t.acessorio).toBe("nada");
  });

  it("time sem integrante vinculado não quebra: cai na semente com o nome do time", () => {
    const t = teamConfig([], "Sem Gente");
    expect(t.nome).toBe("Sem Gente");
    expect(t.v).toBe(1);
  });

  it("nome do time cabe no limite do bicho", () => {
    expect(teamConfig([ana], "Um Nome de Time Bem Comprido Demais").nome).toHaveLength(20);
  });

  it("é estável: mesma composição, mesmo hash de arte", () => {
    expect(hashMascote(teamConfig([ana, bia], "Dupla"))).toBe(hashMascote(teamConfig([bia, ana], "Dupla")));
  });
});

describe("bandeira do time", () => {
  it("iniciais: duas palavras viram duas letras, uma palavra vira as duas primeiras", () => {
    expect(iniciaisDoTime("Time Alfa")).toBe("TA");
    expect(iniciaisDoTime("Patinho")).toBe("PA");
    expect(iniciaisDoTime("time 42")).toBe("T4");
    expect(iniciaisDoTime("")).toBe("T");
  });

  it("matriz da bandeira tem 5 linhas e o pano do tamanho das iniciais", () => {
    const uma = matrizBandeira("T");
    const duas = matrizBandeira("TA");
    expect(uma).toHaveLength(5);
    expect(uma[0]).toHaveLength(3);
    expect(duas[0]).toHaveLength(7); // 3 + 1 de espaço + 3
    expect(duas.every((l) => /^[#w.]+$/.test(l))).toBe(true);
  });

  it("a bandeira é uma peça na mão, com mastro, pano e as iniciais pintadas", () => {
    const p = bandeiraPeca("TA");
    expect(p.encaixe).toBe("mao");
    expect(p.primitivas.some((x) => x.tipo === "pintura")).toBe(true);
    expect(p.primitivas.filter((x) => x.tipo === "caixa")).toHaveLength(2);
  });

  it("entra no bicho por extras e desenha sem sair da grade", () => {
    const base = cfg("patinho", { mao: "nada" });
    const sem = montar(base);
    const com = montar(base, { extras: [bandeiraPeca("TA")] });
    const voxels = (m: typeof sem) => m.partes.reduce((n, p) => n + p.voxels.length, 0);
    expect(voxels(com)).toBeGreaterThan(voxels(sem));
    expect(com.fora).toBe(0);
  });
});

// ---------- salão ----------

const time = (id: number, delivered = false): SalaoTime => ({
  id,
  name: `Time ${id}`,
  delivered,
  src: `/api/mascote/time/${id}`,
});

const bicho = (memberId: number, teamId: number | null): SalaoBicho => ({
  memberId,
  primeiroNome: `P${memberId}`,
  src: `/api/mascote/m/${memberId}`,
  teamId,
});

describe("planSalao", () => {
  it("com 300 bichos: no máximo 60 malhas, o resto sprite", () => {
    const bichos = Array.from({ length: 300 }, (_, i) => bicho(i + 1, i % 3 === 0 ? null : (i % 5) + 1));
    const times = Array.from({ length: 5 }, (_, i) => time(i + 1));
    const plano = planSalao(bichos, times);
    expect(plano.bichos).toHaveLength(300);
    expect(plano.malhas).toBe(MAX_MALHA);
    expect(plano.sprites).toBe(300 - MAX_MALHA);
    expect(plano.bichos.filter((b) => b.modo === "malha")).toHaveLength(60);
    expect(plano.bichos.slice(60).every((b) => b.modo === "sprite")).toBe(true);
  });

  it("sem time, o bicho fica na praça (perto do centro)", () => {
    const plano = planSalao([bicho(1, null), bicho(2, null)], []);
    expect(plano.bandeiras).toHaveLength(0);
    for (const b of plano.bichos) expect(Math.hypot(b.x, b.z)).toBeLessThan(6);
  });

  it("quem tem time fica junto da bandeira do time", () => {
    const plano = planSalao([bicho(1, 7), bicho(2, 7), bicho(3, 7)], [time(7)]);
    const bandeira = plano.bandeiras.find((b) => b.teamId === 7)!;
    expect(bandeira).toBeTruthy();
    for (const b of plano.bichos) {
      expect(b.teamId).toBe(7);
      expect(Math.hypot(b.x - bandeira.x, b.z - bandeira.z)).toBeLessThanOrEqual(3);
    }
    // e a praça fica pro outro lado: nenhum bicho de time no centro
    expect(plano.bichos.every((b) => Math.hypot(b.x, b.z) > 3)).toBe(true);
  });

  it("entrega do time levanta a bandeira", () => {
    const baixa = planSalao([bicho(1, 7)], [time(7, false)]).bandeiras[0];
    const alta = planSalao([bicho(1, 7)], [time(7, true)]).bandeiras[0];
    expect(alta.alta).toBe(true);
    expect(baixa.alta).toBe(false);
    expect(alta.y).toBeGreaterThan(baixa.y);
  });

  it("é determinístico e cabe na ilha", () => {
    const bichos = [bicho(3, 2), bicho(1, null), bicho(2, 2), bicho(4, 1)];
    const a = planSalao(bichos, [time(1), time(2)]);
    const b = planSalao([...bichos].reverse(), [time(2), time(1)]);
    expect(b).toEqual(a);
    const meio = a.lado / 2;
    for (const x of a.bichos) {
      expect(Math.abs(x.x)).toBeLessThanOrEqual(meio);
      expect(Math.abs(x.z)).toBeLessThanOrEqual(meio);
    }
    for (const f of a.bandeiras) expect(Math.abs(f.x)).toBeLessThanOrEqual(meio);
  });

  it("salão vazio não quebra", () => {
    const plano = planSalao([], []);
    expect(plano.bichos).toHaveLength(0);
    expect(plano.malhas).toBe(0);
    expect(plano.lado).toBeGreaterThan(0);
  });
});
