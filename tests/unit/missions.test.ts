import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { cardByKey, cardsOf, ENCOUNTER_CARDS, isCardKey, suggestedCard } from "@/lib/encounterCards";
import {
  CODE_ALPHABET,
  complementoPhrase,
  firstNameOf,
  isMeetCode,
  normalizeMeetCode,
  optInEncounters,
} from "@/lib/encounters";
import {
  MISSIONS,
  bridgeCount,
  countsAsDeep,
  encounterCounters,
  grantEncounterBadges,
  missionProgress,
  mutualDepth,
} from "@/lib/missions";

// Missões, cartas e profundidade do encontro (spec 046, onda 5 — migration
// 050). O que a pessoa diz não decide missão: o servidor olha o perfil de
// quem estava no encontro confirmado. Profundidade só conta quando os DOIS
// marcam "fomos além do oi".

const H = "encontros-uni-2026";
const PAST = "encontros-uni-2025";

let seq = 0;
type M = { id: number; username: string; name: string };

async function member(extra: Record<string, unknown> = {}): Promise<M> {
  const tag = `en${seq++}`;
  const cols = Object.keys(extra);
  const row = await db
    .prepare(
      `INSERT INTO members ("clerkId", username, email, name${cols.length ? `, ${cols.map((c) => `"${c}"`).join(", ")}` : ""})
       VALUES (?, ?, ?, ?${cols.map(() => ", ?").join("")}) RETURNING id`,
    )
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, ...Object.values(extra));
  return { id: row!.id, username: `u_${tag}`, name: `Pessoa ${tag}` };
}

async function enrolled(m: M, hackathonId = H, opts: { newcomer?: boolean } = {}): Promise<void> {
  const reg = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(m.id, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(reg!.id);
  await optInEncounters(m.id, hackathonId, { newcomerOptIn: opts.newcomer === true });
}

/** encontro confirmado entre a e b, com o que cada lado respondeu */
async function encounter(
  a: M,
  b: M,
  opts: { depthA?: "rapido" | "alem"; depthB?: "rapido" | "alem"; hackathonId?: string } = {},
): Promise<number> {
  const hackathonId = opts.hackathonId ?? H;
  const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  const row = await db
    .prepare(
      `INSERT INTO encounters ("hackathonId", "lowId", "highId", "initiatorId", status, "confirmedAt")
       VALUES (?, ?, ?, ?, 'confirmed', sqlite_now()) RETURNING id`,
    )
    .get<{ id: number }>(hackathonId, low, high, a.id);
  for (const [m, depth] of [
    [a, opts.depthA],
    [b, opts.depthB],
  ] as const) {
    if (!depth) continue;
    await db
      .prepare(`INSERT INTO encounter_sides ("encounterId", "memberId", depth) VALUES (?, ?, ?)`)
      .run(row!.id, m.id, depth);
  }
  return row!.id;
}

beforeEach(async () => {
  await db.prepare("DELETE FROM introductions").run();
  await db.prepare("DELETE FROM encounter_sides").run();
  await db.prepare("DELETE FROM encounters").run();
  await db.prepare("DELETE FROM edition_meet_codes").run();
  await db.prepare("DELETE FROM edition_roles").run();
  await db.prepare("DELETE FROM notifications").run();
  await db.prepare("DELETE FROM member_badges").run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, "encountersOn", "encounterMissionsOn")
       VALUES (?, 'Encontros 2026', 'Org', '2026-11-14T09:00:00-03:00', 'presencial', '', '[]', 1, 'painel', 1, 1)`,
    )
    .run(H);
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'Encontros 2025', 'Org', '2025-11-14T09:00:00-03:00', 'presencial', '', '[]', 1, 'painel')`,
    )
    .run(PAST);
});

describe("profundidade", () => {
  it("só é profunda quando os dois marcam além do oi", () => {
    expect(mutualDepth("alem", "alem")).toBe("alem");
    expect(countsAsDeep("alem", "alem")).toBe(true);
    expect(mutualDepth("alem", "rapido")).toBe("rapido");
    expect(countsAsDeep("alem", "rapido")).toBe(false);
    expect(mutualDepth("alem", null)).toBe("rapido");
    expect(mutualDepth("rapido", "rapido")).toBe("rapido");
    expect(mutualDepth(null, null)).toBeNull();
  });

  it("contadores: pessoas distintas e além do oi mútuo", async () => {
    const ana = await member();
    const bia = await member();
    const caio = await member();
    await encounter(ana, bia, { depthA: "alem", depthB: "alem" });
    await encounter(ana, caio, { depthA: "alem", depthB: "rapido" });
    const c = await encounterCounters(ana.id, H);
    expect(c).toEqual({ people: 2, deep: 1, bridges: 0 });
  });
});

