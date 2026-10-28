import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  buildDigest,
  digestToken,
  isoWeekBrt,
  renderDigestEmail,
  verifyDigestToken,
} from "@/lib/digest";
import { groupedText, listNotificationsGrouped, notify } from "@/lib/notifications";
import { notifyNewFollower } from "@/lib/memberFollows";

// Resumo semanal e agrupamento (migration 040). Banco PGlite por arquivo.
// `now` fixo bem longe do seed (2031) pra o radar do seed não entrar.

const NOW = new Date("2031-03-12T15:00:00Z"); // quarta
const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const daysAgo = (n: number) => iso(new Date(NOW.getTime() - n * 86_400_000));
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

let seq = 0;
async function member(name?: string) {
  const t = `dg${seq++}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${t}`, `u_${t}`, `${t}@t.dev`, name ?? null);
  return { id: r!.id, username: `u_${t}` };
}

async function edition(id: string, opts: { deadline?: string; communityId?: number; active?: number } = {}) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, registrationDeadline, communityId, active, source)
       VALUES (?, ?, 'Org', '2031-04-01', 'online', 'https://x.dev', ?, ?, ?, 'painel')`,
    )
    .run(id, `Edição ${id}`, opts.deadline ?? null, opts.communityId ?? null, opts.active ?? 1);
}

async function team(hackathonId: string, name: string, usernames: string[], submittedAt: string | null) {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, name);
  for (const u of usernames) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
  await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, ?)").run(t!.id, `Projeto ${name}`);
  if (submittedAt) {
    await db
      .prepare("INSERT INTO project_submissions (teamId, version, snapshot, submittedAt) VALUES (?, 1, '{}', ?)")
      .run(t!.id, submittedAt);
  }
  return t!.id;
}

async function community(slug: string) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`);
  return c!.id;
}

describe("isoWeekBrt", () => {
  it("semana ISO no horário de Brasília", () => {
    expect(isoWeekBrt(new Date("2026-10-26T12:00:00Z"))).toBe("2026-W44"); // segunda
    expect(isoWeekBrt(new Date("2026-11-01T23:00:00Z"))).toBe("2026-W44"); // domingo 20h BRT
    // segunda 01:00 UTC ainda é domingo em Brasília
    expect(isoWeekBrt(new Date("2026-11-02T01:00:00Z"))).toBe("2026-W44");
    expect(isoWeekBrt(new Date("2026-11-02T03:00:00Z"))).toBe("2026-W45");
    // virada de ano: 1º de janeiro de 2027 (sexta) é da semana 53 de 2026
    expect(isoWeekBrt(new Date("2027-01-01T15:00:00Z"))).toBe("2026-W53");
    expect(isoWeekBrt(new Date("2025-12-29T15:00:00Z"))).toBe("2026-W01");
  });
});

