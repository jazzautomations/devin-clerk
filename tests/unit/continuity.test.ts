import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { continuesOf, continuedAtFor, continuityCandidates, editionEnd, firstCommitAfter, previousProjects, runContinuity } from "@/lib/continuity";
import { toDbTime } from "@/lib/entries";
import { listProjects } from "@/lib/projects";

// Selo "continuou" e continuação entre edições (spec 046, onda 3, migration
// 044). O cron mensal re-coleta o dossiê (029) e grava continuedAt quando
// existe commit depois do fim da edição + 30 dias. O GitHub é um fetch falso:
// nenhum teste toca a rede.

const DAY = 86_400_000;
const now = new Date("2026-11-20T12:00:00Z");

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

/** GitHub falso: repo público com os commits pedidos */
function fakeGithub(commits: { sha: string; date: string; message?: string }[]): FetchImpl {
  return async (input) => {
    const url = new URL(input);
    if (/\/commits$/.test(url.pathname)) {
      return Response.json(
        commits.map((c) => ({
          sha: c.sha,
          commit: { author: { name: "Time", date: c.date }, message: c.message ?? "commit" },
          author: { login: "time" },
        })),
      );
    }
    return Response.json({
      full_name: "time/vivo",
      private: false,
      visibility: "public",
      fork: false,
      default_branch: "main",
      created_at: "2026-01-01T00:00:00Z",
      pushed_at: "2026-11-01T00:00:00Z",
    });
  };
}

const iso = (d: Date) => d.toISOString();

let edicaoVelha = "";
let edicaoRecente = "";

