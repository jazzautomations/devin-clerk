import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block } from "@/lib/blocks";
import { resetRateLimits } from "@/lib/ratelimit";
import { getMemberByUsername } from "@/lib/members";
import { respondInvite } from "@/lib/teamInvites";
import {
  activityEditions,
  applyToOpening,
  closeOpening,
  createOpening,
  getOpening,
  listOpenings,
  openAreasOfMyTeams,
  respondApplication,
  signalTeamUp,
} from "@/lib/teamOpenings";

// Vagas de time (spec 046, onda 3 — migration 045): o time abre vaga, a
// pessoa se candidata com intro curta, o aceite vira convite de time e a
// vaga fica preenchida quando o convite é aceito. Bloqueio é 404 genérico,
// o e-mail só aparece pros dois depois do aceite, e "bora fazer junto" é
// silencioso até o mútuo.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const H = "vagas-jam-2026";
const PAST = "vagas-jam-passado";

let seq = 0;
type M = { id: number; clerkId: string; username: string; email: string };

async function member(extra: Record<string, unknown> = {}): Promise<M> {
  const tag = `vg${seq++}`;
  const cols = Object.keys(extra);
  const row = await db
    .prepare(
      `INSERT INTO members ("clerkId", username, email, name${cols.length ? `, ${cols.map((c) => `"${c}"`).join(", ")}` : ""})
       VALUES (?, ?, ?, ?${cols.map(() => ", ?").join("")}) RETURNING id`,
    )
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, ...Object.values(extra));
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}`, email: `${tag}@t.dev` };
}

async function register(m: M, hackathonId = H, status = "approved") {
  await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
    .run(m.id, hackathonId, status);
}

async function team(hackathonId: string, people: M[]): Promise<number> {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Time ${seq++}`);
  for (const p of people) {
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, p.username);
  }
  return t!.id;
}

const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};

const json = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const ctx2 = (id: number | string, applicationId: number | string) => ({
  params: Promise.resolve({ id: String(id), applicationId: String(applicationId) }),
});

const routes = async () => ({
  root: await import("@/app/api/openings/route"),
  one: await import("@/app/api/openings/[id]/route"),
  apply: await import("@/app/api/openings/[id]/applications/route"),
  respond: await import("@/app/api/openings/[id]/applications/[applicationId]/route"),
  teamUp: await import("@/app/api/team-up/route"),
  board: await import("@/app/api/hackathons/[id]/team-board/route"),
});

