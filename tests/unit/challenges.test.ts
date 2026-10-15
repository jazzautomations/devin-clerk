import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  createChallenge,
  getChallenge,
  getChallenges,
  updateChallenge,
} from "@/lib/challenges";

const PUC = "hack-inova-puc-saude-2026";
const UNIFACENS = "hack-inova-unifacens-2026";

beforeEach(async () => {
  // seeds ficam — prefixo seed- é da migração; o resto é descartável
  await db.prepare("DELETE FROM challenges WHERE id NOT LIKE 'seed-%'").run();
  await db.prepare("UPDATE challenges SET active = 1 WHERE id LIKE 'seed-%'").run();
});

describe("seed não inventa patrocínio", () => {
  it("edições do seed nascem sem desafio (os antigos eram inventados — migration 025)", async () => {
    expect(await getChallenges(PUC)).toHaveLength(0);
    expect(await getChallenges(UNIFACENS)).toHaveLength(0);
  });
});

describe("createChallenge + getChallenges", () => {
  it("cria desafio completo e ele entra na listagem da edição", async () => {
    const c = await createChallenge(PUC, {
      sponsor: "Nubank",
      title: "Fraude em Pix em tempo real",
      prize: "R$10k + entrevista",
      description: "detecção de fraude com IA",
    });
    expect(c.id).toBeTruthy();
    expect(c.hackathonId).toBe(PUC);
    expect(c.active).toBe(true);
    expect((await getChallenges(PUC)).map((x) => x.id)).toContain(c.id);
  });

  it("exige sponsor e title não-vazios", async () => {
    await expect(createChallenge(PUC, { sponsor: "  ", title: "x" }),
    ).rejects.toThrow();
    await expect(createChallenge(PUC, { sponsor: "x", title: "" }),
    ).rejects.toThrow();
  });

  it("edição sem desafios retorna lista vazia (seção não renderiza)", async () => {
    expect(await getChallenges("hack-inova-alphaville-2026")).toEqual([]);
  });

  it("descrição e prêmio são opcionais", async () => {
    const c = await createChallenge(PUC, { sponsor: "S", title: "T" });
    expect(c.description).toBeNull();
    expect(c.prize).toBeNull();
  });
});

describe("updateChallenge — patch parcial + soft-delete", () => {
  it("aplica só os campos enviados e preserva o resto", async () => {
    const c = await createChallenge(PUC, {
      sponsor: "Sponsor A",
      title: "T",
      prize: "P",
    });
    const up = await updateChallenge(c.id, { title: "T2" });
    expect(up?.title).toBe("T2");
    expect(up?.sponsor).toBe("Sponsor A");
    expect(up?.prize).toBe("P");
  });

  it("active=false some da listagem pública mas fica no banco", async () => {
    const c = await createChallenge(PUC, { sponsor: "S", title: "T" });
    await updateChallenge(c.id, { active: false });
    expect((await getChallenges(PUC)).map((x) => x.id)).not.toContain(c.id);
    expect((await getChallenge(c.id))?.active).toBe(false);
    // reativar é reversível
    await updateChallenge(c.id, { active: true });
    expect((await getChallenges(PUC)).map((x) => x.id)).toContain(c.id);
  });

  it("aceita null pra limpar description/prize", async () => {
    const c = await createChallenge(PUC, {
      sponsor: "S",
      title: "T",
      prize: "P",
      description: "D",
    });
    const up = await updateChallenge(c.id, { prize: null, description: null });
    expect(up?.prize).toBeNull();
    expect(up?.description).toBeNull();
  });

  it("id inexistente retorna null", async () => {
    expect(await updateChallenge("fantasma", { title: "x" })).toBeNull();
    expect(await getChallenge("fantasma")).toBeNull();
  });
});