async function edition(id: string, name: string, endsAt: Date) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, 'Hack Inova', ?, ?, 'presencial', 'https://t.dev', '[]', 1, 'seed')
       ON CONFLICT (id) DO UPDATE SET endsAt = excluded.endsAt, startsAt = excluded.startsAt`,
    )
    .run(id, name, toDbTime(new Date(endsAt.getTime() - 2 * DAY)), toDbTime(endsAt));
}

async function team(hackathonId: string, name: string, repoUrl: string | null, members: string[]) {
  for (const u of members) {
    await db.prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)").run(`clerk_${u}`, u, `${u}@t.dev`);
  }
  const t = (await createTeam(hackathonId, { name, placement: 0, memberUsernames: members })).team.id;
  await db
    .prepare("INSERT INTO team_projects (teamId, title, repoUrl, technologies) VALUES (?, ?, ?, '[]')")
    .run(t, `Projeto ${name}`, repoUrl);
  return t;
}

beforeAll(async () => {
  // edição encerrada há 60 dias (dentro da janela de 30 a 400)
  const fimVelho = new Date(now.getTime() - 60 * DAY);
  edicaoVelha = "vivo-continuou-2026";
  await edition(edicaoVelha, "Vivo Continuou", fimVelho);
  // edição encerrada há 5 dias: ainda fora da janela
  edicaoRecente = "vivo-recente-2026";
  await edition(edicaoRecente, "Vivo Recente", new Date(now.getTime() - 5 * DAY));
});

beforeEach(async () => {
  // cada caso começa com as edições de teste limpas (time sem cascade no
  // projeto: apaga na ordem)
  for (const h of [edicaoVelha, edicaoRecente]) {
    await db.prepare("DELETE FROM project_dossiers WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(h);
    await db.prepare("DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(h);
    await db.prepare("DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(h);
    await db.prepare("DELETE FROM teams WHERE hackathonId = ?").run(h);
  }
});

describe("funções puras", () => {
  it("editionEnd usa endsAt e cai pro prazo de entrega", () => {
    expect(editionEnd({ endsAt: "2026-05-02" })?.toISOString()).toBe("2026-05-02T12:00:00.000Z");
    expect(editionEnd({ endsAt: null, submissionDeadline: "2026-06-01T18:00:00-03:00" })?.toISOString()).toBe(
      "2026-06-01T21:00:00.000Z",
    );
    expect(editionEnd({ endsAt: null, submissionDeadline: null })).toBeNull();
  });

  it("firstCommitAfter pega o MAIS ANTIGO depois da data, não o mais novo", () => {
    const commits = [
      { date: "2026-07-10 10:00:00" },
      { date: "2026-06-02 10:00:00" },
      { date: "2026-05-01 10:00:00" },
    ];
    expect(firstCommitAfter(commits, new Date("2026-06-01T00:00:00Z"))).toBe("2026-06-02 10:00:00");
    expect(firstCommitAfter(commits, new Date("2026-08-01T00:00:00Z"))).toBeNull();
    expect(firstCommitAfter([], new Date("2026-01-01T00:00:00Z"))).toBeNull();
  });

  it("continuedAtFor exige commit 30 dias depois do fim da edição", () => {
    const fim = new Date("2026-05-02T00:00:00Z");
    // 20 dias depois: ainda é a semana do evento, não é "continuou"
    expect(continuedAtFor([{ date: "2026-05-22 10:00:00" }], fim)).toBeNull();
    // 31 dias depois: continuação
    expect(continuedAtFor([{ date: "2026-06-02 10:00:00" }], fim)).toBe("2026-06-02 10:00:00");
  });
});

describe("continuityCandidates", () => {
  it("só edição encerrada há 30 a 400 dias, os mais antigos primeiro", async () => {
    const antigo = await team(edicaoVelha, "Time Antigo", "https://github.com/time/vivo", ["cv_ana"]);
    const recente = await team(edicaoRecente, "Time Recente", "https://github.com/time/novo", ["cv_bia"]);
    const semRepo = await team(edicaoVelha, "Time Sem Repo", null, ["cv_caio"]);
    const candidatos = await continuityCandidates(now);
    const ids = candidatos.map((c) => c.teamId);
    expect(ids).toContain(antigo);
    expect(ids).not.toContain(recente);
    expect(ids).not.toContain(semRepo);
    // limite por execução: os mais antigos primeiro
    expect((await continuityCandidates(now, 1)).length).toBeLessThanOrEqual(1);
  });
});

describe("runContinuity — cron com o dossiê mockado", () => {
  it("grava continuedAt com o primeiro commit depois da janela e o filtro ?continuou=1 acha", async () => {
    const t = await team(edicaoVelha, "Time Que Continuou", "https://github.com/time/vivo", ["cv_duda"]);
    const fim = (await db.prepare("SELECT endsAt FROM hackathons WHERE id = ?").get<{ endsAt: string }>(edicaoVelha))!.endsAt;
    const fimDate = new Date(`${fim.replace(" ", "T")}Z`);
    const run = await runContinuity({
      now,
      fetch: {
        fetchImpl: fakeGithub([
          // dentro do evento: não é continuação
          { sha: "aaaaaaa", date: iso(new Date(fimDate.getTime() - DAY)) },
          // 40 dias depois do fim: é o primeiro commit da continuação
          { sha: "bbbbbbb", date: iso(new Date(fimDate.getTime() + 40 * DAY)) },
          // mais novo, depois dele
          { sha: "ccccccc", date: iso(new Date(fimDate.getTime() + 45 * DAY)) },
        ]),
      },
    });
    expect(run.failed).toBe(0);
    expect(run.collected).toBeGreaterThan(0);
    expect(run.continued).toBe(1);

    const at = await db.prepare("SELECT continuedAt FROM team_projects WHERE teamId = ?").get<{ continuedAt: string }>(t);
    const esperado = toDbTime(new Date(fimDate.getTime() + 40 * DAY));
    expect(at!.continuedAt).toBe(esperado);

    const cards = await listProjects({ hackathonId: edicaoVelha });
    expect(cards.find((c) => c.teamId === t)?.continuedAt).toBe(esperado);
    expect((await listProjects({ hackathonId: edicaoVelha, continued: true })).map((c) => c.teamId)).toEqual([t]);
  });

  it("repositório sem commit depois da janela não ganha o selo", async () => {
    const t = await team(edicaoVelha, "Time Parado", "https://github.com/time/parado", ["cv_eva"]);
    const run = await runContinuity({
      now,
      fetch: {
        fetchImpl: fakeGithub([{ sha: "ddddddd", date: "2026-01-10T10:00:00Z" }]),
      },
    });
    expect(run.failed).toBe(0);
    const at = await db.prepare("SELECT continuedAt FROM team_projects WHERE teamId = ?").get<{ continuedAt: string | null }>(t);
    expect(at!.continuedAt).toBeNull();
    expect(run.continued).toBe(0);
  });

  it("coleta que falha não derruba o cron e não grava selo", async () => {
    const t = await team(edicaoVelha, "Time Sumido", "https://github.com/time/sumido", ["cv_fabi"]);
    const run = await runContinuity({
      now,
      fetch: { fetchImpl: async () => new Response("{}", { status: 404 }) },
    });
    expect(run.failed).toBeGreaterThan(0);
    const at = await db.prepare("SELECT continuedAt FROM team_projects WHERE teamId = ?").get<{ continuedAt: string | null }>(t);
    expect(at!.continuedAt).toBeNull();
  });
});

describe("continuação entre edições", () => {
  it("previousProjects lista só outra edição em que a pessoa fez parte", async () => {
    const velho = await team(edicaoVelha, "Time Anterior", "https://github.com/time/anterior", ["cv_gabi"]);
    await team(edicaoVelha, "Time de Outro", null, ["cv_hugo"]);
    const opcoes = await previousProjects("cv_gabi", edicaoRecente);
    expect(opcoes.map((p) => p.teamId)).toEqual([velho]);
    expect(opcoes[0].title).toBe("Projeto Time Anterior");
    // a mesma edição não aparece como opção
    expect(await previousProjects("cv_gabi", edicaoVelha)).toEqual([]);
    expect(await previousProjects("cv_ninguem", edicaoRecente)).toEqual([]);
  });

  it("continuesOf devolve o projeto anterior do link", async () => {
    const anterior = await team(edicaoVelha, "Time Base", null, ["cv_iris"]);
    const atual = await team(edicaoRecente, "Time Novo", null, ["cv_iris"]);
    await db.prepare("UPDATE team_projects SET continuesTeamId = ? WHERE teamId = ?").run(anterior, atual);
    expect(await continuesOf(atual)).toMatchObject({ teamId: anterior, hackathonId: edicaoVelha });
    expect(await continuesOf(anterior)).toBeNull();
  });
});