describe("cartas", () => {
  it("três famílias com as perguntas da spec 045, sem nome do quebra-gelo", () => {
    expect(cardsOf("abrir")).toHaveLength(3);
    expect(cardsOf("funda")).toHaveLength(4);
    expect(cardsOf("time")).toHaveLength(2);
    expect(ENCOUNTER_CARDS.map((c) => c.text).join(" ").toLowerCase()).not.toContain("quebra-gelo");
    expect(cardByKey("abrir-stack")?.text).toBe("Que stack você usaria pra um app em 24h?");
    expect(cardByKey("nao-existe")).toBeNull();
    expect(isCardKey("time-falta")).toBe(true);
    expect(isCardKey("quebra-gelo-1")).toBe(false);
    expect(suggestedCard("abrir", 7).kind).toBe("abrir");
  });

  it("código de 5 caracteres sem 0, O, 1 e I", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
    expect(isMeetCode("ABCDE")).toBe(true);
    expect(isMeetCode("ABC0E")).toBe(false);
    expect(isMeetCode("ABC1E")).toBe(false);
    expect(isMeetCode("ABCOE")).toBe(false);
    expect(isMeetCode("ABCD")).toBe(false);
    expect(normalizeMeetCode("abc de")).toBe("ABCDE");
    expect(normalizeMeetCode("https://hackahub.dev/h/x/encontros?c=ABCDE")).toBe("ABCDE");
    expect(firstNameOf("Ana Souza", "ana")).toBe("Ana");
    expect(firstNameOf(null, "ana")).toBe("@ana");
  });
});

describe("selo de complemento", () => {
  it("frase fixa só quando a vaga do meu time é a área da outra pessoa", () => {
    expect(
      complementoPhrase({ myAreas: ["dev"], peerAreas: ["design"], peerFirstName: "Ana", openingArea: "design" }),
    ).toBe("você é desenvolvimento, Ana é design; seu time procura design");
    expect(
      complementoPhrase({ myAreas: ["dev"], peerAreas: ["design"], peerFirstName: "Ana", openingArea: "dados" }),
    ).toBeNull();
    expect(
      complementoPhrase({ myAreas: ["dev"], peerAreas: ["dev"], peerFirstName: "Ana", openingArea: "dev" }),
    ).toBeNull();
  });
});

