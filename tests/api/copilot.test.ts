import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { EVALUATION_REPLY } from "@/lib/copilot/guard";
import { resetRateLimits } from "@/lib/ratelimit";

// Copilot do arquivo (spec 046, onda 6: copilot-do-arquivo, migration 055).
// Cobre as intenções contra o arquivo real no PGlite, as fronteiras
// (projeto invisível, bloqueado, dúvida resolvida só pra inscrito), a
// guarda de avaliação, o LLM mockado (nunca rede de verdade), a cota
// copilot-llm, o log/poda de 90 dias e o feedback.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

// ids únicos por teste: o PGlite do arquivo é compartilhado entre os casos
let H = ""; // edição do arquivo (visível, com campeão)
let H_REGRAS = ""; // edição "ao vivo" pra intenção regras
let H_INV = ""; // edição com trava no futuro: projeto invisível

let seq = 0;
type M = { id: number; clerkId: string; username: string; role: string };
async function member(fields: { username?: string; name?: string; skills?: string[] } = {}): Promise<M> {
  const tag = `cp${seq++}`;
  const username = fields.username ?? `u_${tag}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, skills) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, username, `${tag}@t.dev`, fields.name ?? `Pessoa ${tag}`, JSON.stringify(fields.skills ?? []));
  return { id: row!.id, clerkId: `clerk_${tag}`, username, role: "member" };
}
async function hackathon(
  id: string,
  name: string,
  o: { deadline?: string | null; communityId?: number | null } = {},
) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, "startsAt", "endsAt", format, location, "registrationUrl", active, source, "submissionDeadline")
       VALUES (?, ?, 'Org Teste', '2026-03-01 09:00:00', '2026-03-02 18:00:00', 'presencial', 'São Paulo, SP', 'https://exemplo.dev', 1, 'painel', ?)`,
    )
    .run(id, name, o.deadline ?? null);
}
async function team(hackathonId: string, name: string, placement = 0) {
  const t = await db
    .prepare('INSERT INTO teams ("hackathonId", name, placement) VALUES (?, ?, ?) RETURNING id')
    .get<{ id: number }>(hackathonId, name, placement);
  return t!.id;
}
async function project(teamId: number, fields: { title: string; tagline?: string; description?: string; tech?: string[] }) {
  await db
    .prepare('INSERT INTO team_projects ("teamId", title, tagline, description, technologies, "howBuilt") VALUES (?, ?, ?, ?, ?, ?)')
    .run(teamId, fields.title, fields.tagline ?? null, fields.description ?? null, JSON.stringify(fields.tech ?? []), "feito com carinho");
  for (const tag of fields.tech ?? []) {
    await db.prepare('INSERT INTO project_tech ("teamId", tag) VALUES (?, ?) ON CONFLICT DO NOTHING').run(teamId, tag);
  }
}

const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const post = (body: unknown) =>
  import("@/app/api/copilot/route").then((r) =>
    r.POST(new Request("http://t/api/copilot", { method: "POST", body: JSON.stringify(body) })),
  );
const feedback = (body: unknown) =>
  import("@/app/api/copilot/feedback/route").then((r) =>
    r.POST(new Request("http://t/api/copilot/feedback", { method: "POST", body: JSON.stringify(body) })),
  );

let me: M;
let dev: M; // pessoa com skills
let caronaTeamId: number;
let edNome = ""; // nome único da edição do arquivo (o nome casa a pergunta)

