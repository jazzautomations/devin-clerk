import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import "@/lib/deploys"; // garante a tabela deploys no :memory:
import { createTeam } from "@/lib/archive";
import { searchHackathons } from "@/lib/hackathons";
import { listLeaderboard } from "@/lib/members";
import { listProjects } from "@/lib/projects";

// spec 023 — ?q= server-side nas três listas públicas + escape de curingas LIKE

const FUTURE = "2099-01-01T09:00:00-03:00";

async function makeHackathon(
  id: string,
  fields: {
    name: string;
    location?: string | null;
    tags?: string[];
    format?: string;
    startsAt?: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO hackathons
       (id, name, organizer, startsAt, format, location, registrationUrl, tags, active)
     VALUES (?, ?, 'Org', ?, ?, ?, 'https://x.dev', ?, 1)`,
  ).run(
    id,
    fields.name,
    fields.startsAt ?? FUTURE,
    fields.format ?? "online",
    fields.location ?? null,
    JSON.stringify(fields.tags ?? []),
  );
}

async function makeMember(
  username: string,
  extra: { name?: string; headline?: string; skills?: string[]; xp?: number } = {},
): Promise<void> {
  await db.prepare(
    `INSERT INTO members (clerkId, username, email, name, headline, skills, xp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `c_${username}`,
    username,
    `${username}@t.dev`,
    extra.name ?? null,
    extra.headline ?? null,
    JSON.stringify(extra.skills ?? []),
    extra.xp ?? 0,
  );
}

beforeEach(async () => {
  await db.exec("DELETE FROM deploys");
  await db.exec("DELETE FROM team_members");
  await db.exec("DELETE FROM team_projects");
  await db.exec("DELETE FROM teams");
  await db.exec("DELETE FROM members");
  await db.exec(
    "DELETE FROM hackathons WHERE id LIKE 'search-%' OR id LIKE 'pct-%'",
  );
});

describe("searchHackathons — ?q= do radar", () => {
  it("filtra por nome, case-insensitive, só abertos (spec 027)", async () => {
    await makeHackathon("search-saude", {
      name: "Hackathon Saúde RJ",
      location: "Rio de Janeiro",
      tags: ["saude"],
    });
    await makeHackathon("search-rust", { name: "Rust Game Jam", tags: ["rust"] });

    const hits = (await searchHackathons("SAÚDE".toLowerCase())).map((h) => h.id);
    expect(hits).toContain("search-saude");
    expect(hits).not.toContain("search-rust");
    // edição passada do seed não entra nem com match de nome
    expect(await searchHackathons("unifacens")).toEqual([]);
  });

  it("filtra por local e por tag", async () => {
    await makeHackathon("search-fort", {
      name: "Hackathon STS",
      location: "Fortaleza, CE",
      tags: ["inovacao"],
    });
    expect((await searchHackathons("fortaleza")).map((h) => h.id)).toContain(
      "search-fort",
    );
    expect((await searchHackathons("inovacao")).map((h) => h.id)).toContain(
      "search-fort",
    );
    // tag do seed: alphaville tem "comunidade"
    expect((await searchHackathons("comunidade")).map((h) => h.id)).toContain(
      "hack-inova-alphaville-2026",
    );
  });

  it("q vazio/só espaços não filtra nada; sem match retorna []", async () => {
    await makeHackathon("search-x", { name: "X" });
    const all = (await searchHackathons("")).map((h) => h.id);
    expect(all).toContain("search-x");
    expect(all).toContain("hack-inova-alphaville-2026");
    expect((await searchHackathons("   ")).map((h) => h.id)).toEqual(all);
    expect(await searchHackathons("zzz-nada-a-ver")).toEqual([]);
  });
});

describe("listLeaderboard — ?q= de membros", () => {
  it("filtra por username, name, headline e skills", async () => {
    await makeMember("ana_dev", { name: "Ana Dev" });
    await makeMember("bia_ops", { name: "Bia Ops" });
    await makeMember("caio_data", {
      headline: "engenheiro de dados",
      skills: ["python"],
    });
    await makeMember("duda_wasm", { skills: ["rust", "wasm"] });

    const q = async (s: string) => (await listLeaderboard("xp", 100, s)).map((m) => m.username);
    expect(await q("ana_dev")).toEqual(["ana_dev"]);
    expect(await q("Ana Dev")).toEqual(["ana_dev"]); // name, case-insensitive
    expect(await q("dados")).toEqual(["caio_data"]); // headline
    expect(await q("RUST")).toEqual(["duda_wasm"]); // skills
    expect(await q("zzz")).toEqual([]);
  });

  it("q vazio/só espaços equivale a sem busca", async () => {
    await makeMember("full_a");
    await makeMember("full_b");
    expect(await listLeaderboard("xp", 100, "")).toHaveLength(2);
    expect(await listLeaderboard("xp", 100, "   ")).toHaveLength(2);
  });

  it("curinga LIKE é literal: % e _ não viram coringa", async () => {
    await makeMember("pct_real", { name: "100% aproveitamento" });
    await makeMember("pct_fake", { name: "1000 commits" });
    await makeMember("u_a_b", { name: "Literal" });
    await makeMember("u_axb", { name: "Quase" });

    // "100%" escapado casa só o literal, não "1000…"
    const pct = (await listLeaderboard("xp", 100, "100%")).map((m) => m.username);
    expect(pct).toEqual(["pct_real"]);
    // "a_b" escapado não casa "axb"
    const usc = (await listLeaderboard("xp", 100, "a_b")).map((m) => m.username);
    expect(usc).toEqual(["u_a_b"]);
  });
});

describe("listProjects — ?q= do índice", () => {
  const UNIFACENS = "hack-inova-unifacens-2026";
  const PUC = "hack-inova-puc-saude-2026";

  it("filtra por título, descrição e nome do time", async () => {
    await createTeam(UNIFACENS, {
      name: "Fogueteiros",
      placement: 1,
      project: { title: "One Day Hospital", description: "triage por IA" },
    });
    await createTeam(UNIFACENS, {
      name: "Blogueiros",
      placement: 0,
      project: { title: "Blog Estático", description: "rastreio de vacinas" },
    });

    const q = async (s: string) => (await listProjects({ q: s })).map((c) => c.teamName);
    expect(await q("hospital")).toEqual(["Fogueteiros"]); // título
    expect(await q("VACINA")).toEqual(["Blogueiros"]); // descrição, case-insensitive
    expect(await q("fogueteiro")).toEqual(["Fogueteiros"]); // nome do time
    expect(await q("zzz")).toEqual([]);
  });

  it("combina com hackathonId e liveOnly", async () => {
    await createTeam(UNIFACENS, {
      name: "U",
      placement: 0,
      project: { title: "app alpha" },
    });
    await createTeam(PUC, {
      name: "P",
      placement: 0,
      project: { title: "app alpha 2" },
    });

    expect(
      (await listProjects({ hackathonId: PUC, q: "alpha" })).map((c) => c.teamName),
    ).toEqual(["P"]);
    expect(await listProjects({ hackathonId: PUC, q: "zzz" })).toEqual([]);
    expect(await listProjects({ q: "alpha", liveOnly: true })).toEqual([]);
  });

  it("curinga LIKE é literal", async () => {
    await createTeam(UNIFACENS, {
      name: "Cov",
      placement: 0,
      project: { title: "100% coverage" },
    });
    await createTeam(UNIFACENS, {
      name: "Linhas",
      placement: 0,
      project: { title: "1000 linhas" },
    });
    const hits = (await listProjects({ q: "100%" })).map((c) => c.teamName);
    expect(hits).toEqual(["Cov"]);
  });
});
