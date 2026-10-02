import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  createSponsor,
  getSponsor,
  getSponsorForChallenge,
  listSponsors,
  updateSponsor,
} from "@/lib/sponsors";
import {
  createChallenge,
  getChallenge,
  getChallenges,
  updateChallenge,
} from "@/lib/challenges";

const PUC = "hack-inova-puc-saude-2026";
const ALPHA = "hack-inova-alphaville-2026";

beforeEach(() => {
  // seeds de desafio ficam (prefixo seed- é da migração); sponsors são todos
  // descartáveis — nenhum seed de sponsor existe ainda
  db.prepare("DELETE FROM challenges WHERE id NOT LIKE 'seed-%'").run();
  db.prepare("UPDATE challenges SET sponsorId = NULL, active = 1").run();
  db.prepare("DELETE FROM sponsors").run();
});

describe("createSponsor + getSponsor + listSponsors", () => {
  it("cria com defaults: tier 'sponsor', active, campos opcionais null", () => {
    const s = createSponsor({ name: "Nubank" });
    expect(s.id).toBeTruthy();
    expect(s.tier).toBe("sponsor");
    expect(s.active).toBe(true);
    expect(s.url).toBeNull();
    expect(s.contactEmail).toBeNull();
    expect(getSponsor(s.id)?.name).toBe("Nubank");
    expect(listSponsors().map((x) => x.id)).toContain(s.id);
  });

  it("cria completo: url, tier master, contato e notas", () => {
    const s = createSponsor({
      name: "Oracle",
      url: "https://oracle.com",
      tier: "master",
      contactEmail: "devrel@oracle.com",
      notes: "contato via evento",
    });
    expect(s.tier).toBe("master");
    expect(s.url).toBe("https://oracle.com");
    expect(s.contactEmail).toBe("devrel@oracle.com");
    expect(s.notes).toBe("contato via evento");
  });

  it("name é UNIQUE — duplicata lança erro", () => {
    createSponsor({ name: "Oracle" });
    expect(() => createSponsor({ name: "Oracle" })).toThrow();
  });

  it("name vazio lança erro", () => {
    expect(() => createSponsor({ name: "  " })).toThrow();
  });

  it("tier fora de apoio/sponsor/master lança erro", () => {
    expect(() =>
      createSponsor({ name: "X", tier: "diamante" as never }),
    ).toThrow();
    expect(createSponsor({ name: "A", tier: "apoio" }).tier).toBe("apoio");
    expect(createSponsor({ name: "M", tier: "master" }).tier).toBe("master");
  });

  it("listSponsors traz challengeCount — nº de desafios vinculados", () => {
    const s = createSponsor({ name: "Oracle" });
    const outro = createSponsor({ name: "Soy" });
    createChallenge(PUC, { title: "T1", sponsorId: s.id });
    createChallenge(PUC, { title: "T2", sponsorId: s.id });
    const list = listSponsors();
    expect(list.find((x) => x.id === s.id)?.challengeCount).toBe(2);
    expect(list.find((x) => x.id === outro.id)?.challengeCount).toBe(0);
  });
});

describe("updateSponsor — patch parcial + soft-delete", () => {
  it("aplica só os campos enviados", () => {
    const s = createSponsor({ name: "Oracle", url: "https://oracle.com" });
    const up = updateSponsor(s.id, { tier: "master" });
    expect(up?.tier).toBe("master");
    expect(up?.url).toBe("https://oracle.com");
    expect(up?.name).toBe("Oracle");
  });

  it("null limpa url/contactEmail/notes", () => {
    const s = createSponsor({
      name: "Oracle",
      url: "https://oracle.com",
      contactEmail: "a@b.c",
      notes: "n",
    });
    const up = updateSponsor(s.id, {
      url: null,
      contactEmail: null,
      notes: null,
    });
    expect(up?.url).toBeNull();
    expect(up?.contactEmail).toBeNull();
    expect(up?.notes).toBeNull();
  });

  it("active=false é reversível e não apaga o registro", () => {
    const s = createSponsor({ name: "Oracle" });
    updateSponsor(s.id, { active: false });
    expect(getSponsor(s.id)?.active).toBe(false);
    updateSponsor(s.id, { active: true });
    expect(getSponsor(s.id)?.active).toBe(true);
  });

  it("renomear pra nome existente lança erro", () => {
    createSponsor({ name: "Oracle" });
    const b = createSponsor({ name: "Nubank" });
    expect(() => updateSponsor(b.id, { name: "Oracle" })).toThrow();
    expect(() => updateSponsor(b.id, { name: "  " })).toThrow();
  });

  it("tier inválido lança erro; id inexistente retorna null", () => {
    const s = createSponsor({ name: "Oracle" });
    expect(() => updateSponsor(s.id, { tier: "x" as never })).toThrow();
    expect(updateSponsor("fantasma", { name: "x" })).toBeNull();
  });
});