beforeEach(async () => {
  resetRateLimits();
  delete process.env.COPILOT_LLM_URL;
  delete process.env.COPILOT_LLM_KEY;
  delete process.env.COPILOT_LLM_MODEL;
  vi.unstubAllGlobals();

  me = await member({ username: `eu_cop_${seq}` });
  dev = await member({ username: `dev_supa_${seq}`, name: "Dev Supa", skills: ["Supabase", "Python"] });
  H = `h-cop-alfa-${seq}`;
  H_REGRAS = `h-cop-regras-${seq}`;
  H_INV = `h-cop-inv-${seq}`;
  edNome = `Hack Copq${seq}z`;

  // arquivo: edição encerrada "modo antigo" (sem trava → projeto visível)
  await hackathon(H, edNome);
  caronaTeamId = await team(H, "Time Carona", 1);
  await project(caronaTeamId, {
    title: "Carona Universitária Segura",
    tagline: "app de carona entre estudantes da mesma faculdade",
    description: "carona universitária com verificação por e-mail institucional",
    tech: ["supabase", "react"],
  });
  await db.prepare('INSERT INTO team_members ("teamId", username) VALUES (?, ?)').run(caronaTeamId, dev.username);
  const cat = await db
    .prepare('INSERT INTO prize_categories ("hackathonId", kind, name, places, position) VALUES (?, \'geral\', \'Grande Prêmio\', 1, 0) RETURNING id')
    .get<{ id: number }>(H);
  await db.prepare('INSERT INTO prize_winners ("categoryId", "teamId", place) VALUES (?, ?, 1)').run(cat!.id, caronaTeamId);

  // edição "ao vivo": prazo, agenda, desafio e dúvida resolvida
  await hackathon(H_REGRAS, "Hack Regras 2026", { deadline: "2026-03-02 15:00:00" });
  await db.prepare('UPDATE hackathons SET "submissionGraceMinutes" = 5 WHERE id = ?').run(H_REGRAS);
  await db
    .prepare(
      `INSERT INTO schedule_items ("hackathonId", title, description, "startsAt", "endsAt", room, kind, "publishedAt")
       VALUES (?, 'Pitch final', 'apresentação dos times', '2026-03-02 14:00:00', '2026-03-02 15:00:00', 'Auditório', 'pitch', '2026-03-01 09:00:00')`,
    )
    .run(H_REGRAS);
  await db
    .prepare(
      `INSERT INTO challenges (id, "hackathonId", sponsor, title, description, prize, active)
       VALUES (?, ?, 'Banco Teste', 'PIX pra todo mundo', 'use a API de pagamento', 'R$ 5 mil', 1)`,
    )
    .run(`ch-cop-${seq}`, H_REGRAS);
  await db.prepare('INSERT INTO registrations ("memberId", "hackathonId", status) VALUES (?, ?, \'approved\')').run(me.id, H_REGRAS);
  const pergunta = await db
    .prepare('INSERT INTO questions ("hackathonId", "memberId", body, "resolvedAt") VALUES (?, ?, \'pode usar lib paga?\', \'2026-03-01 12:00:00\') RETURNING id')
    .get<{ id: number }>(H_REGRAS, me.id);
  await db.prepare('INSERT INTO answers ("questionId", "memberId", body) VALUES (?, ?, \'pode, desde que declare na entrega\')').run(pergunta!.id, me.id);

  // edição com trava no futuro: projeto dentro dela é invisível
  await hackathon(H_INV, "Hack Trava Futura 2099", { deadline: "2099-01-02 15:00:00" });
  const tInv = await team(H_INV, "Time Segredo");
  await project(tInv, { title: "Carona Secreta Invisível", tagline: "carona que ninguém pode ver" });

  as(me);
});

afterEach(() => {
  delete process.env.COPILOT_LLM_URL;
  delete process.env.COPILOT_LLM_KEY;
  delete process.env.COPILOT_LLM_MODEL;
  vi.unstubAllGlobals();
});

function llmOk(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ choices: [{ message: { content } }] })),
  );
}

