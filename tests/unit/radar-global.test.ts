import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getHackathon, getOpenHackathons, type Hackathon } from "@/lib/hackathons";
import {
  brazilCanJoin,
  closingLabel,
  compactPrize,
  landingSample,
  matchesFilters,
  prizeBrlApprox,
  radarBadges,
  radarReach,
  radarScope,
  radarSectionOf,
  radarSections,
} from "@/lib/radar";

// Radar global (migration 026): seções, filtros, selos e a amostra da
// landing com Brasil + globais grandes abertos pra brasileiros.

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

function ev(id: string, f: Partial<Hackathon> = {}): Hackathon {
  return {
    id,
    name: id,
    organizer: "Org",
    startsAt: at(10),
    endsAt: null,
    format: "presencial",
    location: null,
    registrationUrl: "https://x.dev",
    registrationDeadline: null,
    prize: null,
    tags: [],
    active: true,
    partner: false,
    requiresApproval: false,
    region: null,
    source: "sympla",
    ...f,
  };
}

const sp = ev("sp", { region: "br", location: "São Paulo, SP", scope: "cidade", brazilOk: "sim" });
const meta = ev("meta", {
  format: "online", region: "online-mundo", source: "marcas", scope: "global", brazilOk: "sim",
  prize: "$1,000,000", prizeUsd: 1_000_000, registrationDeadline: at(10),
});
const ieee = ev("ieee", {
  format: "online", region: "online-mundo", source: "devpost", scope: "global", brazilOk: "sim",
  prize: "$3,000", prizeUsd: 3000, registrationDeadline: at(10), tags: ["ia"],
});
const amazon = ev("amazon", {
  format: "online", region: "online-mundo", source: "devpost", scope: "global", brazilOk: "nao",
  prize: "$138,000", prizeUsd: 138_000, registrationDeadline: at(8),
});
const lablab = ev("lablab", { format: "online", region: "online-mundo", source: "lablab", scope: "global" });
const mumbai = ev("mumbai", { region: "exterior", source: "ethglobal", location: "Mumbai, Índia", scope: "cidade", country: "Índia" });
const usOnly = ev("usonly", { region: "exterior", source: "devpost", location: "Boston", scope: "pais", country: "EUA", brazilOk: "nao" });

describe("seções do /radar", () => {
  it("Brasil → online aberto → lá fora → não informado → não aceita", () => {
    const s = radarSections([amazon, lablab, mumbai, ieee, sp, meta, usOnly], NOW);
    expect(s.map((x) => x.key)).toEqual(["brasil", "online-aberto", "lafora", "nao-informado", "fechado"]);
    expect(s[0].title).toBe("No Brasil");
    expect(s[1].title).toBe("Online e abertos pra brasileiros");
    expect(s.find((x) => x.key === "fechado")!.groups[0].events.map((h) => h.id)).toEqual(["amazon", "usonly"]);
  });

  it("online aberto: mesmo prazo, maior prêmio primeiro; prazo mais perto vence", () => {
    const soon = ev("soon", { ...ieee, id: "soon", registrationDeadline: at(3), prizeUsd: 500, prize: "$500" });
    const s = radarSections([ieee, meta, soon], NOW);
    expect(s[0].groups[0].events.map((h) => h.id)).toEqual(["soon", "meta", "ieee"]);
  });

  it("sem coluna: evento no Brasil é 'sim', online de fora fica sem resposta", () => {
    expect(brazilCanJoin(ev("x", { location: "Recife, PE" }))).toBe("sim");
    expect(brazilCanJoin(ev("y", { format: "online", source: "devpost", name: "PayPal AI" }))).toBeNull();
    expect(radarSectionOf(ev("y", { format: "online", source: "devpost", name: "PayPal AI" }))).toBe("nao-informado");
  });
});

describe("filtros", () => {
  const all = [sp, meta, ieee, amazon, lablab, mumbai, usOnly];
  const ids = (f: Parameters<typeof matchesFilters>[1]) => all.filter((h) => matchesFilters(h, f, NOW)).map((h) => h.id);

  it("alcance: Brasil, global e outros países", () => {
    expect(ids({ reach: "brasil" })).toEqual(["sp"]);
    expect(ids({ reach: "global" })).toEqual(["meta", "ieee", "amazon", "lablab"]);
    expect(ids({ reach: "outros" })).toEqual(["mumbai", "usonly"]);
  });
  it("aberto pra brasileiros, formato, prêmio, prazo e tema", () => {
    expect(ids({ brazilOnly: true })).toEqual(["sp", "meta", "ieee"]);
    expect(ids({ format: "online", brazilOnly: true })).toEqual(["meta", "ieee"]);
    expect(ids({ prize: "10k" })).toEqual(["meta", "amazon"]);
    expect(ids({ prize: "com" })).toEqual(["meta", "ieee", "amazon"]);
    expect(ids({ deadline: "semana" })).toEqual([]);
    expect(ids({ deadline: "mes" })).toContain("amazon");
    expect(ids({ tag: "ia" })).toEqual(["ieee"]);
  });
  it("radarReach e radarScope derivam quando a coluna está vazia", () => {
    expect(radarReach(ev("a", { location: "Canoas, RS" }))).toBe("brasil");
    expect(radarScope(ev("b", { format: "online", source: "devpost", name: "X" }))).toBe("global");
    expect(radarScope(ev("c", { location: "Stanford", source: "devpost" }))).toBe("cidade");
  });
});

