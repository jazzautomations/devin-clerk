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

beforeEach(() => {
  // seeds ficam — prefixo seed- é da migração; o resto é descartável
  db.prepare("DELETE FROM challenges WHERE id NOT LIKE 'seed-%'").run();
  db.prepare("UPDATE challenges SET active = 1 WHERE id LIKE 'seed-%'").run();
});

describe("seeds — patrocínio real das edições", () => {
  it("PUC tem o desafio Oracle da jornada do paciente", () => {
    const list = getChallenges(PUC);
    expect(list).toHaveLength(1);
    expect(list[0].sponsor).toBe("Oracle");
    expect(list[0].title).toContain("Jornada do paciente");
    expect(list[0].prize).toContain("OCI");
  });

  it("Unifacens tem o desafio Oracle + Enterprise X Ventures", () => {
    const list = getChallenges(UNIFACENS);
    const c = list.find((x) => x.title.includes("IA aplicada"));
    expect(c?.sponsor).toContain("Oracle");
    expect(c?.sponsor).toContain("Enterprise X Ventures");
    expect(c?.prize).toContain("R$5k");
  });
});

describe("createChallenge + getChallenges", () => {
  it("cria desafio completo e ele entra na listagem da edição", () => {
    const c = createChallenge(PUC, {
      sponsor: "Nubank",
      title: "Fraude em Pix em tempo real",
      prize: "R$10k + entrevista",
      description: "detecção de fraude com IA",
    });
    expect(c.id).toBeTruthy();
    expect(c.hackathonId).toBe(PUC);
    expect(c.active).toBe(true);
    expect(getChallenges(PUC).map((x) => x.id)).toContain(c.id);
  });

  it("exige sponsor e title não-vazios", () => {
    expect(() =>
      createChallenge(PUC, { sponsor: "  ", title: "x" }),
    ).toThrow();
    expect(() =>
      createChallenge(PUC, { sponsor: "x", title: "" }),
    ).toThrow();
  });

  it("edição sem desafios retorna lista vazia (seção não renderiza)", () => {
    expect(getChallenges("hack-inova-alphaville-2026")).toEqual([]);
  });

  it("descrição e prêmio são opcionais", () => {
    const c = createChallenge(PUC, { sponsor: "S", title: "T" });
    expect(c.description).toBeNull();
    expect(c.prize).toBeNull();
  });
});

describe("updateChallenge — patch parcial + soft-delete", () => {
  it("aplica só os campos enviados e preserva o resto", () => {
    const c = createChallenge(PUC, {
      sponsor: "Sponsor A",
      title: "T",
      prize: "P",
    });
    const up = updateChallenge(c.id, { title: "T2" });
    expect(up?.title).toBe("T2");
    expect(up?.sponsor).toBe("Sponsor A");
    expect(up?.prize).toBe("P");
  });

  it("active=false some da listagem pública mas fica no banco", () => {
    const c = createChallenge(PUC, { sponsor: "S", title: "T" });
    updateChallenge(c.id, { active: false });
    expect(getChallenges(PUC).map((x) => x.id)).not.toContain(c.id);
    expect(getChallenge(c.id)?.active).toBe(false);
    // reativar é reversível
    updateChallenge(c.id, { active: true });
    expect(getChallenges(PUC).map((x) => x.id)).toContain(c.id);
  });

  it("aceita null pra limpar description/prize", () => {
    const c = createChallenge(PUC, {
      sponsor: "S",
      title: "T",
      prize: "P",
      description: "D",
    });
    const up = updateChallenge(c.id, { prize: null, description: null });
    expect(up?.prize).toBeNull();
    expect(up?.description).toBeNull();
  });

  it("id inexistente retorna null", () => {
    expect(updateChallenge("fantasma", { title: "x" })).toBeNull();
    expect(getChallenge("fantasma")).toBeNull();
  });
});