async function edition(id: string, opts: { startsAt?: string; endsAt?: string; registrationDeadline?: string } = {}) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, 'HackaHub Teste', ?, ?, 'presencial', 'https://t.dev/vagas', '[]', 1, 'painel')`,
    )
    .run(id, `Edição ${id}`, opts.startsAt ?? "2027-03-01T09:00:00-03:00", opts.endsAt ?? "2027-03-02T18:00:00-03:00");
}

const notifications = (memberId: number, type: string) =>
  db.prepare("SELECT * FROM notifications WHERE memberId = ? AND type = ?").all<{ text: string }>(memberId, type);

beforeEach(async () => {
  resetRateLimits();
  await db.prepare("DELETE FROM team_up_signals").run();
  await db.prepare("DELETE FROM opening_applications").run();
  await db.prepare("DELETE FROM team_openings").run();
  await db.prepare("DELETE FROM notifications").run();
  await edition(H);
  await edition(PAST, { startsAt: "2026-01-10T09:00:00-03:00", endsAt: "2026-01-11T18:00:00-03:00" });
});

describe("abrir vaga", () => {
  it("integrante do time abre (201) com área e intro; quem não é do time leva 403", async () => {
    const { root } = await routes();
    const ana = await member();
    const bia = await member();
    await register(ana);
    await register(bia);
    await team(H, [ana]);

    as(ana);
    const ok = await root.POST(json("POST", { hackathonId: H, area: "design", intro: "procuro design pro pitch" }));
    expect(ok.status).toBe(201);
    const { opening } = await ok.json();
    expect(opening.area).toBe("design");
    expect(opening.intro).toBe("procuro design pro pitch");
    expect(opening.members).toEqual([ana.username]);
    expect(opening.status).toBe("aberta");

    as(bia);
    const forbidden = await root.POST(json("POST", { hackathonId: H, area: "dev", intro: "procuro dev" }));
    expect(forbidden.status).toBe(403);
  });

  it("quarta vaga aberta dá 400; fechada conta como livre de novo", async () => {
    const ana = await member();
    await register(ana);
    const t = await team(H, [ana]);
    const ids: number[] = [];
    for (const area of ["dev", "design", "dados"] as const) {
      const o = await createOpening(ana, { hackathonId: H, area, intro: `procuro ${area}` });
      ids.push(o.id);
    }
    await expect(createOpening(ana, { hackathonId: H, area: "produto", intro: "procuro produto" })).rejects.toMatchObject({
      status: 400,
    });
    await closeOpening(ana, ids[0]);
    const outra = await createOpening(ana, { hackathonId: H, area: "produto", intro: "procuro produto" });
    expect(outra.status).toBe("aberta");
    expect(await db.prepare("SELECT 1 FROM teams WHERE id = ?").get(t)).toBeTruthy();
  });

  it("área fora de AREA_KEYS, intro vazia e intro longa dão 400; edição encerrada dá 409", async () => {
    const ana = await member();
    await register(ana);
    await register(ana, PAST);
    await team(H, [ana]);
    await team(PAST, [ana]);

    await expect(createOpening(ana, { hackathonId: H, area: "marketing", intro: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(createOpening(ana, { hackathonId: H, area: "dev", intro: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(
      createOpening(ana, { hackathonId: H, area: "dev", intro: "x".repeat(281) }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(createOpening(ana, { hackathonId: PAST, area: "dev", intro: "procuro dev" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("deslogado → 401 JSON, nunca redirect", async () => {
    const { root } = await routes();
    as(null);
    const res = await root.POST(json("POST", { hackathonId: H, area: "dev", intro: "procuro dev" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await root.GET(json("GET"))).status).toBe(401);
  });
});

describe("candidatura", () => {
  async function cenario() {
    const ana = await member();
    const bia = await member();
    await register(ana);
    await register(bia);
    await team(H, [ana]);
    const opening = await createOpening(ana, { hackathonId: H, area: "design", intro: "procuro design" });
    return { ana, bia, opening };
  }

  it("sem inscrição aprovada → 403; com time → 409", async () => {
    const { root, apply } = await routes();
    const { ana, opening } = await cenario();
    const sem = await member();
    as(sem);
    expect((await apply.POST(json("POST", { intro: "sou design" }), ctx(opening.id))).status).toBe(403);

    const comTime = await member();
    await register(comTime);
    await team(H, [comTime]);
    as(comTime);
    expect((await apply.POST(json("POST", { intro: "sou design" }), ctx(opening.id))).status).toBe(409);
    void root;
    void ana;
  });

  it("bloqueio com integrante → 404 genérico (não revela a vaga)", async () => {
    const { apply } = await routes();
    const { ana, bia, opening } = await cenario();
    await block(ana.id, bia.id);
    as(bia);
    const res = await apply.POST(json("POST", { intro: "sou design" }), ctx(opening.id));
    expect(res.status).toBe(404);
  });

  it("candidatura entra, notifica o time e o e-mail fica escondido até o aceite", async () => {
    const { apply } = await routes();
    const { ana, bia, opening } = await cenario();
    as(bia);
    const res = await apply.POST(json("POST", { intro: "faço design e protótipo" }), ctx(opening.id));
    expect(res.status).toBe(201);

    const paraTime = await getOpening(opening.id, ana);
    expect(paraTime!.applications).toHaveLength(1);
    expect(paraTime!.applications[0].username).toBe(bia.username);
    expect(paraTime!.applications[0].status).toBe("enviada");
    expect(paraTime!.applications[0].email).toBeNull();
    expect((await notifications(ana.id, "opening_application")).length).toBe(1);

    // a candidata também não vê e-mail do time antes do aceite
    const paraCandidata = await getOpening(opening.id, bia);
    expect(paraCandidata!.mine?.status).toBe("enviada");
    expect(paraCandidata!.contactEmails).toEqual([]);
  });

  it("duplicada → 409; recusada pode voltar", async () => {
    const { ana, bia, opening } = await cenario();
    await applyToOpening(bia, opening.id, "primeira intro");
    await expect(applyToOpening(bia, opening.id, "de novo")).rejects.toMatchObject({ status: 409 });

    const paraTime = await getOpening(opening.id, ana);
    await respondApplication(ana, paraTime!.applications[0].id, "decline");
    const volta = await applyToOpening(bia, opening.id, "agora com portfolio");
    expect(volta.opening.mine?.intro).toBe("agora com portfolio");
  });

  it("vaga fechada → 404", async () => {
    const { ana, bia, opening } = await cenario();
    await closeOpening(ana, opening.id);
    await expect(applyToOpening(bia, opening.id, "sou design")).rejects.toMatchObject({ status: 404 });
  });
});

describe("aceite do time vira convite", () => {
  it("aceitar cria convite; o convite aceito põe a pessoa no time e preenche a vaga", async () => {
    const { ana, bia, opening } = await (async () => {
      const ana = await member();
      const bia = await member();
      await register(ana);
      await register(bia);
      await team(H, [ana]);
      const opening = await createOpening(ana, { hackathonId: H, area: "design", intro: "procuro design" });
      await applyToOpening(bia, opening.id, "faço design");
      return { ana, bia, opening };
    })();

    const paraTime = await getOpening(opening.id, ana);
    const aceito = await respondApplication(ana, paraTime!.applications[0].id, "accept");
    expect(aceito.applications[0].status).toBe("aceita");
    // ainda não entrou: o convite é quem põe no time
    expect(aceito.status).toBe("aberta");
    expect(await db.prepare("SELECT 1 FROM team_members WHERE username = ?").get(bia.username)).toBeUndefined();

    const invite = await db
      .prepare("SELECT id, status FROM team_invites WHERE memberId = ? AND hackathonId = ?")
      .get<{ id: number; status: string }>(bia.id, H);
    expect(invite!.status).toBe("pending");

    // e-mail liberado pros dois lados a partir do aceite
    const comEmail = await getOpening(opening.id, ana);
    expect(comEmail!.applications[0].email).toBe(bia.email);
    const candidata = await getOpening(opening.id, bia);
    expect(candidata!.contactEmails).toContain(ana.email);

    await respondInvite(invite!.id, bia, "accept", H);
    expect(await db.prepare("SELECT 1 FROM team_members WHERE username = ?").get(bia.username)).toBeTruthy();
    const preenchida = await getOpening(opening.id, ana);
    expect(preenchida!.status).toBe("preenchida");
  });

  it("recusar avisa com frase neutra, sem culpar ninguém", async () => {
    const ana = await member();
    const bia = await member();
    await register(ana);
    await register(bia);
    await team(H, [ana]);
    const opening = await createOpening(ana, { hackathonId: H, area: "design", intro: "procuro design" });
    await applyToOpening(bia, opening.id, "faço design");
    const paraTime = await getOpening(opening.id, ana);
    await respondApplication(ana, paraTime!.applications[0].id, "decline");

    const [n] = await notifications(bia.id, "opening_declined");
    expect(n.text).toBe('A vaga de design no time "' + (paraTime!.teamName) + '" foi preenchida de outro jeito.');
    expect(n.text).not.toMatch(/você|culpa|infelizmente/i);
  });

  it("quem não é do time não responde (404) e a candidatura não volta atrás", async () => {
    const ana = await member();
    const bia = await member();
    const caio = await member();
    await register(ana);
    await register(bia);
    await register(caio);
    await team(H, [ana]);
    const opening = await createOpening(ana, { hackathonId: H, area: "design", intro: "procuro design" });
    await applyToOpening(bia, opening.id, "faço design");
    const paraTime = await getOpening(opening.id, ana);
    await expect(respondApplication(caio, paraTime!.applications[0].id, "accept")).rejects.toMatchObject({ status: 404 });
  });

  it("convite recusado: candidatura vira retirada e a vaga continua aberta", async () => {
    const ana = await member();
    const bia = await member();
    await register(ana);
    await register(bia);
    await team(H, [ana]);
    const opening = await createOpening(ana, { hackathonId: H, area: "design", intro: "procuro design" });
    await applyToOpening(bia, opening.id, "faço design");
    const paraTime = await getOpening(opening.id, ana);
    await respondApplication(ana, paraTime!.applications[0].id, "accept");
    const invite = await db
      .prepare("SELECT id FROM team_invites WHERE memberId = ? AND hackathonId = ?")
      .get<{ id: number }>(bia.id, H);
    await respondInvite(invite!.id, bia, "decline", H);
    const depois = await getOpening(opening.id, ana);
    expect(depois!.status).toBe("aberta");
    expect(depois!.applications).toHaveLength(0);
  });
});

describe("bora fazer junto (team_up_signals)", () => {
  async function par() {
    const ana = await member();
    const bia = await member();
    await register(ana);
    await register(bia);
    return { ana, bia };
  }

  it("um sinal sozinho não notifica e não é mútuo", async () => {
    const { ana, bia } = await par();
    const r = await signalTeamUp(ana, { username: bia.username, hackathonId: H });
    expect(r).toEqual({ mutual: false, action: "sinal" });
    expect(await db.prepare("SELECT 1 FROM notifications WHERE memberId = ?").get(bia.id)).toBeUndefined();
  });

  it("mútuo com um time: sai convite de time", async () => {
    const { ana, bia } = await par();
    await team(H, [ana]);
    await signalTeamUp(bia, { username: ana.username, hackathonId: H });
    const r = await signalTeamUp(ana, { username: bia.username, hackathonId: H });
    expect(r.mutual).toBe(true);
    expect(r.action).toBe("convite");
    const invite = await db
      .prepare("SELECT status FROM team_invites WHERE memberId = ? AND hackathonId = ?")
      .get<{ status: string }>(bia.id, H);
    expect(invite!.status).toBe("pending");
  });

  it("mútuo sem time nenhum: o time nasce comigo e o outro recebe convite", async () => {
    const { ana, bia } = await par();
    await signalTeamUp(bia, { username: ana.username, hackathonId: H });
    const r = await signalTeamUp(ana, { username: bia.username, hackathonId: H });
    expect(r.mutual).toBe(true);
    expect(r.action).toBe("time");
    const rows = await db
      .prepare("SELECT username FROM team_members WHERE teamId = ? ORDER BY username")
      .all<{ username: string }>(r.teamId!);
    // o time nasce com quem marcou por último; o outro entra pelo convite
    expect(rows.map((x) => x.username)).toEqual([ana.username]);
    const invite = await db
      .prepare("SELECT status FROM team_invites WHERE memberId = ? AND hackathonId = ?")
      .get<{ status: string }>(bia.id, H);
    expect(invite!.status).toBe("pending");
  });

  it("mútuo com os dois em times: fica a conexão e o outro lado é avisado", async () => {
    const { ana, bia } = await par();
    await team(H, [ana]);
    await team(H, [bia]);
    await signalTeamUp(bia, { username: ana.username, hackathonId: H });
    const r = await signalTeamUp(ana, { username: bia.username, hackathonId: H });
    expect(r).toMatchObject({ mutual: true, action: "conexao" });
    expect((await notifications(bia.id, "team_up")).length).toBe(1);
  });

  it("bloqueio → 404; sem inscrição aprovada → 403; a si mesmo → 400", async () => {
    const { ana, bia } = await par();
    await block(ana.id, bia.id);
    await expect(signalTeamUp(ana, { username: bia.username, hackathonId: H })).rejects.toMatchObject({ status: 404 });
    await expect(signalTeamUp(ana, { username: ana.username, hackathonId: H })).rejects.toMatchObject({ status: 400 });

    const caio = await member();
    await expect(signalTeamUp(caio, { username: ana.username, hackathonId: H })).rejects.toMatchObject({ status: 403 });
  });

  it("POST /api/team-up deslogado → 401 JSON", async () => {
    const { teamUp } = await routes();
    as(null);
    const res = await teamUp.POST(json("POST", { username: "alguem", hackathonId: H }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("lista, filtros e compatibilidade em frases", () => {
  it("filtra por edição, área, cidade e faculdade", async () => {
    const ana = await member({ city: "Sorocaba, SP", institution: "USP" });
    const bia = await member({ city: "Recife, PE", institution: "UFPE" });
    await register(ana);
    await register(bia);
    await team(H, [ana]);
    await team(H, [bia]);
    await createOpening(ana, { hackathonId: H, area: "design", intro: "procuro design" });
    await createOpening(bia, { hackathonId: H, area: "dev", intro: "procuro dev" });

    const design = await listOpenings({ hackathonId: H, area: "design" }, ana);
    expect(design).toHaveLength(1);
    expect(design[0].intro).toBe("procuro design");

    const sorocaba = await listOpenings({ hackathonId: H, cidade: "Sorocaba" }, ana);
    expect(sorocaba).toHaveLength(1);
    const usp = await listOpenings({ hackathonId: H, faculdade: "USP" }, ana);
    expect(usp).toHaveLength(1);
    expect(usp[0].intro).toBe("procuro design");

    const eds = await activityEditions();
    expect(eds.map((e) => e.id)).toContain(H);
    expect(await openAreasOfMyTeams(ana.username)).toEqual(["design"]);
  });

});

describe("moderação do board pelo organizador da edição", () => {
  it("organizador desativa anúncio (200); membro comum leva 403", async () => {
    const { board } = await routes();
    const org = await member();
    const comum = await member();
    const autor = await member();
    await register(org);
    await register(comum);
    await register(autor);
    await db.prepare(`INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')`).run(H, org.id);
    const entry = await db
      .prepare("INSERT INTO looking_for_team (memberId, hackathonId, need) VALUES (?, ?, 'procuro time') RETURNING id")
      .get<{ id: number }>(autor.id, H);

    as(comum);
    expect((await board.PATCH(json("PATCH", { entryId: entry!.id, active: false }), ctx(H))).status).toBe(403);

    as(org);
    const ok = await board.PATCH(json("PATCH", { entryId: entry!.id, active: false }), ctx(H));
    expect(ok.status).toBe(200);
    expect((await ok.json()).entry.active).toBe(false);
  });
});