describe("missões", () => {
  it("primeira viagem: quem está no primeiro hackathon e topou aparecer como estreante", async () => {
    const ana = await member();
    const novo = await member();
    const veterano = await member();
    await enrolled(ana);
    await enrolled(novo, H, { newcomer: true });
    await enrolled(veterano);
    // veterano tem inscrição aprovada em outra edição
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
      .run(veterano.id, PAST);
    await encounter(ana, novo);
    await encounter(ana, veterano);
    const p = await missionProgress(ana.id, H);
    const primeira = p.find((m) => m.key === "primeira-viagem")!;
    expect(primeira.done).toBe(true);
    expect(primeira.count).toBe(1);
  });

  it("estreante sem o aceite não conta", async () => {
    const ana = await member();
    const novo = await member();
    await enrolled(ana);
    await enrolled(novo, H, { newcomer: false });
    await encounter(ana, novo);
    const p = await missionProgress(ana.id, H);
    expect(p.find((m) => m.key === "primeira-viagem")!.count).toBe(0);
  });

  it("um mentor: papel de mentor na edição", async () => {
    const ana = await member();
    const mentor = await member();
    await enrolled(ana);
    await enrolled(mentor);
    await db
      .prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'mentor')")
      .run(H, mentor.id);
    await encounter(ana, mentor);
    const p = await missionProgress(ana.id, H);
    expect(p.find((m) => m.key === "mentor")!.count).toBe(1);
  });

  it("outra faculdade ou cidade: o valor nunca aparece no resultado", async () => {
    const ana = await member({ institution: "UFPE", city: "Recife, PE" });
    const outra = await member({ institution: "USP", city: "São Paulo, SP" });
    const mesma = await member({ institution: "UFPE", city: "Recife, PE" });
    await enrolled(ana);
    await enrolled(outra);
    await enrolled(mesma);
    await encounter(ana, outra);
    await encounter(ana, mesma);
    const p = await missionProgress(ana.id, H);
    const m = p.find((x) => x.key === "outra-faculdade")!;
    expect(m.count).toBe(1);
    const dump = JSON.stringify(p);
    expect(dump).not.toContain("USP");
    expect(dump).not.toContain("São Paulo");
  });

  it("ponte só conta quando as duas pessoas confirmam encontro depois da apresentação", async () => {
    const ana = await member();
    const bia = await member();
    const caio = await member();
    await enrolled(ana);
    await enrolled(bia);
    await enrolled(caio);
    await db
      .prepare(`INSERT INTO introductions ("hackathonId", "memberId", "peerId", "recipientId") VALUES (?, ?, ?, ?)`)
      .run(H, ana.id, bia.id, caio.id);
    expect(await bridgeCount(ana.id, H)).toBe(0);
    // confirmam depois da apresentação (confirmedAt > createdAt da intro)
    const id = await encounter(bia, caio);
    await db
      .prepare(`UPDATE encounters SET "confirmedAt" = sqlite_now('+1 minute') WHERE id = ?`)
      .run(id);
    expect(await bridgeCount(ana.id, H)).toBe(1);
    const p = await missionProgress(ana.id, H);
    expect(p.find((m) => m.key === "ponte")!.done).toBe(true);
  });

  it("apresentação anterior ao encontro não conta", async () => {
    const ana = await member();
    const bia = await member();
    const caio = await member();
    await enrolled(ana);
    await enrolled(bia);
    await enrolled(caio);
    const id = await encounter(bia, caio);
    await db
      .prepare(`UPDATE encounters SET "confirmedAt" = sqlite_now('-10 minutes') WHERE id = ?`)
      .run(id);
    await db
      .prepare(`INSERT INTO introductions ("hackathonId", "memberId", "peerId", "recipientId") VALUES (?, ?, ?, ?)`)
      .run(H, ana.id, bia.id, caio.id);
    expect(await bridgeCount(ana.id, H)).toBe(0);
  });

  it("todas as missões aparecem, feitas ou não, na ordem declarada", async () => {
    const ana = await member();
    await enrolled(ana);
    const p = await missionProgress(ana.id, H);
    expect(p.map((m) => m.key)).toEqual(MISSIONS.map((m) => m.key));
    expect(p.every((m) => !m.done && m.count === 0)).toBe(true);
  });
});

describe("selos", () => {
  it("10 pessoas distintas dão 'roda'; 3 pontes dão 'ponte'", async () => {
    const ana = await member();
    await enrolled(ana);
    for (let i = 0; i < 9; i++) {
      const p = await member();
      await enrolled(p);
      await encounter(ana, p);
    }
    expect(await grantEncounterBadges(ana.id)).toEqual([]);
    const decima = await member();
    await enrolled(decima);
    await encounter(ana, decima);
    expect(await grantEncounterBadges(ana.id)).toEqual(["roda"]);
    // idempotente
    expect(await grantEncounterBadges(ana.id)).toEqual([]);
    const badges = await db
      .prepare("SELECT badgeId FROM member_badges WHERE memberId = ? ORDER BY badgeId")
      .all<{ badgeId: string }>(ana.id);
    expect(badges.map((b) => b.badgeId)).toEqual(["roda"]);

    // três pontes
    for (let i = 0; i < 3; i++) {
      const x = await member();
      const y = await member();
      await enrolled(x);
      await enrolled(y);
      await db
        .prepare(`INSERT INTO introductions ("hackathonId", "memberId", "peerId", "recipientId") VALUES (?, ?, ?, ?)`)
        .run(H, ana.id, x.id, y.id);
      const id = await encounter(x, y);
      await db.prepare(`UPDATE encounters SET "confirmedAt" = sqlite_now('+1 minute') WHERE id = ?`).run(id);
    }
    expect(await grantEncounterBadges(ana.id)).toEqual(["ponte"]);
  });
});
