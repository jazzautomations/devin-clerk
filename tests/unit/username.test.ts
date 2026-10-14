import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  changeUsername,
  generateUsername,
  getMemberByUsername,
  getOrCreateMember,
  resolveUsernameRedirect,
  slugPart,
  usernameCandidates,
} from "@/lib/members";
import { memberTeamFor } from "@/lib/teams";

// frente N #8 — username automático legível + troca única com redirect

describe("username automático", () => {
  it("slug pt-BR sem acento", () => {
    expect(slugPart("João")).toBe("joao");
    expect(slugPart("Conceição-Araújo")).toBe("conceicaoaraujo");
    expect(slugPart("Ñandú Çé")).toBe("nanduce");
  });

  it("nome+sobrenome primeiro, sem partícula nem número; depois nome; depois e-mail limpo", () => {
    expect(usernameCandidates("Maria", "da Conceição", "m.c-92@x.dev")).toEqual(["mariaconceicao", "maria", "mc"].filter((c) => c.length >= 3));
    expect(usernameCandidates(null, null, "joao.silva92+hack@gmail.com")).toEqual(["joaosilva"]);
    expect(usernameCandidates("Zé", null, "ze-2@x.dev")).toEqual(["hacker"]); // nada com 3+ letras
    expect(usernameCandidates("Admin", null, "admin@x.dev")).toEqual(["hacker"]); // reservado
    expect(usernameCandidates("Ana Beatriz", "Souza Lima", "x@x.dev")[0]).toBe("analima");
    expect(usernameCandidates("Maximiliano Bartolomeu", "Vasconcelos", "x@x.dev")[0]).toHaveLength(20);
  });

  it("sufixo curto só quando colide (e @ reservado por redirect também colide)", async () => {
    expect(await generateUsername("Clara", "Nunes", "cn@x.dev")).toBe("claranunes");
    await db.prepare("INSERT INTO members (clerkId, username, email) VALUES ('k_cn1', 'claranunes', 'a@x.dev')").run();
    expect(await generateUsername("Clara", "Nunes", "cn@x.dev")).toBe("clara");
    await db.prepare("INSERT INTO members (clerkId, username, email) VALUES ('k_cn2', 'clara', 'b@x.dev')").run();
    // e-mail "cn" é curto demais → cai no sufixo do primeiro candidato
    expect(await generateUsername("Clara", "Nunes", "cn@x.dev")).toBe("claranunes2");
    const owner = await db.prepare("SELECT id FROM members WHERE clerkId = 'k_cn1'").get<{ id: number }>();
    await db.prepare("INSERT INTO username_redirects (oldUsername, memberId) VALUES ('claranunes2', ?)").run(owner!.id);
    expect(await generateUsername("Clara", "Nunes", "cn@x.dev")).toBe("claranunes3");
  });

  it("getOrCreateMember usa o nome do Clerk (antes: e-mail sem pontuação)", async () => {
    const m = await getOrCreateMember({ id: "k_gc", firstName: "Íris", lastName: "Gonçalves", email: "iris.g.1999@x.dev" });
    expect(m.username).toBe("irisgoncalves");
  });
});

describe("troca única de username", () => {
  async function seedMember(clerkId: string, username: string) {
    return (await db
      .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
      .get<{ id: number }>(clerkId, username, `${clerkId}@x.dev`))!.id;
  }

  it("troca, leva o time junto, reserva o antigo e redireciona; segunda troca = 409", async () => {
    const id = await seedMember("k_tr", "user_2xyzfeio");
    await db.prepare("INSERT INTO registrations (memberId, hackathonId) VALUES (?, 'hack-inova-alphaville-2026')").run(id);
    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES ('hack-inova-alphaville-2026', 'Time Troca', 0) RETURNING id")
      .get<{ id: number }>();
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, 'user_2xyzfeio')").run(t!.id);

    expect(await changeUsername(id, "@Rafa_Dev")).toEqual({ username: "rafa_dev", old: "user_2xyzfeio" });
    expect((await getMemberByUsername("rafa_dev"))?.id).toBe(id);
    expect(await getMemberByUsername("user_2xyzfeio")).toBeNull();
    expect(await resolveUsernameRedirect("user_2xyzfeio")).toBe("rafa_dev");
    expect((await memberTeamFor("hack-inova-alphaville-2026", "rafa_dev"))?.name).toBe("Time Troca");

    await expect(changeUsername(id, "outro_nome")).rejects.toMatchObject({ status: 409 });
    // ninguém assume o @ antigo
    const other = await seedMember("k_tr2", "fulano_x");
    await expect(changeUsername(other, "user_2xyzfeio")).rejects.toMatchObject({ status: 409 });
    await expect(changeUsername(other, "rafa_dev")).rejects.toMatchObject({ status: 409 });
  });

  it("valida formato e reservados", async () => {
    const id = await seedMember("k_val", "valida_eu");
    for (const bad of ["ab", "com espaço", "joão", "a".repeat(21), "admin", "removido-9", null]) {
      await expect(changeUsername(id, bad)).rejects.toMatchObject({ status: 400 });
    }
    await expect(changeUsername(id, "valida_eu")).rejects.toMatchObject({ status: 400 });
    // certificado usa código próprio e memberId: nada a migrar
    const cols = await db
      .prepare(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'certificates' AND column_name ILIKE '%username%'",
      )
      .all();
    expect(cols).toEqual([]);
  });
});
