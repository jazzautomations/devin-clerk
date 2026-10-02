import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  getHackathon,
  getOpenHackathons,
  getPastHackathons,
  isOver,
  searchHackathons,
} from "@/lib/hackathons";
import { getStatsMomentum } from "@/lib/momentum";

// spec 027 — "aberto" = não encerrado: a fronteira do radar é
// COALESCE(endsAt, registrationDeadline, startsAt) < now. Evento cuja
// janela já abriu (Devpost: startsAt = abertura da submissão) continua
// no radar enquanto roda — foi o bug que escondia 43 eventos (25 c/ prêmio).

const NOW = new Date("2026-10-02T12:00:00Z");

function makeHackathon(
  id: string,
  fields: {
    name?: string;
    startsAt?: string;
    endsAt?: string | null;
    registrationDeadline?: string | null;
    active?: boolean;
    firstSeen?: string | null;
  } = {},
): void {
  db.prepare(
    `INSERT OR REPLACE INTO hackathons
       (id, name, organizer, startsAt, endsAt, format, registrationUrl,
        registrationDeadline, tags, active, first_seen)
     VALUES (?, ?, 'Org', ?, ?, 'online', 'https://x.dev', ?, '[]', ?, ?)`,
  ).run(
    id,
    fields.name ?? id,
    fields.startsAt ?? "2026-11-14T09:00:00-03:00",
    fields.endsAt ?? null,
    fields.registrationDeadline ?? null,
    (fields.active ?? true) ? 1 : 0,
    fields.firstSeen ?? null,
  );
}

function makeMember(username: string, createdAt: string): number {
  db.prepare(
    "INSERT INTO members (clerkId, username, email, createdAt) VALUES (?, ?, ?, ?)",
  ).run(`c_${username}`, username, `${username}@t.dev`, createdAt);
  return (db.prepare("SELECT id FROM members WHERE username = ?").get(username) as {
    id: number;
  }).id;
}

beforeEach(() => {
  db.exec("DELETE FROM hackathons WHERE id LIKE 'ro-%'");
  db.exec("DELETE FROM posts");
  db.exec("DELETE FROM members");
});

describe("isOver — fronteira COALESCE(endsAt, registrationDeadline, startsAt)", () => {
  it("endsAt futuro mantém aberto mesmo com startsAt passado (ongoing)", () => {
    makeHackathon("ro-running", {
      startsAt: "2026-09-20T09:00:00Z",
      endsAt: "2026-10-05T18:00:00Z",
    });
    const h = getOpenHackathons(NOW).find((x) => x.id === "ro-running");
    expect(h).toBeDefined();
    expect(isOver(h!, NOW)).toBe(false);
  });

  it("endsAt passado encerra, mesmo com deadline futuro (endsAt vence)", () => {
    makeHackathon("ro-ended", {
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: "2026-09-20T18:00:00Z",
      registrationDeadline: "2026-10-10T00:00:00Z",
    });
    expect(isOver(getHackathon("ro-ended")!, NOW)).toBe(true);
  });

  it("sem endsAt, registrationDeadline futuro segura o evento", () => {
    makeHackathon("ro-deadline", {
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: null,
      registrationDeadline: "2026-10-10T00:00:00Z",
    });
    expect(isOver(getHackathon("ro-deadline")!, NOW)).toBe(false);
  });

  it("sem endsAt nem deadline, startsAt passado é tudo que sabemos → encerrado", () => {
    makeHackathon("ro-noend", {
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: null,
      registrationDeadline: null,
    });
    expect(isOver(getHackathon("ro-noend")!, NOW)).toBe(true);
  });

  it("fronteira: endsAt == now ainda está aberto (over é < estrito)", () => {
    makeHackathon("ro-edge", {
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: NOW.toISOString(),
    });
    expect(isOver(getHackathon("ro-edge")!, NOW)).toBe(false);
  });
});

