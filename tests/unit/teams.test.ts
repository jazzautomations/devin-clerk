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

async function makeMember(username: string): Promise<{ id: number; username: string }> {
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${username}`, username, `${username}@t.dev`);
  return await db
    .prepare("SELECT id, username FROM members WHERE username = ?")
    .get(username) as { id: number; username: string };
}

async function register(memberId: number, hid = HID) {
  await db.prepare(
    "INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)",
  ).run(memberId, hid);
}

const status = (e: unknown) => (e instanceof TeamError ? e.status : null);

beforeEach(async () => {
  await db.prepare("DELETE FROM team_members").run();
  await db.prepare("DELETE FROM team_projects").run();
  await db.prepare("DELETE FROM teams").run();
});

describe("memberTeamFor", () => {
  it("retorna o time do membro na edição; null quando não tem", async () => {
    const m = await makeMember("solo_dev");
    await register(m.id);
    expect(await memberTeamFor(HID, "solo_dev")).toBeNull();

    const { team } = await submitTeam(HID, m, { name: "Solo Ops" });
    const mine = await memberTeamFor(HID, "solo_dev");
    expect(mine?.id).toBe(team.id);
    expect(mine?.name).toBe("Solo Ops");
    expect(mine?.members).toContain("solo_dev");

    // edição diferente → não conta
    expect(await memberTeamFor("hack-inova-unifacens-2026", "solo_dev")).toBeNull();
  });
});

describe("submitTeam", () => {
  it("cria time com placement 0 mesmo quando o input tenta pódio", async () => {
    const m = await makeMember("lider");
    await register(m.id);
    const { team } = await submitTeam(HID, m, {
      name: "Auto-Pódio",
      project: { title: "App" },
      // @ts-expect-error — campo propositalmente fora do contrato
      placement: 1,
    });
    expect(team.placement).toBe(0);
    expect(team.members).toEqual(["lider"]); // autor auto-vinculado
    expect(team.project?.title).toBe("App");
  });

  it("colegas inscritos recebem CONVITE (não entram direto) — resto vira ignoredUsernames", async () => {
    const autor = await makeMember("capitao");
    const colegaInscrito = await makeMember("colega_in");
    await makeMember("colega_out");
    await register(autor.id);
    await register(colegaInscrito.id);
    // colega_out existe como membro mas NÃO se inscreveu na edição

    const { team, ignoredUsernames, invitedUsernames } = await submitTeam(HID, autor, {
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
    // frente N #4 — sem aceite ninguém entra: só o autor está no time
    expect(team.members).toEqual(["capitao"]);
    expect(invitedUsernames).toEqual(["colega_in"]);
    expect(team.members).not.toContain("colega_out");
  });

  it("colega inscrito que JÁ tem time na edição é ignorado", async () => {
    const a = await makeMember("ja_tem");
    const b = await makeMember("quer_recrutar");
    await register(a.id);
    await register(b.id);
    await submitTeam(HID, a, { name: "Time A" });

    const { ignoredUsernames } = await submitTeam(HID, b, {
      name: "Time B",
      memberUsernames: ["ja_tem"],
    });
    expect(ignoredUsernames).toContain("ja_tem");
    // e o time A continua intacto
    expect((await memberTeamFor(HID, "ja_tem"))?.name).toBe("Time A");
  });

  it("409 — autor já está num time da edição", async () => {
    const m = await makeMember("doidao");
    await register(m.id);
    await submitTeam(HID, m, { name: "Primeiro" });
    try {
      await submitTeam(HID, m, { name: "Segundo" });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(409);
    }
    // o mesmo autor pode ter time em OUTRA edição
    const past = "hack-inova-unifacens-2026";
    await register(m.id, past);
    const { team } = await submitTeam(past, m, { name: "Retroativo" });
    expect((await memberTeamFor(past, "doidao"))?.id).toBe(team.id);
  });

  it("409 — nome de time já usado na edição", async () => {
    const a = await makeMember("primeiro_a_chegar");
    const b = await makeMember("chegou_depois");
    await register(a.id);
    await register(b.id);
    await submitTeam(HID, a, { name: "Duplicata" });
    try {
      await submitTeam(HID, b, { name: "  Duplicata  " });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(409);
    }
  });

  it("persiste videoUrl/logoUrl do projeto — submissão rica (spec 030)", async () => {
    const m = await makeMember("midia_rica");
    await register(m.id);
    const { team } = await submitTeam(HID, m, {
      name: "Time Pitch",
      project: {
        title: "Pitch Deck Vivo",
        videoUrl: "https://youtube.com/watch?v=abc",
        logoUrl: "https://img.t.dev/logo.png",
      },
    });
    expect(team.project?.videoUrl).toBe("https://youtube.com/watch?v=abc");
    expect(team.project?.logoUrl).toBe("https://img.t.dev/logo.png");
    // e volta do arquivo (getArchive via memberTeamFor)
    const again = await memberTeamFor(HID, "midia_rica");
    expect(again?.project?.videoUrl).toBe("https://youtube.com/watch?v=abc");
    expect(again?.project?.logoUrl).toBe("https://img.t.dev/logo.png");
  });

  it("400 — videoUrl/logoUrl não-http(s), mesma regra do repoUrl", async () => {
    const m = await makeMember("urlruim");
    await register(m.id);
    const bad = [
      { title: "P", videoUrl: "javascript:alert(1)" },
      { title: "P", logoUrl: "ftp://nao" },
      { title: "P", videoUrl: "  https://ok.dev  " }, // trim aceita — separado abaixo
    ];
    for (const [i, project] of bad.slice(0, 2).entries()) {
      try {
        await submitTeam(HID, m, { name: `Ruim ${i}`, project });
        expect.unreachable();
      } catch (e) {
        expect(status(e)).toBe(400);
      }
    }
    // url com espaço em volta passa pelo trim
    const { team } = await submitTeam(HID, m, { name: "Trim OK", project: bad[2] });
    expect(team.project?.videoUrl).toBe("https://ok.dev");
  });

  it("400 — nome vazio; projeto sem título; URL não-http", async () => {
    const m = await makeMember("valida");
    await register(m.id);
    try {
      await submitTeam(HID, m, { name: "   " });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
    try {
      await submitTeam(HID, m, {
        name: "Ok",
        project: { title: "  ", description: "sem título" },
      });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
    try {
      await submitTeam(HID, m, {
        name: "Ok",
        project: { title: "P", repoUrl: "javascript:alert(1)" },
      });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
    // nada foi gravado nos fracassos
    expect((await getArchive(HID)).teams).toHaveLength(0);
  });
});

describe("updateTeamProject", () => {
  it("integrante edita título/descrição/urls — 200 implícito", async () => {
    const m = await makeMember("dono_do_projeto");
    await register(m.id);
    const { team } = await submitTeam(HID, m, {
      name: "Editáveis",
      project: { title: "v1", repoUrl: "https://github.com/x/v1" },
    });
    const updated = await updateTeamProject(team.id, m, {
      title: "v2 final",
      description: "agora com demo",
      demoUrl: "https://demo.t.dev",
    });
    expect(updated.project?.title).toBe("v2 final");
    expect(updated.project?.description).toBe("agora com demo");
    expect(updated.project?.repoUrl).toBe("https://github.com/x/v1");
    expect(updated.project?.demoUrl).toBe("https://demo.t.dev");
  });

  it("upsert — time sem projeto ganha um pelo patch", async () => {
    const m = await makeMember("tardio");
    await register(m.id);
    const { team } = await submitTeam(HID, m, { name: "Sem Projeto Ainda" });
    const updated = await updateTeamProject(team.id, m, {
      title: "Nasceu no sábado",
      repoUrl: "https://github.com/x/nasceu",
    });
    expect(updated.project?.title).toBe("Nasceu no sábado");
  });

  it("string vazia limpa campo opcional; título nunca fica vazio", async () => {
    const m = await makeMember("limpador");
    await register(m.id);
    const { team } = await submitTeam(HID, m, {
      name: "Limpa Tudo",
      project: {
        title: "T",
        description: "desc",
        repoUrl: "https://github.com/x/t",
      },
    });
    const updated = await updateTeamProject(team.id, m, {
      description: "",
      repoUrl: "",
    });
    expect(updated.project?.description).toBeNull();
    expect(updated.project?.repoUrl).toBeNull();

    try {
      await updateTeamProject(team.id, m, { title: "   " });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
  });

  it("403 — membro fora do time não edita; 404 — time inexistente", async () => {
    const dono = await makeMember("dono_real");
    const estranho = await makeMember("stalkeador");
    await register(dono.id);
    await register(estranho.id);
    const { team } = await submitTeam(HID, dono, {
      name: "Meu Time",
      project: { title: "T" },
    });

    try {
      await updateTeamProject(team.id, estranho, { title: "hackeado" });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(403);
    }
    try {
      await updateTeamProject(999999, dono, { title: "x" });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(404);
    }
    // projeto intacto
    expect((await memberTeamFor(HID, "dono_real"))?.project?.title).toBe("T");
  });

  it("400 — URL inválida no patch", async () => {
    const m = await makeMember("urlpatch");
    await register(m.id);
    const { team } = await submitTeam(HID, m, {
      name: "Patch URL",
      project: { title: "P" },
    });
    try {
      await updateTeamProject(team.id, m, { demoUrl: "ftp://nao" });
      expect.unreachable();
    } catch (e) {
      expect(status(e)).toBe(400);
    }
  });

  it("edita videoUrl/logoUrl; string vazia limpa; upsert cobre as colunas", async () => {
    const m = await makeMember("editor_midia");
    await register(m.id);
    const { team } = await submitTeam(HID, m, {
      name: "Com Mídia",
      project: {
        title: "M",
        videoUrl: "https://youtu.be/x",
        logoUrl: "https://img.t.dev/l.png",
      },
    });
    const updated = await updateTeamProject(team.id, m, {
      videoUrl: "https://vimeo.com/1",
      logoUrl: "",
    });
    expect(updated.project?.videoUrl).toBe("https://vimeo.com/1");
    expect(updated.project?.logoUrl).toBeNull();
    // repo/demo intactos — patch parcial não toca o que não veio
    for (const patch of [
      { videoUrl: "javascript:x" },
      { logoUrl: "data:image/png;base64,xx" },
    ]) {
      try {
        await updateTeamProject(team.id, m, patch);
        expect.unreachable();
      } catch (e) {
        expect(status(e)).toBe(400);
      }
    }
  });

  it("upsert: time sem projeto recebe videoUrl/logoUrl na criação via patch", async () => {
    const m = await makeMember("upsert_midia");
    await register(m.id);
    const { team } = await submitTeam(HID, m, { name: "Nasce Rico" });
    const updated = await updateTeamProject(team.id, m, {
      title: "Nasceu",
      videoUrl: "https://youtu.be/nasceu",
      logoUrl: "https://img.t.dev/n.png",
    });
    expect(updated.project?.videoUrl).toBe("https://youtu.be/nasceu");
    expect(updated.project?.logoUrl).toBe("https://img.t.dev/n.png");
  });
});