describe("challenge ⋈ sponsor — vínculo via sponsorId", () => {
  it("createChallenge com sponsorId válido vincula e copia o nome", () => {
    const s = createSponsor({ name: "Oracle", url: "https://oracle.com" });
    const c = createChallenge(PUC, { title: "Jornada X", sponsorId: s.id });
    expect(c.sponsorId).toBe(s.id);
    expect(c.sponsor).toBe("Oracle"); // fallback de exibição = nome da entidade
    expect(c.sponsorUrl).toBe("https://oracle.com");
    expect(c.sponsorTier).toBe("sponsor");
  });

  it("sponsor textual explícito convive com sponsorId (display override)", () => {
    const s = createSponsor({ name: "Oracle", tier: "master" });
    const c = createChallenge(PUC, {
      title: "T",
      sponsor: "Oracle + Enterprise X",
      sponsorId: s.id,
    });
    expect(c.sponsor).toBe("Oracle + Enterprise X");
    expect(c.sponsorId).toBe(s.id);
    expect(c.sponsorTier).toBe("master");
  });

  it("sponsorId inexistente lança erro; sem sponsor nem sponsorId também", () => {
    expect(() =>
      createChallenge(PUC, { title: "T", sponsorId: "fantasma" }),
    ).toThrow();
    expect(() => createChallenge(PUC, { title: "T" })).toThrow();
  });

  it("desafio só-texto: sponsorUrl/sponsorTier null, sponsor TEXT é o fallback", () => {
    const c = createChallenge(PUC, { sponsor: "Marca Solta", title: "T" });
    const pub = getChallenges(PUC).find((x) => x.id === c.id)!;
    expect(pub.sponsor).toBe("Marca Solta");
    expect(pub.sponsorId).toBeNull();
    expect(pub.sponsorUrl).toBeNull();
    expect(pub.sponsorTier).toBeNull();
  });

  it("join expõe url+tier na listagem pública e no getChallenge", () => {
    const s = createSponsor({
      name: "Oracle",
      url: "https://oracle.com",
      tier: "master",
    });
    const c = createChallenge(ALPHA, { title: "T", sponsorId: s.id });
    const pub = getChallenges(ALPHA).find((x) => x.id === c.id)!;
    expect(pub.sponsorUrl).toBe("https://oracle.com");
    expect(pub.sponsorTier).toBe("master");
    expect(getChallenge(c.id)?.sponsorTier).toBe("master");
  });

  it("updateChallenge: sponsorId vincula (copia nome), null desvincula", () => {
    const s = createSponsor({ name: "Oracle", url: "https://oracle.com" });
    const c = createChallenge(PUC, { sponsor: "Legado", title: "T" });
    const linked = updateChallenge(c.id, { sponsorId: s.id });
    expect(linked?.sponsorId).toBe(s.id);
    expect(linked?.sponsor).toBe("Oracle");
    expect(linked?.sponsorUrl).toBe("https://oracle.com");
    const unlinked = updateChallenge(c.id, { sponsorId: null });
    expect(unlinked?.sponsorId).toBeNull();
    expect(unlinked?.sponsorUrl).toBeNull();
    expect(unlinked?.sponsor).toBe("Oracle"); // texto fica como fallback
  });

  it("updateChallenge com sponsorId fantasma lança erro", () => {
    const c = createChallenge(PUC, { sponsor: "S", title: "T" });
    expect(() => updateChallenge(c.id, { sponsorId: "fantasma" })).toThrow();
  });

  it("getSponsorForChallenge retorna a entidade ou null", () => {
    const s = createSponsor({ name: "Oracle" });
    const c = createChallenge(PUC, { title: "T", sponsorId: s.id });
    const t = createChallenge(PUC, { sponsor: "Solto", title: "T2" });
    expect(getSponsorForChallenge(c.id)?.id).toBe(s.id);
    expect(getSponsorForChallenge(t.id)).toBeNull();
    expect(getSponsorForChallenge("fantasma")).toBeNull();
  });

  it("sponsor desativado segue vinculado — url/tier ainda expostos (histórico)", () => {
    const s = createSponsor({ name: "Oracle", url: "https://oracle.com" });
    const c = createChallenge(PUC, { title: "T", sponsorId: s.id });
    updateSponsor(s.id, { active: false });
    const pub = getChallenges(PUC).find((x) => x.id === c.id)!;
    expect(pub.sponsorUrl).toBe("https://oracle.com");
    expect(pub.sponsorTier).toBe("sponsor");
  });
});