describe("selos do card", () => {
  it("formato · alcance, brasileiro pode, prêmio curto e prazo", () => {
    expect(radarBadges(meta, NOW)).toEqual({
      where: "online · global",
      brazil: "sim",
      prize: "US$ 1 mi",
      closing: "fecha em 10 dias",
    });
    expect(radarBadges(usOnly, NOW).where).toBe("presencial · só EUA");
    expect(radarBadges(sp, NOW).where).toBe("presencial · SP");
    expect(radarBadges(mumbai, NOW).where).toBe("presencial · Índia");
  });
  it("prêmio curto na moeda original e o aproximado em real", () => {
    expect(compactPrize("$138,000")).toBe("US$ 138 mil");
    expect(compactPrize("$50,000")).toBe("US$ 50 mil");
    expect(compactPrize("€30,000")).toBe("€ 30 mil");
    expect(compactPrize("R$ 15 mil")).toBe("R$ 15 mil");
    expect(compactPrize("$9,000")).toBe("US$ 9 mil");
    expect(compactPrize("$1,500")).toBe("US$ 1,5 mil");
    expect(compactPrize("muitos prêmios")).toBe("muitos prêmios");
    expect(prizeBrlApprox(meta)).toBe("≈ R$ 5,5 mi");
    expect(prizeBrlApprox(ev("r", { prize: "R$ 15 mil", prizeUsd: 2700 }))).toBeNull();
  });
  it("fecha hoje/amanhã/em N dias; longe ou passado não ganha selo", () => {
    expect(closingLabel(ev("a", { registrationDeadline: at(0.5) }), NOW)).toBe("fecha hoje");
    expect(closingLabel(ev("a", { registrationDeadline: at(1.5) }), NOW)).toBe("fecha amanhã");
    expect(closingLabel(ev("a", { registrationDeadline: at(3.2) }), NOW)).toBe("fecha em 3 dias");
    expect(closingLabel(ev("a", { registrationDeadline: at(40) }), NOW)).toBeNull();
    expect(closingLabel(ev("a", { registrationDeadline: at(-1) }), NOW)).toBeNull();
  });
});

describe("landingSample — mistura Brasil e global aberto pra brasileiro", () => {
  const br = Array.from({ length: 6 }, (_, i) => ev(`br-${i}`, { region: "br", location: "Recife, PE" }));
  const casa = ev("casa", { partner: true, source: null, location: "Alphaville, SP" });
  const amanha = ev("amanha", { ...meta, id: "amanha", registrationDeadline: at(1) });

  it("Brasil na frente e os 2 globais de maior prêmio no fim; fecha-em-48h fora", () => {
    const { sample, count } = landingSample([casa, ...br, ieee, amazon, meta, lablab, amanha], NOW, 4);
    expect(sample.map((h) => h.id)).toEqual(["casa", "br-0", "meta", "ieee"]);
    // +N: tudo que ainda dá pra entrar e não exclui brasileiro (lablab sem
    // regra conta; amazon não; amanhã não)
    expect(count).toBe(1 + 6 + 2 + 1);
  });
  it("sem global aberto pra brasileiro, só Brasil", () => {
    const { sample } = landingSample([casa, ...br, amazon, lablab], NOW, 4);
    expect(sample.map((h) => h.id)).toEqual(["casa", "br-0", "br-1", "br-2"]);
  });
  it("pouco Brasil: completa com global", () => {
    const { sample } = landingSample([casa, meta, ieee], NOW, 4);
    expect(sample.map((h) => h.id)).toEqual(["casa", "meta", "ieee"]);
  });
});

describe("integração com o banco — colunas da 026 chegam inteiras", () => {
  beforeEach(async () => {
    await db.exec("DELETE FROM hackathons WHERE id LIKE 'rg-%'");
  });

  it("grava e lê alcance, regra, prêmio em US$ e prazo de entrega", async () => {
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl,
           tags, active, source, region, prize, scope, brazilOk, eligibilityNote, eligibilityUrl,
           prizeUsd, submissionDeadline, brand)
         VALUES ('rg-meta', 'Meta Global AI Developer Hackathon', 'Meta', ?, ?, 'online',
           'https://dev.meta.ai/events/global-hackathon', '["ia"]', 1, 'marcas', 'online-mundo',
           '$1,000,000', 'global', 'sim', 'Open worldwide, except …', 'https://dev.meta.ai/events/global-hackathon',
           1000000, ?, 'Meta')`,
      )
      .run(at(11), at(25), at(20));
    const h = (await getHackathon("rg-meta"))!;
    expect(h.brazilOk).toBe("sim");
    expect(h.scope).toBe("global");
    expect(Number(h.prizeUsd)).toBe(1_000_000);
    expect(h.brand).toBe("Meta");
    expect(radarSectionOf(h)).toBe("online-aberto");
    const open = await getOpenHackathons(NOW);
    const { sample } = landingSample(open, NOW, 4);
    expect(sample.map((x) => x.id)).toContain("rg-meta");
  });
});

describe("brazilCanJoin — avaliado e vazio é não informado", () => {
  it("online em português de Portugal (scraper avaliou) não vira 'sim'", () => {
    const pt = ev("pt", { format: "online", region: "online-br", source: "taikai", scope: "brasil", brazilOk: null });
    expect(brazilCanJoin(pt)).toBeNull();
    expect(radarSectionOf(pt)).toBe("nao-informado");
  });
});
