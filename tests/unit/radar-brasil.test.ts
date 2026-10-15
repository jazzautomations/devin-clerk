import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getOpenHackathons, type Hackathon } from "@/lib/hackathons";
import {
  closesSoon,
  dashboardList,
  landingSample,
  shortLocation,
  radarRegion,
} from "@/lib/radar";

// Radar Brasil-first: landing sem gringo online e sem o que fecha em menos
// de 48h; /radar com Brasil na frente; painel puxa a UF do perfil.

const NOW = new Date("2026-10-14T12:00:00Z");
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
    hosted: false,
    requiresApproval: false,
    region: null,
    source: "sympla",
    ...f,
  };
}

describe("radarRegion — usa a coluna e deriva quando vazia", () => {
  it("coluna gravada pelo scraper manda", () => {
    expect(radarRegion(ev("a", { region: "online-mundo", location: "Recife, PE" }))).toBe("online-mundo");
  });
  it("deriva: cidade/UF brasileira, exterior, online por fonte e por idioma", () => {
    expect(radarRegion(ev("a", { location: "Canoas, RS" }))).toBe("br");
    expect(radarRegion(ev("a", { location: "Santa Casa, São Paulo", source: "curadoria" }))).toBe("br");
    expect(radarRegion(ev("a", { location: "Mumbai, Índia", source: "curadoria" }))).toBe("exterior");
    expect(radarRegion(ev("a", { location: "Washington DC", source: "devpost" }))).toBe("exterior");
    expect(radarRegion(ev("a", { format: "online", source: "devpost", name: "PayPal AI Hackathon" }))).toBe("online-mundo");
    expect(radarRegion(ev("a", { format: "online", source: "devpost", name: "Desafio de Inovação em Saúde" }))).toBe("online-br");
    expect(radarRegion(ev("a", { format: "online", source: "sympla", name: "Hack Online" }))).toBe("online-br");
    // edição da casa (sem fonte) é brasileira
    expect(radarRegion(ev("a", { format: "online", source: null }))).toBe("online-br");
  });
});

describe("closesSoon — fecha em menos de 48h", () => {
  it("prazo de inscrição manda; sem ele, o início (ou o fim se já começou)", () => {
    expect(closesSoon(ev("a", { startsAt: at(1) }), NOW)).toBe(true);
    expect(closesSoon(ev("a", { startsAt: at(3) }), NOW)).toBe(false);
    expect(closesSoon(ev("a", { startsAt: at(10), registrationDeadline: at(1) }), NOW)).toBe(true);
    expect(closesSoon(ev("a", { startsAt: at(-5), endsAt: at(1) }), NOW)).toBe(true);
    expect(closesSoon(ev("a", { startsAt: at(-5), endsAt: at(20) }), NOW)).toBe(false);
  });
});

describe("landingSample — Brasil + 1–2 globais abertos pra brasileiro, nada de última hora", () => {
  const casa = ev("casa", { hosted: true, source: null, location: "Alphaville, SP" });
  const sp = ev("sp", { location: "São Paulo, SP", region: "br" });
  const onlineBr = ev("onlinebr", { format: "online", region: "online-br" });
  const gringo = ev("gringo", { format: "online", region: "online-mundo", source: "devpost", prize: "$50,000" });
  const fora = ev("fora", { location: "Stanford University", region: "exterior", source: "devpost" });
  const amanha = ev("amanha", { location: "Recife, PE", region: "br", startsAt: at(1) });

  it("tira gringo sem regra, presencial lá fora e o que fecha em 48h", () => {
    const { sample } = landingSample([sp, gringo, amanha, fora, onlineBr, casa], NOW);
    expect(sample.map((h) => h.id)).toEqual(["casa", "sp", "onlinebr"]);
  });

  it("sobrou pouco, mostra pouco (não completa com lixo)", () => {
    expect(landingSample([gringo, fora, casa], NOW).sample.map((h) => h.id)).toEqual(["casa"]);
  });

  it("respeita o tamanho", () => {
    const many = Array.from({ length: 10 }, (_, i) => ev(`br-${i}`, { region: "br", location: "Recife, PE" }));
    expect(landingSample(many, NOW, 6).sample).toHaveLength(6);
  });
});