describe("getOpenHackathons / getPastHackathons — listas complementares", () => {
  it("inclui ongoing e futuro, exclui encerrado e inativo", () => {
    makeHackathon("ro-ongoing", {
      startsAt: "2026-09-28T09:00:00Z",
      endsAt: "2026-10-04T18:00:00Z",
    });
    makeHackathon("ro-future", { startsAt: "2026-10-10T09:00:00Z" });
    makeHackathon("ro-over", {
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: "2026-09-02T18:00:00Z",
    });
    makeHackathon("ro-inactive", {
      startsAt: "2026-10-10T09:00:00Z",
      active: false,
    });

    const ids = getOpenHackathons(NOW).map((h) => h.id);
    expect(ids).toContain("ro-ongoing");
    expect(ids).toContain("ro-future");
    expect(ids).toContain("hack-inova-alphaville-2026"); // seed futuro
    expect(ids).not.toContain("ro-over");
    expect(ids).not.toContain("ro-inactive");
    expect(ids).not.toContain("hack-inova-unifacens-2026"); // seed encerrado
  });

  it("ordena por startsAt asc — ongoing encabeça, futuros depois", () => {
    makeHackathon("ro-ongoing", {
      startsAt: "2026-09-28T09:00:00Z",
      endsAt: "2026-10-04T18:00:00Z",
    });
    makeHackathon("ro-future", { startsAt: "2026-10-10T09:00:00Z" });
    const ids = getOpenHackathons(NOW).map((h) => h.id);
    expect(ids.indexOf("ro-ongoing")).toBeLessThan(
      ids.indexOf("ro-future"),
    );
  });

  it("arquivo = complemento exato: ongoing fora, encerrado dentro", () => {
    makeHackathon("ro-ongoing", {
      startsAt: "2026-09-28T09:00:00Z",
      endsAt: "2026-10-04T18:00:00Z",
    });
    const past = getPastHackathons(NOW).map((h) => h.id);
    expect(past).not.toContain("ro-ongoing");
    expect(past).toContain("hack-inova-unifacens-2026"); // edição real acabou
  });
});

describe("searchHackathons — busca opera sobre a lista aberta", () => {
  it("acha ongoing pelo nome; encerrado não aparece nem com match", () => {
    makeHackathon("ro-ongoing", {
      name: "Hackathon Rodando Agora",
      startsAt: "2026-09-28T09:00:00Z",
      endsAt: "2026-10-04T18:00:00Z",
    });
    makeHackathon("ro-over", {
      name: "Hackathon Rodando Agora Antigo",
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: "2026-09-02T18:00:00Z",
    });
    const hits = searchHackathons("rodando agora", NOW).map((h) => h.id);
    expect(hits).toEqual(["ro-ongoing"]);
  });
});

describe("getStatsMomentum — '+N · 30d' só com timestamp real", () => {
  it("conta membros e posts criados na janela; fora dela não conta", () => {
    const ana = makeMember("ro_ana", "2026-09-20T10:00:00Z"); // dentro dos 30d
    makeMember("ro_bia", "2026-10-02T08:00:00Z");
    makeMember("ro_caio", "2026-01-01T00:00:00Z"); // antigo, fora
    db.prepare("INSERT INTO posts (memberId, body, createdAt) VALUES (?, 'x', ?)").run(
      ana,
      "2026-09-30T10:00:00Z",
    );
    const m = getStatsMomentum(NOW);
    expect(m.members).toBe(2);
    expect(m.posts).toBe(1);
  });

  it("eventos: só first_seen na janela E ainda aberto; NULL nunca conta", () => {
    makeHackathon("ro-new", {
      startsAt: "2026-09-28T09:00:00Z",
      endsAt: "2026-10-04T18:00:00Z",
      firstSeen: "2026-09-30T00:00:00Z",
    });
    makeHackathon("ro-old", {
      startsAt: "2026-10-10T09:00:00Z",
      firstSeen: "2026-01-01T00:00:00Z", // entrou faz tempo
    });
    makeHackathon("ro-expired", {
      startsAt: "2026-09-01T09:00:00Z",
      endsAt: "2026-09-02T18:00:00Z",
      firstSeen: "2026-09-30T00:00:00Z", // descoberto na janela mas já acabou
    });
    // seeds (alphaville) não têm first_seen → fora da conta
    const m = getStatsMomentum(NOW);
    expect(m.events).toBe(1);
  });

  it("banco limpo → zeros honestos", () => {
    const m = getStatsMomentum(NOW);
    expect(m).toEqual({ members: 0, posts: 0, events: 0 });
  });
});
