import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { getEntry, saveDraft, showcaseDiffers, submitEntry, syncProjectTech, techSuggestions, toDbTime } from "@/lib/entries";
import { anonProjectNote, getProjectView, youtubeId } from "@/lib/entriesPublic";
import { listProjects, listTopTech } from "@/lib/projects";
import { deleteMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";
import { mergeStory, storyPayload, toStory } from "@/lib/showcaseDraft";

// Vitrine do projeto (spec 046, migration 036): história, capa, galeria e
// papel editáveis depois da trava; snapshot intacto e aviso de "atualizado
// depois da entrega"; "Feito com" vira índice project_tech (backfill na
// migration) e filtra /projetos; deslogado vê a página completa só quando o
// projeto já está no arquivo, e integrante fora do canNetwork vira
// "integrante".

let who: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: who })),
  currentUser: vi.fn(async () => null),
  clerkClient: async () => ({ users: { deleteUser: vi.fn(async () => ({})) } }),
}));

const H = "hack-inova-alphaville-2026";
const LEGADO = "vitrine-legado-2024";
const ctx = { params: Promise.resolve({ id: H }) };
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ids: Record<string, number> = {};
let teamId = 0;

const full = {
  title: "Feira Viva",
  tagline: "a feira do bairro no celular",
  description: "Mostra as barracas abertas agora.",
  priorWork: "nada",
  technologies: ["Next.js", "Postgres"],
  repoUrl: "https://github.com/t/feira",
};

async function member(u: string) {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(`clerk_${u}`, u, `${u}@t.dev`);
  ids[u] = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(u))!.id;
  await db
    .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
    .run(ids[u], H);
}

async function setDeadline(d: Date) {
  await db
    .prepare(
      "UPDATE hackathons SET submissionDeadline = ?, submissionGraceMinutes = 0, submissionOpensAt = NULL, entriesShowContent = 1 WHERE id = ?",
    )
    .run(toDbTime(d), H);
}

async function route() {
  return import("@/app/api/hackathons/[id]/entry/route");
}