describe("detecção e fatos por intenção", () => {
  it("'similar' acha projeto visível por FTS, com edição e link /p", async () => {
    const res = await post({ q: "já fizeram app de carona universitária?" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.intent).toBe("similar");
    expect(data.summary).toBeNull(); // sem env de LLM: só fatos
    const carona = data.facts.find((f: { titulo: string }) => f.titulo.includes("Carona"));
    expect(carona).toBeTruthy();
    expect(carona.href).toBe(`/p/${caronaTeamId}`);
    expect(carona.trecho).toContain(edNome);
    expect(carona.trecho).toContain("1º lugar");
  });

  it("projeto invisível (trava no futuro) nunca aparece", async () => {
    const res = await post({ q: "já fizeram projeto de carona secreta invisível?" });
    const data = await res.json();
    expect(res.status).toBe(200);
    const links = data.facts.map((f: { href: string }) => f.href);
    const tInv = await db.prepare("SELECT id FROM teams WHERE name = 'Time Segredo'").get<{ id: number }>();
    expect(links).not.toContain(`/p/${tInv!.id}`);
    data.facts.forEach((f: { titulo: string }) => expect(f.titulo).not.toContain("Secreta"));
  });

  it("'stack' acha projeto por project_tech e pessoa por skills", async () => {
    const res = await post({ q: "quem já usou supabase?" });
    const data = await res.json();
    expect(data.intent).toBe("stack");
    const tipos = data.facts.map((f: { tipo: string }) => f.tipo);
    expect(tipos).toContain("projeto");
    expect(tipos).toContain("pessoa");
    const pessoa = data.facts.find((f: { tipo: string }) => f.tipo === "pessoa");
    expect(pessoa.href).toBe(`/u/${dev.username}`);
  });

  it("'edicao' cita vencedores da edição pelo nome", async () => {
    const res = await post({ q: `quem ganhou a ${edNome}?` });
    const data = await res.json();
    expect(data.intent).toBe("edicao");
    const vencedor = data.facts.find((f: { tipo: string }) => f.tipo === "vencedor");
    expect(vencedor).toBeTruthy();
    expect(vencedor.titulo).toContain("Time Carona");
    expect(vencedor.trecho).toContain("Grande Prêmio");
    expect(vencedor.href).toBe(`/p/${caronaTeamId}`);
  });

  it("'edicao' sem edição citada cai nas últimas com resultado", async () => {
    const res = await post({ q: "quem ganhou?" });
    const data = await res.json();
    expect(data.intent).toBe("edicao");
    expect(data.facts.some((f: { tipo: string }) => f.tipo === "vencedor")).toBe(true);
  });

  it("'regras' com hackathonId lê prazo, agenda, desafio e dúvida resolvida", async () => {
    const res = await post({ q: "qual o prazo de entrega?", hackathonId: H_REGRAS });
    const data = await res.json();
    expect(data.intent).toBe("regras");
    expect(data.facts.some((f: { titulo: string }) => f.titulo === "Prazo de entrega")).toBe(true);

    const agenda = await post({ q: "que horas é o pitch?", hackathonId: H_REGRAS });
    const dAgenda = await agenda.json();
    expect(dAgenda.facts.some((f: { tipo: string; titulo: string }) => f.tipo === "agenda" && f.titulo === "Pitch final")).toBe(true);

    const desafio = await post({ q: "tem desafio de patrocinador?", hackathonId: H_REGRAS });
    const dDesafio = await desafio.json();
    expect(dDesafio.facts.some((f: { tipo: string; titulo: string }) => f.tipo === "desafio" && f.titulo.includes("PIX"))).toBe(true);

    const duvida = await post({ q: "pode usar lib paga?", hackathonId: H_REGRAS });
    const dDuvida = await duvida.json();
    expect(dDuvida.facts.some((f: { tipo: string }) => f.tipo === "duvida")).toBe(true);
  });

  it("dúvida resolvida não aparece pra quem não está inscrito", async () => {
    as(dev); // dev não se inscreveu em H_REGRAS
    const res = await post({ q: "pode usar lib paga?", hackathonId: H_REGRAS });
    const data = await res.json();
    expect(data.facts.every((f: { tipo: string }) => f.tipo !== "duvida")).toBe(true);
  });

  it("pessoa bloqueada não aparece nos fatos de stack", async () => {
    await db.prepare('INSERT INTO member_blocks ("memberId", "blockedId") VALUES (?, ?)').run(me.id, dev.id);
    const res = await post({ q: "quem já usou supabase?" });
    const data = await res.json();
    expect(data.facts.every((f: { href: string }) => f.href !== `/u/${dev.username}`)).toBe(true);
  });
});

describe("guarda de avaliação — IA nunca dá nota", () => {
  it("'minha ideia é boa?' recebe a resposta fixa + similares", async () => {
    const res = await post({ q: "minha ideia de carona é boa?" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.intent).toBe("similar");
    expect(data.summary).toBe(EVALUATION_REPLY);
    expect(data.facts.some((f: { href: string }) => f.href.startsWith("/p/"))).toBe(true);
    // resposta fixa não passa pelo LLM
    const log = await db.prepare("SELECT \"usedLlm\" FROM copilot_queries WHERE id = ?").get<{ usedLlm: number }>(data.id);
    expect(log!.usedLlm).toBe(0);
  });

  it("com LLM ligado, pedido de avaliação continua sem chamar o LLM", async () => {
    process.env.COPILOT_LLM_URL = "http://127.0.0.1:9/llm";
    process.env.COPILOT_LLM_KEY = "k";
    const spy = vi.fn(async () => Response.json({ choices: [{ message: { content: "texto" } }] }));
    vi.stubGlobal("fetch", spy);
    const res = await post({ q: "vou ganhar o hackathon?" });
    const data = await res.json();
    expect(data.summary).toBe(EVALUATION_REPLY);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("LLM opcional (fetch mockado — nunca rede real)", () => {
  beforeEach(() => {
    process.env.COPILOT_LLM_URL = "http://llm.test/chat";
    process.env.COPILOT_LLM_KEY = "teste";
    process.env.COPILOT_LLM_MODEL = "modelo-x";
  });

  it("resumo válido com citação passa e marca usedLlm", async () => {
    llmOk("Já fizeram algo parecido: o Carona Universitária Segura [1].");
    const res = await post({ q: "já fizeram app de carona?" });
    const data = await res.json();
    expect(data.summary).toBe("Já fizeram algo parecido: o Carona Universitária Segura [1].");
    const log = await db.prepare("SELECT \"usedLlm\" FROM copilot_queries WHERE id = ?").get<{ usedLlm: number }>(data.id);
    expect(log!.usedLlm).toBe(1);
  });

  it("resumo com 'nota 8/10' é descartado", async () => {
    llmOk("O projeto merece nota 8/10 pela ideia [1].");
    const res = await post({ q: "já fizeram app de carona?" });
    const data = await res.json();
    expect(data.summary).toBeNull();
    expect(data.facts.length).toBeGreaterThan(0);
  });

  it("citação [9] com menos fatos é descartada", async () => {
    llmOk("Olha esse projeto incrível [9] e também [1].");
    const res = await post({ q: "já fizeram app de carona?" });
    const data = await res.json();
    expect(data.summary).toBeNull();
  });

  it("LLM fora do ar cai pro modo só resultados", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const res = await post({ q: "já fizeram app de carona?" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBeNull();
    expect(data.facts.length).toBeGreaterThan(0);
  });

  it("resposta não-200 do provedor → summary null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    const res = await post({ q: "já fizeram app de carona?" });
    const data = await res.json();
    expect(data.summary).toBeNull();
  });
});

describe("rota: auth, validação e limites", () => {
  it("deslogado → 401 JSON", async () => {
    as(null);
    const res = await post({ q: "já fizeram app de carona?" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("q curta/longa → 400; hackathonId inválido → 400", async () => {
    expect((await post({ q: "oi" })).status).toBe(400);
    expect((await post({ q: "x".repeat(301) })).status).toBe(400);
    expect((await post({ q: "tudo bem?", hackathonId: "nao-existe" })).status).toBe(400);
  });

  it("31ª pergunta na hora → 429", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post({ q: `pergunta de teste número ${i}?` })).status;
    expect(last).toBe(429);
  });
});

describe("log e feedback (copilot_queries)", () => {
  it("grava a pergunta e poda o que tem mais de 90 dias", async () => {
    await db
      .prepare("INSERT INTO copilot_queries (\"memberId\", question, intent, \"createdAt\") VALUES (?, 'velha', 'busca', '2020-01-01 00:00:00')")
      .run(me.id);
    const res = await post({ q: "já fizeram app de carona?" });
    expect(res.status).toBe(200);
    const velhas = await db.prepare("SELECT COUNT(*)::int AS n FROM copilot_queries WHERE question = 'velha'").get<{ n: number }>();
    expect(velhas!.n).toBe(0);
    const data = await res.json();
    const log = await db
      .prepare('SELECT question, intent, "resultCount" FROM copilot_queries WHERE id = ?')
      .get<{ question: string; intent: string; resultCount: number }>(data.id);
    expect(log!.question).toBe("já fizeram app de carona?");
    expect(log!.intent).toBe("similar");
  });

  it("feedback grava helpful só na própria pergunta", async () => {
    const res = await post({ q: "já fizeram app de carona?" });
    const { id } = await res.json();
    expect((await feedback({ id, helpful: true })).status).toBe(200);
    const row = await db.prepare("SELECT helpful FROM copilot_queries WHERE id = ?").get<{ helpful: number }>(id);
    expect(row!.helpful).toBe(1);

    // outra pessoa não vota na minha pergunta
    as(dev);
    expect((await feedback({ id, helpful: false })).status).toBe(404);
    // payload inválido
    expect((await feedback({ id: "x", helpful: true })).status).toBe(400);
    expect((await feedback({ id, helpful: "sim" })).status).toBe(400);
  });
});