describe("dashboardList — mesma regra, cidade/UF do perfil na frente", () => {
  it("Recife primeiro pra quem é de Recife; gringo fora; ativos excluídos", () => {
    const list = [
      ev("sp", { location: "São Paulo, SP", region: "br" }),
      ev("olinda", { location: "Olinda, PE", region: "br" }),
      ev("recife", { location: "Cais do Porto, Recife, PE", region: "br" }),
      ev("gringo", { format: "online", region: "online-mundo", source: "devpost" }),
      ev("casa", { hosted: true, source: null, location: "Alphaville, SP" }),
    ];
    const ids = dashboardList(list, NOW, { city: "Recife", exclude: new Set(["casa"]) }).map((h) => h.id);
    expect(ids).toEqual(["recife", "olinda", "sp"]);
  });
  it("sem cidade no perfil, segue a ordem por data", () => {
    const list = [ev("a", { region: "br", location: "Canoas, RS" }), ev("b", { region: "online-br", format: "online" })];
    expect(dashboardList(list, NOW).map((h) => h.id)).toEqual(["a", "b"]);
  });
});

describe("shortLocation — cidade na frente do prédio", () => {
  it("corta o local quando termina em cidade, UF", () => {
    expect(shortLocation("Centro Universitário de Maceió – UNIMA/Afya, Maceió, AL")).toBe("Maceió, AL");
    expect(shortLocation("Belém, PA")).toBe("Belém, PA");
    expect(shortLocation("Santa Casa, São Paulo")).toBe("Santa Casa, São Paulo");
    expect(shortLocation(null)).toBeNull();
  });
});

describe("integração com o banco — region gravada chega na lista da landing", () => {
  beforeEach(async () => {
    await db.exec("DELETE FROM hackathons WHERE id LIKE 'rb-%'");
  });

  it("landing com dados do banco: Hack Inova + BR, sem Devpost online sem regra", async () => {
    const ins = db.prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, location,
         registrationUrl, tags, active, source, region, prize)
       VALUES (?, ?, 'Org', ?, ?, ?, 'https://x.dev', '[]', 1, ?, ?, ?)`,
    );
    await ins.run("rb-canoas", "Hackathon Cidades Sábias", at(5), "presencial", "Canoas, RS", "sympla", "br", null);
    await ins.run("rb-paypal", "PayPal AI Hackathon", at(5), "online", null, "devpost", "online-mundo", "$67,500");
    await ins.run("rb-amanha", "Hack de Amanhã", at(1), "presencial", "Recife, PE", "sympla", "br", null);
    const open = await getOpenHackathons(NOW);
    const ids = landingSample(open, NOW, 50).sample.map((h) => h.id);
    expect(ids).toContain("rb-canoas");
    expect(ids).not.toContain("rb-paypal");
    expect(ids).not.toContain("rb-amanha");
    // Hack Inova (seed) vem antes do radar
    const firstRadar = ids.indexOf("rb-canoas");
    expect(ids.slice(0, firstRadar).every((id) => open.find((h) => h.id === id)?.hosted)).toBe(true);
  });
});

describe("edição da casa gravada pelo app", () => {
  it("source 'seed' ou 'painel' conta como brasileira, igual a sem fonte", () => {
    for (const source of [null, "seed", "painel"]) {
      const h = ev(`casa-${source}`, { source, format: "online", name: "Edition One" });
      expect(radarRegion(h)).toBe("online-br");
    }
    expect(radarRegion(ev("gringo", { source: "devpost", format: "online", name: "Edition One" }))).toBe(
      "online-mundo",
    );
  });
});