beforeAll(async () => {
  for (const u of ["vt_ana", "vt_bia", "vt_fora"]) await member(u);
  teamId = (await createTeam(H, { name: "Time Vitrine", placement: 0, memberUsernames: ["vt_ana", "vt_bia"] })).team.id;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'Vitrine Legado', 'Hack Inova', '2024-05-01', '2024-05-02', 'presencial', 'https://t.dev', '[]', 1, 'seed')
       ON CONFLICT (id) DO NOTHING`,
    )
    .run(LEGADO);
});

beforeEach(async () => {
  resetRateLimits();
  await setDeadline(new Date(Date.now() + 3_600_000));
});

describe("migration 036 — backfill de project_tech", () => {
  it("projeto antigo com technologies aparece em /projetos?tech= depois da migration", async () => {
    const t = (await createTeam(LEGADO, { name: "Time Antigo", placement: 1, project: { title: "Mapa Antigo" } })).team.id;
    const quebrado = (await createTeam(LEGADO, { name: "Time Quebrado", placement: 0, project: { title: "JSON ruim" } })).team.id;
    await db
      .prepare("UPDATE team_projects SET technologies = ? WHERE teamId = ?")
      .run(JSON.stringify(["Next.js", " Postgres ", "React.js", "WhatsApp API", "!!!"]), t);
    await db.prepare("UPDATE team_projects SET technologies = 'não é json' WHERE teamId = ?").run(quebrado);
    await db.prepare("DELETE FROM project_tech WHERE teamId IN (?, ?)").run(t, quebrado);

    const sql = readFileSync(join(process.cwd(), "migrations/036_vitrine_projeto.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql); // idempotente

    const tags = (
      await db.prepare("SELECT tag FROM project_tech WHERE teamId = ? ORDER BY tag").all<{ tag: string }>(t)
    ).map((r) => r.tag);
    expect(tags).toEqual(["nextjs", "postgresql", "react", "whatsapp-api"]);
    expect(await db.prepare("SELECT 1 FROM project_tech WHERE teamId = ?").get(quebrado)).toBeUndefined();

    const found = (await listProjects({ tech: "nextjs" })).map((c) => c.teamId);
    expect(found).toContain(t);
    // o filtro aceita o apelido e normaliza
    expect((await listProjects({ tech: "Next.js" })).map((c) => c.teamId)).toContain(t);
    expect((await listProjects({ tech: "rust" })).map((c) => c.teamId)).not.toContain(t);
    expect((await listProjects({ tech: "!!!" })).map((c) => c.teamId)).toEqual([]);
    const card = (await listProjects({ tech: "react" })).find((c) => c.teamId === t)!;
    expect(card.tech.map((x) => x.tag)).toEqual(["nextjs", "postgresql", "react"]);
    expect((await listTopTech()).some((x) => x.tag === "nextjs" && x.count >= 1)).toBe(true);
  });
});

describe("vitrine — PATCH /api/hackathons/[id]/entry", () => {
  it("401 deslogado pros campos novos", async () => {
    who = null;
    const r = await route();
    const res = await r.PATCH(req("PATCH", { inspiration: "x" }), ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("time preenche história e tags; a 13ª tag é ignorada e /projetos?tech=nextjs acha depois da trava", async () => {
    who = "clerk_vt_ana";
    const r = await route();
    const techs = ["Next.js", "nextjs", ...Array.from({ length: 12 }, (_, i) => `lib${i}`)];
    const res = await r.PATCH(
      req("PATCH", {
        ...full,
        technologies: techs,
        inspiration: "a feira some do mapa toda semana",
        howBuilt: "Next.js no front, Postgres no banco",
        challenges: "GPS dentro da feira",
        learned: "falar com feirante antes de codar",
        coverUrl: "https://img.dev/capa.png",
        media: [
          { url: "https://img.dev/1.png", caption: "tela inicial" },
          { url: "", caption: "linha vazia some" },
          { url: "https://img.dev/2.png" },
        ],
        role: "front e pitch",
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const { entry } = await res.json();
    expect(entry.fields.technologies).toHaveLength(12);
    expect(entry.fields.technologies[0]).toBe("Next.js");
    expect(entry.fields.technologies).not.toContain("lib11");
    expect(entry.showcase).toMatchObject({
      inspiration: "a feira some do mapa toda semana",
      coverUrl: "https://img.dev/capa.png",
      media: [
        { url: "https://img.dev/1.png", caption: "tela inicial" },
        { url: "https://img.dev/2.png", caption: null },
      ],
    });
    expect(entry.roles).toEqual({ vt_ana: "front e pitch", vt_bia: null });
    const tags = (
      await db.prepare("SELECT tag FROM project_tech WHERE teamId = ? ORDER BY tag").all<{ tag: string }>(teamId)
    ).map((x) => x.tag);
    expect(tags).toHaveLength(12);
    expect(tags).toContain("nextjs");

    // envia e passa da trava: aí entra no índice público
    const sent = await r.POST(req("POST"), ctx);
    expect(sent.status).toBe(201);
    await setDeadline(new Date(Date.now() - 60_000));
    expect((await listProjects({ tech: "nextjs" })).map((c) => c.teamId)).toContain(teamId);
  });

  it("papel é só o de quem salva", async () => {
    who = "clerk_vt_bia";
    const r = await route();
    const res = await r.PATCH(req("PATCH", { role: "back-end" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).entry.roles).toEqual({ vt_ana: "front e pitch", vt_bia: "back-end" });
  });

  it("validações: http na galeria e na capa, 7 imagens, texto longo e papel longo dão 400", async () => {
    who = "clerk_vt_ana";
    const r = await route();
    const bad: Record<string, unknown>[] = [
      { media: [{ url: "http://img.dev/1.png" }] },
      { media: [{ url: "javascript:alert(1)" }] },
      { media: "https://img.dev/1.png" },
      { media: Array.from({ length: 7 }, (_, i) => ({ url: `https://img.dev/${i}.png` })) },
      { media: [{ url: "https://img.dev/1.png", caption: "x".repeat(141) }] },
      { coverUrl: "http://img.dev/capa.png" },
      { inspiration: "x".repeat(2001) },
      { learned: 42 },
      { role: "x".repeat(81) },
      { technologies: "Next.js" },
      { technologies: ["x".repeat(41)] },
      // lista enorme é recusada antes de ser percorrida
      { technologies: Array.from({ length: 51 }, () => "!!!") },
      { technologies: Array.from({ length: 200_000 }, () => "!!!") },
    ];
    for (const body of bad) {
      const res = await r.PATCH(req("PATCH", body), ctx);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    const fifty = await r.PATCH(req("PATCH", { technologies: [...full.technologies, ...Array.from({ length: 48 }, () => "!!!")] }), ctx);
    expect(fifty.status).toBe(200);
    expect((await fifty.json()).entry.fields.technologies).toEqual(full.technologies);
    const ok = await r.PATCH(req("PATCH", { media: [], coverUrl: "", inspiration: "x".repeat(2000) }), ctx);
    expect(ok.status).toBe(200);
    expect((await ok.json()).entry.showcase).toMatchObject({ media: [], coverUrl: null });
  });

  it("quem não é do time não mexe na vitrine", async () => {
    who = "clerk_vt_fora";
    const r = await route();
    expect((await r.PATCH(req("PATCH", { inspiration: "invasão" }), ctx)).status).toBe(404);
  });
});

