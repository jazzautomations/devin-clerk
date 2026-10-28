import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import db from "@/lib/db";
import { block } from "@/lib/blocks";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";
import { createReport, getReport } from "@/lib/reports";
import {
  cleanBody,
  countAccepted,
  joinHandles,
  listAccepted,
  listHidden,
  listPending,
  listWrittenBy,
  takeDownTestimonial,
  teammatesToWrite,
  TESTIMONIAL_MAX,
  writeTestimonial,
} from "@/lib/testimonials";

// Depoimento de time (migration 037): só quem fez time escreve (403), bloqueio
// é 404, duplicado 409, sexto do dia 429; aceitar põe no perfil, recusar não
// avisa o autor, editar um aceito volta pra pendente, esconder tira do
// perfil; conta excluída leva o texto; HTML sai escapado; denúncia vai pra
// edição.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

const PAST = "hack-inova-unifacens-2026"; // agosto/2026: começou e acabou
const FUTURE = "hack-inova-alphaville-2026"; // novembro/2026: ainda não começou
const TEXT = "Segurou o back-end inteiro sozinha na madrugada e ainda explicou tudo pro time.";

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(): Promise<M> {
  const tag = `dp${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
async function team(hackathonId: string, people: M[]) {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Time ${seq++}`);
  for (const p of people) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, p.username);
  return t!.id;
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const json = (method: string, body?: unknown) =>
  new Request("http://t", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const idCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const routes = async () => ({
  root: await import("@/app/api/testimonials/route"),
  one: await import("@/app/api/testimonials/[id]/route"),
  accept: await import("@/app/api/testimonials/[id]/accept/route"),
  decline: await import("@/app/api/testimonials/[id]/decline/route"),
  hide: await import("@/app/api/testimonials/[id]/hide/route"),
  takedown: await import("@/app/api/reports/[id]/takedown/route"),
});
/** aceitar manda o texto que a tela mostrou */
const seen = (t: { body: string }) => json("POST", { body: t.body });
/** n pessoas com check-in aprovado: a edição passa na regra antifarm */
async function makeEligible(hackathonId: string, n = 15) {
  for (let i = 0; i < n; i++) {
    const p = await member();
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
      .get<{ id: number }>(p.id, hackathonId);
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
  }
}
const notifs = (to: number) =>
  db
    .prepare("SELECT type, text, href, actorId FROM notifications WHERE memberId = ? AND type = 'testimonial' ORDER BY id")
    .all<{ type: string; text: string; href: string; actorId: number }>(to);
const statusOf = async (id: number) =>
  (await db.prepare("SELECT status, acceptedAt FROM team_testimonials WHERE id = ?").get<{ status: string; acceptedAt: string | null }>(id)) ?? null;

async function pair() {
  const a = await member();
  const b = await member();
  await team(PAST, [a, b]);
  return { a, b };
}
async function post(author: M, to: M, body = TEXT, hackathonId = PAST) {
  const { root } = await routes();
  as(author);
  return root.POST(json("POST", { username: to.username, hackathonId, body }));
}

beforeEach(() => {
  resetRateLimits();
  as(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/testimonials", () => {
  it("401 deslogado em todas as rotas", async () => {
    const r = await routes();
    const res = await r.root.POST(json("POST", { username: "x", hackathonId: PAST, body: TEXT }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect((await r.one.PATCH(json("PATCH", { body: TEXT }), idCtx(1))).status).toBe(401);
    expect((await r.one.DELETE(json("DELETE"), idCtx(1))).status).toBe(401);
    for (const route of [r.accept, r.decline, r.hide]) expect((await route.POST(json("POST"), idCtx(1))).status).toBe(401);
    expect((await r.takedown.POST(json("POST"), { params: Promise.resolve({ id: "1" }) })).status).toBe(401);
  });

  it("quem não foi do time leva 403; edição que não começou também", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    await team(PAST, [a, c]);
    await team(PAST, [b]);
    const r = await post(a, b);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Depoimento aqui só vem de quem fez time com a pessoa" });
    // time em comum, mas noutra edição
    expect((await post(a, c, TEXT, FUTURE)).status).toBe(403);
    // mesmo time numa edição que ainda não começou
    const d = await member();
    await team(FUTURE, [a, d]);
    expect((await post(a, d, TEXT, FUTURE)).status).toBe(403);
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM team_testimonials WHERE authorId = ?").get<{ n: number }>(a.id)).toEqual({ n: 0 });
  });

  it("400 texto curto, longo ou sobre si mesmo; 404 quem não existe", async () => {
    const { a, b } = await pair();
    expect((await post(a, b, "curto demais")).status).toBe(400);
    expect((await post(a, b, "x".repeat(TESTIMONIAL_MAX + 1))).status).toBe(400);
    // 40 caracteres contam depois de tirar o espaço das pontas
    expect((await post(a, b, `   ${"a".repeat(39)}   `)).status).toBe(400);
    expect((await post(a, a)).status).toBe(400);
    expect((await post(a, { ...b, username: "nao_existe" })).status).toBe(404);
  });

  it("escreve, avisa com actorId e vai pra 'pra aceitar'; repetido dá 409", async () => {
    const { a, b } = await pair();
    const r = await post(a, b, `  ${TEXT}\r\n\r\n\r\n\r\nvaleu!  `);
    expect(r.status).toBe(201);
    const { testimonial } = await r.json();
    expect(testimonial.body).toBe(`${TEXT}\n\nvaleu!`);
    expect(testimonial.author.username).toBe(a.username);
    expect(await notifs(b.id)).toEqual([
      { type: "testimonial", text: `@${a.username} escreveu um depoimento sobre você. Aceita?`, href: "/perfil/depoimentos", actorId: a.id },
    ]);
    expect((await listPending(b.id)).map((t) => t.id)).toEqual([testimonial.id]);
    expect(await listAccepted(b.id)).toEqual([]);
    const dup = await post(a, b);
    expect(dup.status).toBe(409);
    // com @ na frente e maiúscula é a mesma pessoa
    expect((await post(a, { ...b, username: `@${b.username.toUpperCase()}` })).status).toBe(409);
  });

  it("sexto depoimento no dia dá 429; tentativa inválida não gasta", async () => {
    const a = await member();
    const others = await Promise.all(Array.from({ length: 6 }, () => member()));
    await team(PAST, [a, ...others]);
    expect((await post(a, others[0], "curto")).status).toBe(400);
    for (const o of others.slice(0, 5)) expect((await post(a, o)).status).toBe(201);
    const r = await post(a, others[5]);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });

  it("bloqueio em qualquer sentido dá 404 e esconde o que já estava no perfil", async () => {
    const { a, b } = await pair();
    const { root, accept } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    as(b);
    expect((await accept.POST(seen(testimonial), idCtx(testimonial.id))).status).toBe(200);
    await makeEligible(PAST);
    expect(await countAccepted(b.id)).toBe(1);

    await block(b.id, a.id);
    expect(await listAccepted(b.id)).toEqual([]);
    expect(await countAccepted(b.id)).toBe(0);
    as(a);
    const c = await member();
    await team(PAST, [a, b, c]);
    expect((await root.POST(json("POST", { username: b.username, hackathonId: PAST, body: TEXT }))).status).toBe(404);
    // o outro sentido também
    as(c);
    await block(c.id, a.id);
    as(a);
    expect((await root.POST(json("POST", { username: c.username, hackathonId: PAST, body: TEXT }))).status).toBe(404);
  });

  it("quem olha e bloqueou o autor não vê aquele depoimento", async () => {
    const { a, b } = await pair();
    const v = await member();
    const t = await writeTestimonial(a.id, b.id, PAST, TEXT);
    await db.prepare("UPDATE team_testimonials SET status = 'aceito', acceptedAt = sqlite_now() WHERE id = ?").run(t.id);
    expect((await listAccepted(b.id, v.id)).length).toBe(1);
    await block(v.id, a.id);
    expect(await listAccepted(b.id, v.id)).toEqual([]);
    expect((await listAccepted(b.id, null)).length).toBe(1);
  });
});

describe("aceitar, recusar, esconder", () => {
  it("aceito aparece em recebidos; o autor não é avisado e vê 'no perfil'", async () => {
    const { a, b } = await pair();
    const { accept } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    // só quem recebeu decide: autor 403, estranho 404
    as(a);
    expect((await accept.POST(seen(testimonial), idCtx(testimonial.id))).status).toBe(403);
    const x = await member();
    as(x);
    expect((await accept.POST(seen(testimonial), idCtx(testimonial.id))).status).toBe(404);
    as(b);
    expect((await accept.POST(seen(testimonial), idCtx("abc"))).status).toBe(404);
    expect((await accept.POST(seen(testimonial), idCtx(999999))).status).toBe(404);

    const r = await accept.POST(seen(testimonial), idCtx(testimonial.id));
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.status).toBe("aceito");
    // b fez time com a numa edição encerrada e ainda não escreveu: sugestão de volta
    expect(data.writeBack).toBe(a.username);
    const acc = await listAccepted(b.id);
    expect(acc.map((t) => [t.id, t.author.username, t.hackathonName.length > 0, !!t.acceptedAt])).toEqual([[testimonial.id, a.username, true, true]]);
    expect(await listPending(b.id)).toEqual([]);
    expect(await notifs(a.id)).toEqual([]);
    expect((await listWrittenBy(a.id)).map((t) => t.publicStatus)).toEqual(["no perfil"]);
    // aceitar de novo é idempotente
    expect((await accept.POST(seen(testimonial), idCtx(testimonial.id))).status).toBe(200);
  });

  it("recusado não avisa o autor, que continua vendo 'enviado'", async () => {
    const { a, b } = await pair();
    const { decline, hide } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    as(b);
    const r = await decline.POST(json("POST"), idCtx(testimonial.id));
    expect(r.status).toBe(200);
    expect((await statusOf(testimonial.id))?.status).toBe("recusado");
    expect(await notifs(a.id)).toEqual([]);
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM notifications WHERE memberId = ?").get<{ n: number }>(a.id)).toEqual({ n: 0 });
    expect((await listWrittenBy(a.id)).map((t) => t.publicStatus)).toEqual(["enviado"]);
    expect(JSON.stringify(await listWrittenBy(a.id))).not.toContain("recusado");
    expect(await listAccepted(b.id)).toEqual([]);
    expect(await listPending(b.id)).toEqual([]);
    // esconder só vale pra aceito
    expect((await hide.POST(json("POST"), idCtx(testimonial.id))).status).toBe(409);
  });

  it("esconder tira do perfil; aceitar de novo traz de volta", async () => {
    const { a, b } = await pair();
    const { accept, hide, decline } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    as(b);
    await accept.POST(seen(testimonial), idCtx(testimonial.id));
    expect((await hide.POST(json("POST"), idCtx(testimonial.id))).status).toBe(200);
    expect(await listAccepted(b.id)).toEqual([]);
    expect((await listHidden(b.id)).map((t) => t.id)).toEqual([testimonial.id]);
    expect((await listWrittenBy(a.id)).map((t) => t.publicStatus)).toEqual(["enviado"]);
    // recusar depois de aceito não existe
    expect((await decline.POST(json("POST"), idCtx(testimonial.id))).status).toBe(409);
    expect((await accept.POST(seen(testimonial), idCtx(testimonial.id))).status).toBe(200);
    expect((await listAccepted(b.id)).length).toBe(1);
  });
});

describe("PATCH e DELETE /api/testimonials/[id]", () => {
  it("editar um aceito volta pra pendente e avisa de novo", async () => {
    const { a, b } = await pair();
    const { accept, one } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    as(b);
    await accept.POST(seen(testimonial), idCtx(testimonial.id));
    // quem recebeu não edita; estranho nem vê
    expect((await one.PATCH(json("PATCH", { body: `${TEXT} editado por b` }), idCtx(testimonial.id))).status).toBe(403);
    as(await member());
    expect((await one.PATCH(json("PATCH", { body: `${TEXT} editado` }), idCtx(testimonial.id))).status).toBe(404);

    as(a);
    expect((await one.PATCH(json("PATCH", { body: "curto" }), idCtx(testimonial.id))).status).toBe(400);
    const r = await one.PATCH(json("PATCH", { body: `${TEXT} E o deploy.` }), idCtx(testimonial.id));
    expect(r.status).toBe(200);
    expect((await r.json()).publicStatus).toBe("enviado");
    expect(await statusOf(testimonial.id)).toEqual({ status: "pendente", acceptedAt: null });
    expect(await listAccepted(b.id)).toEqual([]);
    expect((await listPending(b.id))[0].body).toBe(`${TEXT} E o deploy.`);
    expect((await notifs(b.id)).map((n) => n.text)).toEqual([
      `@${a.username} escreveu um depoimento sobre você. Aceita?`,
      `@${a.username} editou o depoimento sobre você. Aceita de novo?`,
    ]);
    // editar pendente não avisa de novo
    await one.PATCH(json("PATCH", { body: `${TEXT} E o pitch.` }), idCtx(testimonial.id));
    expect((await notifs(b.id)).length).toBe(2);
  });

  it("editar recusado não muda o status nem avisa", async () => {
    const { a, b } = await pair();
    const { decline, one } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    as(b);
    await decline.POST(json("POST"), idCtx(testimonial.id));
    as(a);
    expect((await one.PATCH(json("PATCH", { body: `${TEXT} de novo` }), idCtx(testimonial.id))).status).toBe(200);
    expect((await statusOf(testimonial.id))?.status).toBe("recusado");
    expect((await notifs(b.id)).length).toBe(1);
  });

  it("o autor apaga; quem recebeu não", async () => {
    const { a, b } = await pair();
    const { one } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    as(b);
    expect((await one.DELETE(json("DELETE"), idCtx(testimonial.id))).status).toBe(403);
    as(a);
    expect((await one.DELETE(json("DELETE"), idCtx(testimonial.id))).status).toBe(200);
    expect(await statusOf(testimonial.id)).toBeNull();
    expect((await one.DELETE(json("DELETE"), idCtx(testimonial.id))).status).toBe(404);
    // apagou: pode escrever de novo
    expect((await post(a, b)).status).toBe(201);
  });
});

describe("teammatesToWrite", () => {
  it("colegas de edição encerrada, sem quem já recebeu, sem bloqueio e sem conta excluída", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const d = await member();
    const e = await member();
    const f = await member();
    await team(PAST, [a, b, c, d, e]);
    await team(FUTURE, [a, f]);
    let groups = await teammatesToWrite(a.id);
    expect(groups.length).toBe(1);
    expect(groups[0].hackathonId).toBe(PAST);
    expect(groups[0].people.map((p) => p.username).sort()).toEqual([b, c, d, e].map((p) => p.username).sort());
    await writeTestimonial(a.id, b.id, PAST, TEXT);
    await block(c.id, a.id);
    await deleteMemberData(d.id);
    groups = await teammatesToWrite(a.id);
    expect(groups[0].people.map((p) => p.username)).toEqual([e.username]);
    await writeTestimonial(a.id, e.id, PAST, TEXT);
    expect(await teammatesToWrite(a.id)).toEqual([]);
  });

  it("joinHandles junta os @ do jeito da tela", () => {
    const p = (u: string) => ({ username: u });
    expect(joinHandles([p("a")])).toBe("@a");
    expect(joinHandles([p("a"), p("b")])).toBe("@a e @b");
    expect(joinHandles([p("a"), p("b"), p("c")])).toBe("@a, @b e @c");
    expect(joinHandles([p("a"), p("b"), p("c"), p("d"), p("e")], 3)).toBe("@a, @b, @c e mais 2");
  });

  it("cleanBody conta caractere, não unidade UTF-16", () => {
    expect(() => cleanBody("🙂".repeat(39))).toThrow();
    expect(cleanBody("🙂".repeat(40))).toBe("🙂".repeat(40));
    expect(() => cleanBody("🙂".repeat(601))).toThrow();
    expect(cleanBody("🙂".repeat(600)).length).toBe(1200);
  });
});

describe("LGPD, denúncia e tela", () => {
  it("autor excluído leva o depoimento junto; quem recebeu também", async () => {
    const { a, b } = await pair();
    const t1 = await writeTestimonial(a.id, b.id, PAST, TEXT);
    await db.prepare("UPDATE team_testimonials SET status = 'aceito' WHERE id = ?").run(t1.id);
    // export: quem recebeu leva o texto; o outro lado vira só contagem
    const expA = (await exportMemberData(a.id))!.data as Record<string, unknown>;
    expect(expA["team_testimonials.authorId"]).toEqual({ count: 1 });
    const expB = (await exportMemberData(b.id))!.data as Record<string, { body: string }[]>;
    expect(expB["team_testimonials.memberId"].map((r) => r.body)).toEqual([TEXT]);
    await deleteMemberData(a.id);
    expect(await statusOf(t1.id)).toBeNull();
    expect(await listAccepted(b.id)).toEqual([]);

    const { a: c, b: d } = await pair();
    const t2 = await writeTestimonial(c.id, d.id, PAST, TEXT);
    await deleteMemberData(d.id);
    expect(await statusOf(t2.id)).toBeNull();
  });

  it("denúncia de depoimento aceito vai pra edição e bloqueia o autor; pendente dá 404", async () => {
    const { a, b } = await pair();
    const v = await member();
    const t = await writeTestimonial(a.id, b.id, PAST, TEXT);
    await expect(createReport({ targetType: "depoimento", targetId: t.id, reporterId: v.id, reason: "ofensa ou assédio" })).rejects.toMatchObject({ status: 404 });
    await db.prepare("UPDATE team_testimonials SET status = 'aceito', acceptedAt = sqlite_now() WHERE id = ?").run(t.id);
    const r = await createReport({ targetType: "depoimento", targetId: t.id, reporterId: v.id, reason: "ofensa ou assédio" });
    expect(r.blocked).toBe(a.username);
    const row = await db
      .prepare("SELECT targetMemberId, hackathonId, communityId, snapshot FROM reports WHERE id = ?")
      .get<{ targetMemberId: number; hackathonId: string; communityId: number | null; snapshot: string }>(r.id);
    expect(row).toEqual({ targetMemberId: a.id, hackathonId: PAST, communityId: null, snapshot: `@${a.username} sobre @${b.username}: ${TEXT}` });
    // quem denunciou não vê mais o depoimento
    expect(await listAccepted(b.id, v.id)).toEqual([]);
  });

  it("HTML no texto sai escapado e link não vira <a>", async () => {
    const { a, b } = await pair();
    const evil = `<script>alert(1)</script><a href="https://x.dev">clica</a> ${TEXT}`;
    const t = await writeTestimonial(a.id, b.id, PAST, evil);
    expect(t.body).toBe(evil);
    await db.prepare("UPDATE team_testimonials SET status = 'aceito', acceptedAt = sqlite_now() WHERE id = ?").run(t.id);
    const { TestimonialList } = await import("@/components/TestimonialList");
    const v = await member();
    const html = renderToStaticMarkup((await TestimonialList({ memberId: b.id, me: { id: v.id } }))!);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="https://x.dev"');
    expect(html).toContain("denunciar");
    // visita sem nenhum aceito: a seção some
    const empty = await member();
    expect(await TestimonialList({ memberId: empty.id, me: { id: v.id } })).toBeNull();
    // dono sem nenhum aceito: o porquê
    const own = renderToStaticMarkup((await TestimonialList({ memberId: empty.id, me: { id: empty.id } }))!);
    expect(own).toContain("Depoimento aqui só vem de quem fez time com você.");
  });
});

describe("achados da revisão", () => {
  it("aceitar confere o texto que a tela mostrou: troca no meio dá 409 e nada vai pro perfil", async () => {
    const { a, b } = await pair();
    const { accept, one } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    // b abriu a caixa com o texto original; a troca o pendente em silêncio
    as(a);
    const troca = `${TEXT} Troquei depois que você abriu.`;
    expect((await one.PATCH(json("PATCH", { body: troca }), idCtx(testimonial.id))).status).toBe(200);
    as(b);
    const r = await accept.POST(seen(testimonial), idCtx(testimonial.id));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "O texto mudou. Recarregue a página." });
    expect(await statusOf(testimonial.id)).toEqual({ status: "pendente", acceptedAt: null });
    // sem o texto não aceita
    expect((await accept.POST(json("POST"), idCtx(testimonial.id))).status).toBe(400);
    expect((await accept.POST(json("POST", { body: 42 }), idCtx(testimonial.id))).status).toBe(400);
    // releu: aceita o texto novo
    expect((await accept.POST(json("POST", { body: troca }), idCtx(testimonial.id))).status).toBe(200);
    expect((await listAccepted(b.id)).map((t) => t.body)).toEqual([troca]);
  });

  it("mostrar de novo um oculto editado também exige o texto novo", async () => {
    const { a, b } = await pair();
    const { accept, hide, one } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    as(b);
    await accept.POST(seen(testimonial), idCtx(testimonial.id));
    await hide.POST(json("POST"), idCtx(testimonial.id));
    const [hidden] = await listHidden(b.id);
    as(a);
    const troca = `${TEXT} Mudei enquanto estava escondido.`;
    await one.PATCH(json("PATCH", { body: troca }), idCtx(testimonial.id));
    expect((await statusOf(testimonial.id))?.status).toBe("oculto");
    as(b);
    expect((await accept.POST(seen(hidden), idCtx(testimonial.id))).status).toBe(409);
    expect((await statusOf(testimonial.id))?.status).toBe("oculto");
    expect((await accept.POST(json("POST", { body: troca }), idCtx(testimonial.id))).status).toBe(200);
    expect((await statusOf(testimonial.id))?.status).toBe("aceito");
  });

  it("apagar e reescrever não avisa de novo; o texto novo espera na caixa", async () => {
    const { a, b } = await pair();
    const { decline, one } = await routes();
    const first = (await (await post(a, b)).json()).testimonial;
    as(b);
    await decline.POST(json("POST"), idCtx(first.id));
    for (let i = 0; i < 3; i++) {
      as(a);
      const sent = (await listWrittenBy(a.id))[0];
      expect((await one.DELETE(json("DELETE"), idCtx(sent.id))).status).toBe(200);
      expect((await post(a, b, `${TEXT} Tentativa ${i}.`)).status).toBe(201);
    }
    expect((await notifs(b.id)).length).toBe(1);
    expect((await listPending(b.id)).map((t) => t.body)).toEqual([`${TEXT} Tentativa 2.`]);
    // passado a janela, o aviso volta (outro par segue independente)
    await db.prepare("UPDATE notifications SET createdAt = '2020-01-01 00:00:00' WHERE memberId = ?").run(b.id);
    as(a);
    await one.DELETE(json("DELETE"), idCtx((await listWrittenBy(a.id))[0].id));
    expect((await post(a, b)).status).toBe(201);
    expect((await notifs(b.id)).length).toBe(2);
  });

  it("quem trata a denúncia tira o depoimento do ar; dono não traz de volta, autor não reescreve", async () => {
    const { a, b } = await pair();
    const { accept, one, takedown } = await routes();
    const { testimonial } = await (await post(a, b)).json();
    as(b);
    await accept.POST(seen(testimonial), idCtx(testimonial.id));
    const v = await member();
    const v2 = await member();
    const rep = await createReport({ targetType: "depoimento", targetId: testimonial.id, reporterId: v.id, reason: "expõe dado de outra pessoa" });
    const rep2 = await createReport({ targetType: "depoimento", targetId: testimonial.id, reporterId: v2.id, reason: "ofensa ou assédio" });
    // a fila linka pro perfil de quem recebeu
    expect((await getReport(rep.id))?.href).toBe(`/u/${b.username}`);

    const org = await member();
    await db.prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')").run(PAST, org.id);
    const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
    // estranho 403, autor e dono também (não moderam)
    for (const who of [v, a, b]) {
      as(who);
      expect((await takedown.POST(json("POST"), ctx(rep.id))).status).toBe(403);
    }
    as(org);
    expect((await takedown.POST(json("POST"), ctx("abc"))).status).toBe(404);
    expect((await takedown.POST(json("POST"), ctx(999999))).status).toBe(404);
    expect((await takedown.POST(json("POST"), ctx(rep.id))).status).toBe(200);
    expect((await statusOf(testimonial.id))?.status).toBe("removido");
    // as duas denúncias saem resolvidas
    for (const id of [rep.id, rep2.id]) {
      const r = await getReport(id);
      expect([r?.resolution, r?.resolvedByUsername]).toEqual(["tirei o conteúdo do ar", org.username]);
    }

    expect(await listAccepted(b.id)).toEqual([]);
    expect(await listHidden(b.id)).toEqual([]);
    expect(await listPending(b.id)).toEqual([]);
    as(b);
    expect((await accept.POST(seen(testimonial), idCtx(testimonial.id))).status).toBe(404);
    as(a);
    expect(await listWrittenBy(a.id)).toEqual([]);
    expect((await one.PATCH(json("PATCH", { body: `${TEXT} de novo` }), idCtx(testimonial.id))).status).toBe(404);
    expect((await one.DELETE(json("DELETE"), idCtx(testimonial.id))).status).toBe(404);
    expect((await post(a, b)).status).toBe(409);
    expect((await teammatesToWrite(a.id)).flatMap((g) => g.people.map((p) => p.id))).not.toContain(b.id);
    // denunciar de novo: não existe mais
    await expect(createReport({ targetType: "depoimento", targetId: testimonial.id, reporterId: org.id, reason: "ainda está lá?" })).rejects.toMatchObject({ status: 404 });
  });

  it("admin global tira do ar; denúncia de outro tipo dá 400", async () => {
    const { a, b } = await pair();
    const t = await writeTestimonial(a.id, b.id, PAST, TEXT);
    await db.prepare("UPDATE team_testimonials SET status = 'aceito', acceptedAt = sqlite_now() WHERE id = ?").run(t.id);
    const v = await member();
    const rep = await createReport({ targetType: "depoimento", targetId: t.id, reporterId: v.id, reason: "ofensa ou assédio" });
    const admin = await member();
    await db.prepare("UPDATE members SET role = 'admin' WHERE id = ?").run(admin.id);
    await takeDownTestimonial(rep.id, { id: admin.id, role: "admin" });
    expect((await statusOf(t.id))?.status).toBe("removido");
    const other = await createReport({ targetType: "member", targetId: a.id, reporterId: (await member()).id, reason: "perfil falso" });
    await expect(takeDownTestimonial(other.id, { id: admin.id, role: "admin" })).rejects.toMatchObject({ status: 400 });
  });

  it("edição fora da regra antifarm aparece no perfil mas não conta", async () => {
    // edição nova, encerrada, sem check-in nenhum
    const ed = `dp-ed-${seq++}`;
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
         VALUES (?, 'Hack Pequeno', 'Org', '2025-03-01T09:00:00-03:00', '2025-03-02T18:00:00-03:00', 'presencial', '', '[]', 1, 'painel')`,
      )
      .run(ed);
    const a = await member();
    const b = await member();
    await team(ed, [a, b]);
    const t = await writeTestimonial(a.id, b.id, ed, TEXT);
    await db.prepare("UPDATE team_testimonials SET status = 'aceito', acceptedAt = sqlite_now() WHERE id = ?").run(t.id);
    expect((await listAccepted(b.id)).length).toBe(1);
    expect(await countAccepted(b.id)).toBe(0);
    await makeEligible(ed);
    expect(await countAccepted(b.id)).toBe(1);
  });
});
