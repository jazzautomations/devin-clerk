import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getOrCreateMember, updateMemberProfile, getMemberByClerkId } from "@/lib/members";
import { parsePersonas, personaLabel } from "@/lib/personas";

describe("personas", () => {
  it("valida chaves conhecidas, tira repetição e limita a 4", () => {
    expect(parsePersonas(["dev", "empreendedor", "dev"])).toEqual({ value: ["dev", "empreendedor"] });
    expect(parsePersonas(["hacker-do-mal"])).toHaveProperty("error");
    expect(parsePersonas(["dev", "design", "produto", "dados", "mentor"])).toHaveProperty("error");
    expect(parsePersonas("dev")).toHaveProperty("error");
    expect(personaLabel("empreendedor")).toBe("founder");
  });

  it("salva a lista e o principal (1º) continua em persona pro feed/talento", async () => {
    await db.prepare("DELETE FROM members WHERE clerkId = 'c_persona'").run();
    await getOrCreateMember({ id: "c_persona", firstName: null, lastName: null, email: "p@t.dev" });
    await updateMemberProfile("c_persona", { personas: ["investidor", "mentor"] });
    const m = await getMemberByClerkId("c_persona");
    expect(m?.personas).toEqual(["investidor", "mentor"]);
    expect(m?.persona).toBe("investidor");
    await updateMemberProfile("c_persona", { personas: [] });
    const cleared = await getMemberByClerkId("c_persona");
    expect(cleared?.personas).toEqual([]);
    expect(cleared?.persona).toBeNull();
  });
});