describe("token de parar de receber", () => {
  it("confere o próprio token e recusa o resto", () => {
    const t = digestToken(42);
    expect(t).toMatch(/^D1\.42\.[A-Za-z0-9_-]{43}$/);
    expect(verifyDigestToken(t)).toBe(42);
    // trocar o id não passa
    expect(verifyDigestToken(t.replace("D1.42.", "D1.43."))).toBeNull();
    expect(verifyDigestToken(`${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(verifyDigestToken("lixo")).toBeNull();
    expect(verifyDigestToken(undefined)).toBeNull();
    expect(verifyDigestToken("D1.0." + "a".repeat(43))).toBeNull();
  });
});

describe("groupedText", () => {
  it("frase por tipo com até 3 nomes e 'mais N'", () => {
    expect(groupedText("reaction", ["a"], 1, "@a reagiu")).toBe("@a reagiu");
    expect(groupedText("reaction", ["a", "b"], 2, "x")).toBe("@a e @b reagiram ao seu post");
    expect(groupedText("reaction", ["a", "b", "c"], 3, "x")).toBe("@a, @b e @c reagiram ao seu post");
    expect(groupedText("reaction", ["a", "b", "c"], 5, "x")).toBe("@a, @b e mais 3 reagiram ao seu post");
    expect(groupedText("follow", ["a", "b"], 2, "x")).toBe("@a e @b começaram a seguir você");
  });
  it("tipo sem frase fica com o texto original", () => {
    expect(groupedText("registration_approved", ["a", "b"], 2, "inscrição aprovada")).toBe("inscrição aprovada");
  });
});

describe("listNotificationsGrouped", () => {
  it("5 reações no mesmo post viram 1 linha com 3 rostos e total 5", async () => {
    const ana = await member();
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => member()));
    for (const p of people) {
      await notify(ana.id, { type: "reaction", actorId: p.id, actorUsername: p.username, text: `@${p.username} reagiu`, href: "/feed#post-9" });
    }
    await notify(ana.id, { type: "registration_approved", text: "inscrição aprovada", href: "/h/x" });
    const { items, next } = await listNotificationsGrouped(ana.id);
    expect(next).toBeNull();
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe("registration_approved");
    const g = items[1];
    expect(g.total).toBe(5);
    expect(g.actorCount).toBe(5);
    expect(g.actors.map((a) => a.username)).toEqual([people[4].username, people[3].username, people[2].username]);
    expect(g.text).toBe(`@${people[4].username}, @${people[3].username} e mais 3 reagiram ao seu post`);
    expect(g.group).toBe("social");
    expect(g.ids).toHaveLength(5);
  });

  it("lida, outro destino ou mais de 24h não junta", async () => {
    const ana = await member();
    const [a, b, c] = await Promise.all([member(), member(), member()]);
    await notify(ana.id, { type: "like", actorId: a.id, text: "a curtiu", href: "/feed#1" });
    await notify(ana.id, { type: "like", actorId: b.id, text: "b curtiu", href: "/feed#2" });
    await notify(ana.id, { type: "like", actorId: c.id, text: "c curtiu", href: "/feed#1" });
    await db.prepare("UPDATE notifications SET read = 1 WHERE memberId = ? AND actorId = ?").run(ana.id, c.id);
    expect((await listNotificationsGrouped(ana.id)).items.map((i) => i.total)).toEqual([1, 1, 1]);

    await db.prepare("UPDATE notifications SET read = 0 WHERE memberId = ?").run(ana.id);
    expect((await listNotificationsGrouped(ana.id)).items.map((i) => i.total).sort()).toEqual([1, 2]);
    // 25h depois, nada junta
    const later = new Date(Date.now() + 25 * 3600_000);
    expect((await listNotificationsGrouped(ana.id, null, 30, { now: later })).items).toHaveLength(3);
  });

  it("seguidores novos do dia viram uma linha, mesmo com href por pessoa", async () => {
    const ana = await member();
    const people = await Promise.all([1, 2, 3, 4, 5, 6].map(() => member()));
    for (const p of people) expect(await notifyNewFollower(p, ana.id)).toBe(true);
    const { items } = await listNotificationsGrouped(ana.id);
    expect(items).toHaveLength(1);
    expect(items[0].total).toBe(6);
    expect(items[0].text).toBe(`@${people[5].username}, @${people[4].username} e mais 4 começaram a seguir você`);
    expect(items[0].href).toBe("/perfil/seguidores");
  });

  it("um seguidor só mantém o link pro perfil dele", async () => {
    const ana = await member();
    const bia = await member();
    await notifyNewFollower(bia, ana.id);
    const { items } = await listNotificationsGrouped(ana.id);
    expect(items[0].href).toBe(`/u/${bia.username}`);
    expect(items[0].text).toBe(`@${bia.username} começou a seguir você`);
  });

  it("comentários e respostas agrupam pelo post, sem o #c-", async () => {
    const ana = await member();
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => member()));
    let c = 100;
    for (const p of people) {
      await notify(ana.id, { type: "comment", actorId: p.id, actorUsername: p.username, text: "comentou", href: `/post/7#c-${c++}` });
    }
    await notify(ana.id, { type: "comment", actorId: people[0].id, text: "comentou", href: `/post/8#c-${c++}` });
    await notify(ana.id, { type: "reply", actorId: people[0].id, actorUsername: people[0].username, text: "respondeu", href: `/post/7#c-${c++}` });
    await notify(ana.id, { type: "reply", actorId: people[1].id, actorUsername: people[1].username, text: "respondeu", href: `/post/9#c-${c++}` });
    await notify(ana.id, { type: "reply", actorId: people[2].id, actorUsername: people[2].username, text: "respondeu", href: `/post/7#c-${c++}` });
    const { items } = await listNotificationsGrouped(ana.id);
    const post7 = items.find((i) => i.type === "comment" && i.total > 1)!;
    expect(post7.total).toBe(5);
    expect(post7.text).toBe(`@${people[4].username}, @${people[3].username} e mais 3 comentaram no seu post`);
    expect(post7.href).toBe(`/post/7#c-104`); // a mais recente
    const replies7 = items.find((i) => i.type === "reply" && i.total > 1)!;
    expect(replies7.total).toBe(2);
    expect(replies7.text).toBe(`@${people[2].username} e @${people[0].username} responderam você`);
    expect(items.map((i) => i.total).sort()).toEqual([1, 1, 2, 5]);
  });

  it("cursor: páginas sem repetir e sem partir grupo", async () => {
    const ana = await member();
    const others = await Promise.all([1, 2, 3].map(() => member()));
    for (let i = 0; i < 5; i++) await notify(ana.id, { type: `aviso_${i}`, text: `aviso ${i}` });
    for (const o of others) await notify(ana.id, { type: "follow", actorId: o.id, text: "seguiu", href: `/u/x` });
    const p1 = await listNotificationsGrouped(ana.id, null, 2);
    expect(p1.items).toHaveLength(2);
    expect(p1.items[0].total).toBe(3); // o grupo de seguir é o mais recente
    expect(p1.next).toBe(p1.items[1].id);
    const p2 = await listNotificationsGrouped(ana.id, p1.next, 2);
    const p3 = await listNotificationsGrouped(ana.id, p2.next, 2);
    expect(p3.next).toBeNull();
    const all = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
    expect(new Set(all).size).toBe(6);
  });

  it("aba menções filtra o tipo mention", async () => {
    const ana = await member();
    const bia = await member();
    await notify(ana.id, { type: "mention", actorId: bia.id, text: "mencionou você", href: "/feed#3" });
    await notify(ana.id, { type: "like", actorId: bia.id, text: "curtiu", href: "/feed#3" });
    const { items } = await listNotificationsGrouped(ana.id, null, 30, { only: "mencoes" });
    expect(items.map((i) => i.type)).toEqual(["mention"]);
  });
});

describe("buildDigest", () => {
  it("tudo vazio: empty e nenhuma seção", async () => {
    const ana = await member();
    const d = await buildDigest(ana.id, NOW);
    expect(d).toEqual({ sections: [], empty: true });
  });

  it("monta as quatro seções com dados reais da janela", async () => {
    const ana = await member("Ana Souza");
    const bia = await member();
    const caio = await member();
    await db.prepare("INSERT INTO member_follows (memberId, followedId) VALUES (?, ?)").run(ana.id, bia.id);

    // radar: fecha em 3 dias (entra), fecha em 10 (fora), já fechou (fora), inativo (fora)
    await edition("dg-fecha", { deadline: daysAhead(3) });
    await edition("dg-longe", { deadline: daysAhead(10) });
    await edition("dg-passou", { deadline: daysAhead(-1) });
    await edition("dg-off", { deadline: daysAhead(2), active: 0 });

    // quem ana segue entregou na semana; entrega de 9 dias atrás não conta
    await edition("dg-ed");
    await team("dg-ed", "Time Bia", [bia.username], daysAgo(2));
    await team("dg-ed", "Time Velho", [bia.username], daysAgo(9));
    await team("dg-ed", "Time Caio", [caio.username], daysAgo(1)); // ana não segue caio

    // comunidade da ana: 4 projetos novos na semana, só os 3 mais recentes
    const c = await community("dg-com");
    await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?)").run(c, ana.id);
    await edition("dg-com-ed", { communityId: c });
    for (let i = 1; i <= 4; i++) await team("dg-com-ed", `Com ${i}`, [], daysAgo(i));

    await notify(ana.id, { type: "answer", text: "responderam sua dúvida" });

    const d = await buildDigest(ana.id, NOW);
    expect(d.empty).toBe(false);
    expect(d.sections.map((s) => s.key)).toEqual(["fecha", "entregou", "comunidades", "naoLidas"]);
    const [fecha, entregou, comunidades, naoLidas] = d.sections;
    expect(fecha.items.map((i) => i.href)).toEqual(["/h/dg-fecha"]);
    expect(fecha.items[0].detail).toMatch(/^inscrição fecha/);
    expect(entregou.items).toHaveLength(1);
    expect(entregou.items[0].title).toBe("Projeto Time Bia");
    expect(entregou.items[0].detail).toBe(`@${bia.username} · Edição dg-ed`);
    expect(comunidades.items.map((i) => i.title)).toEqual(["Projeto Com 1", "Projeto Com 2", "Projeto Com 3"]);
    expect(naoLidas.title).toBe("Você tem 1 notificação não lida");

    const mail = renderDigestEmail(d, { name: "Ana Souza", stopUrl: "https://x.dev/sair" });
    expect(mail.subject).toBe("Sua semana no HackaHub");
    expect(mail.text).toContain("Oi, Ana.");
    expect(mail.text).toContain("Parar de receber: https://x.dev/sair");
    expect(mail.html).toContain("Projeto Time Bia");
    expect(mail.html).toContain('href="https://x.dev/sair"');
  });

  it("quem eu silenciei não aparece no 'quem você segue entregou'", async () => {
    const ana = await member();
    const bia = await member();
    await db.prepare("INSERT INTO member_follows (memberId, followedId) VALUES (?, ?)").run(ana.id, bia.id);
    await db.prepare("INSERT INTO member_mutes (memberId, mutedId) VALUES (?, ?)").run(ana.id, bia.id);
    await edition("dg-mute");
    await team("dg-mute", "Time Mudo", [bia.username], daysAgo(1));
    // o radar de outro teste deste arquivo pode aparecer; o que importa é a seção
    expect((await buildDigest(ana.id, NOW)).sections.map((s) => s.key)).not.toContain("entregou");
    await db.prepare("DELETE FROM member_mutes WHERE memberId = ?").run(ana.id);
    expect((await buildDigest(ana.id, NOW)).sections.map((s) => s.key)).toContain("entregou");
  });

  it("escapa HTML do título no e-mail", () => {
    const mail = renderDigestEmail(
      { empty: false, sections: [{ key: "fecha", title: "Fecha", href: null, items: [{ title: "<b>x</b>", detail: null, href: "/h/x" }] }] },
      { name: null, stopUrl: "https://x.dev/s" },
    );
    expect(mail.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>x</b>");
  });
});