describe("vitrine depois da trava", () => {
  let before = "";

  it("snapshot da entrega leva os campos novos", async () => {
    who = "clerk_vt_ana";
    const r = await route();
    await r.PATCH(
      req("PATCH", {
        inspiration: "versão entregue",
        media: [{ url: "https://img.dev/1.png", caption: "tela" }],
        coverUrl: "https://img.dev/capa.png",
      }),
      ctx,
    );
    expect((await r.POST(req("POST"), ctx)).status).toBe(201);
    const row = await db
      .prepare("SELECT snapshot FROM project_submissions WHERE teamId = ? ORDER BY version DESC LIMIT 1")
      .get<{ snapshot: string }>(teamId);
    before = row!.snapshot;
    const snap = JSON.parse(before);
    expect(snap).toMatchObject({
      inspiration: "versão entregue",
      coverUrl: "https://img.dev/capa.png",
      media: [{ url: "https://img.dev/1.png", caption: "tela" }],
      roles: { vt_ana: "front e pitch", vt_bia: "back-end" },
    });
  });

  it("história, galeria, capa e papel seguem editáveis; campo avaliado 403; snapshot intacto e a página avisa", async () => {
    await setDeadline(new Date(Date.now() - 60_000));
    who = "clerk_vt_ana";
    const r = await route();
    expect((await r.PATCH(req("PATCH", { tagline: "tarde demais" }), ctx)).status).toBe(403);
    expect((await r.PATCH(req("PATCH", { technologies: ["Rust"] }), ctx)).status).toBe(403);
    expect((await r.PATCH(req("PATCH", { inspiration: "contada com calma", technologies: ["Rust"] }), ctx)).status).toBe(403);
    // sem mudança ainda: nada de aviso
    expect((await getProjectView(teamId, null))!.updatedAfterDelivery).toBe(false);

    const res = await r.PATCH(
      req("PATCH", {
        inspiration: "contada com calma",
        howBuilt: "três noites",
        media: [
          { url: "https://img.dev/2.png", caption: "nova" },
          { url: "https://img.dev/1.png", caption: "tela" },
        ],
        coverUrl: "https://img.dev/capa2.png",
        role: "front, pitch e café",
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const after = await db
      .prepare("SELECT snapshot FROM project_submissions WHERE teamId = ? ORDER BY version DESC LIMIT 1")
      .get<{ snapshot: string }>(teamId);
    expect(after!.snapshot).toBe(before);

    const view = (await getProjectView(teamId, null))!;
    expect(view.updatedAfterDelivery).toBe(true);
    expect(view.showcase?.inspiration).toBe("contada com calma");
    expect(view.showcase?.media.map((m) => m.url)).toEqual(["https://img.dev/2.png", "https://img.dev/1.png"]);
    expect(view.delivered?.inspiration).toBe("versão entregue");
    const ana = view.credits.find((c) => c.username === "vt_ana")!;
    expect(ana).toMatchObject({ role: "front, pitch e café", deliveredRole: "front e pitch" });
  });

  it("deslogado vê a página completa depois da trava; antes do prazo, não", async () => {
    await setDeadline(new Date(Date.now() - 60_000));
    const open = (await getProjectView(teamId, null))!;
    expect(open.openToPublic).toBe(true);
    expect(open.showContent).toBe(true);
    expect(open.tech[0]).toEqual({ tag: "nextjs", label: "Next.js" });

    await setDeadline(new Date(Date.now() + 3_600_000));
    const closed = (await getProjectView(teamId, null))!;
    expect(closed.openToPublic).toBe(false);
    expect(closed.showcase).toBeNull();
    expect(closed.updatedAfterDelivery).toBe(false);
    // papel é texto da vitrine: antes da trava, quem é de fora não vê
    const outsider = (await getProjectView(teamId, { id: ids.vt_fora, username: "vt_fora", role: "member" }))!;
    expect(outsider.showContent).toBe(false);
    expect(outsider.credits.map((c) => [c.role, c.deliveredRole])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(anonProjectNote(outsider)).toBe("O projeto entregue aparece aqui quando a edição publica as entregas.");
    // quem é do time vê o próprio rascunho com os papéis
    const inside = (await getProjectView(teamId, { id: ids.vt_ana, username: "vt_ana", role: "member" }))!;
    expect(inside.credits.find((c) => c.username === "vt_ana")?.role).toBe("front, pitch e café");
  });

  it("edição que esconde o conteúdo depois do prazo não abre pra deslogado", async () => {
    await setDeadline(new Date(Date.now() - 60_000));
    await db.prepare("UPDATE hackathons SET entriesShowContent = 0 WHERE id = ?").run(H);
    expect((await getProjectView(teamId, null))!.openToPublic).toBe(false);
  });

  it("integrante com canNetwork falso aparece só como integrante", async () => {
    await setDeadline(new Date(Date.now() - 60_000));
    await db.prepare("UPDATE members SET clerkId = 'deleted:vt' WHERE username = 'vt_bia'").run();
    const view = (await getProjectView(teamId, null))!;
    const hidden = view.credits.filter((c) => c.username === null);
    expect(hidden).toEqual([{ username: null, name: null, avatarUrl: null, role: null, deliveredRole: null }]);
    expect(view.credits.some((c) => c.username === "vt_ana")).toBe(true);
    await db.prepare("UPDATE members SET clerkId = 'clerk_vt_bia' WHERE username = 'vt_bia'").run();
  });
});

describe("helpers da vitrine", () => {
  it("youtubeId só aceita id de 11 caracteres de domínio do YouTube", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/curto")).toBeNull();
    expect(youtubeId("https://evil.dev/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXc\"><")).toBeNull();
    expect(youtubeId("javascript:alert(1)")).toBeNull();
    expect(youtubeId(null)).toBeNull();
  });

  it("showcaseDiffers ignora papel vazio × ausente e pega mudança de ordem da galeria", () => {
    const base = {
      inspiration: "a",
      howBuilt: null,
      challenges: null,
      learned: null,
      coverUrl: null,
      media: [
        { url: "https://a", caption: null },
        { url: "https://b", caption: null },
      ],
      roles: { ana: "front", bia: null },
    };
    expect(showcaseDiffers(base, { ...base, roles: { ana: "front" } })).toBe(false);
    expect(showcaseDiffers(base, { ...base, media: [...base.media].reverse() })).toBe(true);
    expect(showcaseDiffers(base, { ...base, inspiration: "b" })).toBe(true);
  });

  it("anonProjectNote só promete abrir o que ainda pode abrir", () => {
    expect(anonProjectNote({ status: "nao_entregue", showContent: false })).toBe("Este time não entregou projeto nesta edição.");
    expect(anonProjectNote({ status: "travado", showContent: true })).toBe("O projeto completo fica pra quem tem conta.");
    expect(anonProjectNote({ status: "travado", showContent: false })).toBe(
      "O projeto entregue aparece aqui quando a edição publica as entregas.",
    );
  });

  it("rascunho da vitrine: autosave manda só o que mudou e o resto vem do servidor", () => {
    const opened = toStory(null, null);
    const typed = { ...opened, role: "back-end" };
    expect(storyPayload(typed, ["role"], true)).toEqual({ role: "back-end" });
    expect(storyPayload({ ...typed, inspiration: "x" }, ["inspiration"], false)).toEqual({});
    expect(
      storyPayload({ ...opened, media: [{ url: " https://a.dev/1.png ", caption: "" }, { url: "", caption: "vazia" }] }, ["media"], true),
    ).toEqual({ media: [{ url: "https://a.dev/1.png", caption: "" }] });
    const server = toStory(
      { inspiration: "da Ana", howBuilt: null, challenges: "GPS", learned: null, coverUrl: null, media: [{ url: "https://a.dev/2.png", caption: null }] },
      "back-end",
    );
    const merged = mergeStory({ ...typed, learned: "digitando" }, server, new Set(["role", "learned"]));
    expect(merged).toMatchObject({ inspiration: "da Ana", challenges: "GPS", learned: "digitando", role: "back-end" });
    expect(merged.media).toEqual([{ url: "https://a.dev/2.png", caption: "" }]);
  });

  it("syncProjectTech reescreve o índice a partir de technologies; sugestão só com 2 times", async () => {
    await db.prepare("UPDATE team_projects SET technologies = ? WHERE teamId = ?").run(JSON.stringify(["Go", "golang", "Elixir"]), teamId);
    expect(await syncProjectTech(teamId)).toEqual(["go", "elixir"]);
    const sug = await techSuggestions();
    expect(sug).not.toContain("elixir"); // um time só usa
    expect(sug).toContain("nextjs"); // lista conhecida
  });

  it("exclusão de conta apaga o papel junto com o @", async () => {
    // edição passada: a linha do time fica, anonimizada
    await member("vt_velho");
    await db
      .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
      .run(ids.vt_velho, LEGADO);
    const old = (await createTeam(LEGADO, { name: "Time Velho", placement: 0, memberUsernames: ["vt_velho", "vt_ana"] })).team.id;
    await db.prepare("UPDATE team_members SET role = 'back-end' WHERE teamId = ?").run(old);
    await deleteMemberData(ids.vt_velho);
    const rows = await db
      .prepare("SELECT username, role FROM team_members WHERE teamId = ? ORDER BY username")
      .all<{ username: string; role: string | null }>(old);
    expect(rows).toEqual([
      { username: `removido-${ids.vt_velho}`, role: null },
      { username: "vt_ana", role: "back-end" },
    ]);
    expect((await getEntry(teamId))!.roles.vt_ana).toBe("front, pitch e café");
  });

  it("exclusão de conta tira o papel do snapshot entregue e não acende o aviso de atualização", async () => {
    await member("vt_cris");
    await member("vt_duda");
    const t = (await createTeam(H, { name: "Time Snapshot", placement: 0, memberUsernames: ["vt_cris", "vt_duda"] })).team.id;
    await setDeadline(new Date(Date.now() + 3_600_000));
    await saveDraft(t, { username: "vt_cris" }, { ...full, title: "Mapa Snapshot", role: "dados" });
    await saveDraft(t, { username: "vt_duda" }, { role: "design" });
    await submitEntry(t, { id: ids.vt_cris, username: "vt_cris" });
    await setDeadline(new Date(Date.now() - 60_000));
    expect((await getProjectView(t, null))!.updatedAfterDelivery).toBe(false);

    await deleteMemberData(ids.vt_cris);
    const snap = JSON.parse(
      (await db.prepare("SELECT snapshot FROM project_submissions WHERE teamId = ?").get<{ snapshot: string }>(t))!.snapshot,
    );
    expect(snap.roles).toEqual({ vt_duda: "design" });
    expect(snap.title).toBe("Mapa Snapshot");
    expect(JSON.stringify(snap)).not.toContain("dados");
    expect((await getProjectView(t, null))!.updatedAfterDelivery).toBe(false);
    // snapshot de outro time não muda
    const other = await db.prepare("SELECT snapshot FROM project_submissions WHERE teamId = ? ORDER BY version DESC LIMIT 1").get<{ snapshot: string }>(teamId);
    expect(JSON.parse(other!.snapshot).roles).toEqual({ vt_ana: "front e pitch", vt_bia: "back-end" });
  });
});