describe("candidatura pela rota e resposta pela rota", () => {
  it("POST /api/openings/[id]/applications e PATCH …/[applicationId] funcionam com sessão", async () => {
    const { apply, respond } = await routes();
    const ana = await member();
    const bia = await member();
    await register(ana);
    await register(bia);
    await team(H, [ana]);
    const opening = await createOpening(ana, { hackathonId: H, area: "produto", intro: "procuro produto" });

    as(bia);
    const aplicou = await apply.POST(json("POST", { intro: "cuido do produto e do pitch" }), ctx(opening.id));
    expect(aplicou.status).toBe(201);
    const { applicationId } = await aplicou.json();

    as(ana);
    const aceitou = await respond.PATCH(json("PATCH", { action: "accept" }), ctx2(opening.id, applicationId));
    expect(aceitou.status).toBe(200);
    expect((await aceitou.json()).opening.applications[0].status).toBe("aceita");
  });

  it("convite a partir do card do board cria team_invites", async () => {
    const ana = await member();
    const bia = await member();
    await register(ana);
    await register(bia);
    await team(H, [ana]);
    as(ana);
    const res = await (
      await import("@/app/api/hackathons/[id]/team/invites/route")
    ).POST(json("POST", { usernames: [bia.username] }), ctx(H));
    expect(res.status).toBe(200);
    expect((await res.json()).invited).toEqual([bia.username]);
    const invite = await db
      .prepare("SELECT status FROM team_invites WHERE memberId = ? AND hackathonId = ?")
      .get<{ status: string }>(bia.id, H);
    expect(invite!.status).toBe("pending");
    expect((await getMemberByUsername(bia.username))!.username).toBe(bia.username);
  });
});
