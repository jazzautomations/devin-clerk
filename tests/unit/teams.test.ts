import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getArchive } from "@/lib/archive";
import {
  memberTeamFor,
  submitTeam,
  TeamError,
  updateTeamProject,
} from "@/lib/teams";

const HID = "hack-inova-alphaville-2026"; // edição futura ativa (seed)

function makeMember(username: string): { id: number; username: string } {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${username}`, username, `${username}@t.dev`);
  return db
    .prepare("SELECT id, username FROM members WHERE username = ?")
    .get(username) as { id: number; username: string };
}

function register(memberId: number, hid = HID) {
  db.prepare(
    "INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)",
  ).run(memberId, hid);
}

const status = (e: unknown) => (e instanceof TeamError ? e.status : null);

beforeEach(() => {
  db.prepare("DELETE FROM team_members").run();
  db.prepare("DELETE FROM team_projects").run();
  db.prepare("DELETE FROM teams").run();
});

describe("memberTeamFor", () => {
  it("retorna o time do membro na edição; null quando não tem", () => {
    const m = makeMember("solo_dev");
    register(m.id);
    expect(memberTeamFor(HID, "solo_dev")).toBeNull();

    const { team } = submitTeam(HID, m, { name: "Solo Ops" });
    const mine = memberTeamFor(HID, "solo_dev");
    expect(mine?.id).toBe(team.id);
    expect(mine?.name).toBe("Solo Ops");
    expect(mine?.members).toContain("solo_dev");

    // edição diferente → não conta
    expect(memberTeamFor("hack-inova-unifacens-2026", "solo_dev")).toBeNull();
  });
});

describe("submitTeam", () => {
  it("cria time com placement 0 mesmo quando o input tenta pódio", () => {
    const m = makeMember("lider");
    register(m.id);
    const { team } = submitTeam(HID, m, {
      name: "Auto-Pódio",
      project: { title: "App" },
      // @ts-expect-error — campo propositalmente fora do contrato
      placement: 1,
    });
    expect(team.placement).toBe(0);
    expect(team.members).toEqual(["lider"]); // autor auto-vinculado
    expect(team.project?.title).toBe("App");
  });

  it("colegas só entram se inscritos na edição — resto vira ignoredUsernames", () => {
    const autor = makeMember("capitao");
    const colegaInscrito = makeMember("colega_in");
    makeMember("colega_out");
    register(autor.id);
    register(colegaInscrito.id);
    // colega_out existe como membro mas NÃO se inscreveu na edição

    const { team, ignoredUsernames } = submitTeam(HID, autor, {
      name: "Time do Bem",
      memberUsernames: [
        "colega_in",
        "colega_out", // membro sem inscrição
        "fantasma_404", // nem membro é
        "capitao", // o próprio autor — dedup silencioso
        "@colega_in", // com arroba — normaliza
      ],
    });
    expect(ignoredUsernames).toEqual(
      expect.arrayContaining(["colega_out", "fantasma_404"]),
    );
    expect(ignoredUsernames).not.toContain("capitao");
    expect(team.members).toEqual(
      expect.arrayContaining(["capitao", "colega_in"]),
    );
    expect(team.members).not.toContain("colega_out");
  });

  it("colega inscrito que JÁ tem time na edição é ignorado", () => {
    const a = makeMember("ja_tem");
    const b = makeMember("quer_recrutar");
    register(a.id);
    register(b.id);
    submitTeam(HID, a, { name: "Time A" });

    const { ignoredUsernames } = submitTeam(HID, b, {
      name: "Time B",
      memberUsernames: ["ja_tem"],
    });
    expect(ignoredUsernames).toContain("ja_tem");
    // e o time A continua intacto
    expect(memberTeamFor(HID, "ja_tem")?.name).toBe("Time A");
  });

  it("409 — autor já está num time da edição", () => {
    const m = makeMember("doidao");
    register(m.id);
    submitTeam(HID, m, { name: "Primeiro" });
    try {
      submitTeam(HID, m, { name: "Segundo" });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(409);
    }
    // o mesmo autor pode ter time em OUTRA edição
    const past = "hack-inova-unifacens-2026";
    register(m.id, past);
    const { team } = submitTeam(past, m, { name: "Retroativo" });
    expect(memberTeamFor(past, "doidao")?.id).toBe(team.id);
  });

  it("409 — nome de time já usado na edição", () => {
    const a = makeMember("primeiro_a_chegar");
    const b = makeMember("chegou_depois");
    register(a.id);
    register(b.id);
    submitTeam(HID, a, { name: "Duplicata" });
    try {
      submitTeam(HID, b, { name: "  Duplicata  " });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(409);
    }
  });

  it("400 — nome vazio; projeto sem título; URL não-http", () => {
    const m = makeMember("valida");
    register(m.id);
    try {
      submitTeam(HID, m, { name: "   " });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
    try {
      submitTeam(HID, m, {
        name: "Ok",
        project: { title: "  ", description: "sem título" },
      });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
    try {
      submitTeam(HID, m, {
        name: "Ok",
        project: { title: "P", repoUrl: "javascript:alert(1)" },
      });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
    // nada foi gravado nos fracassos
    expect(getArchive(HID).teams).toHaveLength(0);
  });
});

describe("updateTeamProject", () => {
  it("integrante edita título/descrição/urls — 200 implícito", () => {
    const m = makeMember("dono_do_projeto");
    register(m.id);
    const { team } = submitTeam(HID, m, {
      name: "Editáveis",
      project: { title: "v1", repoUrl: "https://github.com/x/v1" },
    });
    const updated = updateTeamProject(team.id, m, {
      title: "v2 final",
      description: "agora com demo",
      demoUrl: "https://demo.t.dev",
    });
    expect(updated.project?.title).toBe("v2 final");
    expect(updated.project?.description).toBe("agora com demo");
    expect(updated.project?.repoUrl).toBe("https://github.com/x/v1");
    expect(updated.project?.demoUrl).toBe("https://demo.t.dev");
  });

  it("upsert — time sem projeto ganha um pelo patch", () => {
    const m = makeMember("tardio");
    register(m.id);
    const { team } = submitTeam(HID, m, { name: "Sem Projeto Ainda" });
    const updated = updateTeamProject(team.id, m, {
      title: "Nasceu no sábado",
      repoUrl: "https://github.com/x/nasceu",
    });
    expect(updated.project?.title).toBe("Nasceu no sábado");
  });

  it("string vazia limpa campo opcional; título nunca fica vazio", () => {
    const m = makeMember("limpador");
    register(m.id);
    const { team } = submitTeam(HID, m, {
      name: "Limpa Tudo",
      project: {
        title: "T",
        description: "desc",
        repoUrl: "https://github.com/x/t",
      },
    });
    const updated = updateTeamProject(team.id, m, {
      description: "",
      repoUrl: "",
    });
    expect(updated.project?.description).toBeNull();
    expect(updated.project?.repoUrl).toBeNull();

    try {
      updateTeamProject(team.id, m, { title: "   " });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
  });

  it("403 — membro fora do time não edita; 404 — time inexistente", () => {
    const dono = makeMember("dono_real");
    const estranho = makeMember("stalkeador");
    register(dono.id);
    register(estranho.id);
    const { team } = submitTeam(HID, dono, {
      name: "Meu Time",
      project: { title: "T" },
    });

    try {
      updateTeamProject(team.id, estranho, { title: "hackeado" });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(403);
    }
    try {
      updateTeamProject(999999, dono, { title: "x" });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(404);
    }
    // projeto intacto
    expect(memberTeamFor(HID, "dono_real")?.project?.title).toBe("T");
  });

  it("400 — URL inválida no patch", () => {
    const m = makeMember("urlpatch");
    register(m.id);
    const { team } = submitTeam(HID, m, {
      name: "Patch URL",
      project: { title: "P" },
    });
    try {
      updateTeamProject(team.id, m, { demoUrl: "ftp://nao" });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
  });
});
