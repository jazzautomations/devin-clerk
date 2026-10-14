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

beforeEach(async () => {
  // seeds de desafio ficam (prefixo seed- é da migração); sponsors são todos
  // descartáveis — nenhum seed de sponsor existe ainda
  await db.prepare("DELETE FROM challenges WHERE id NOT LIKE 'seed-%'").run();
  await db.prepare("UPDATE challenges SET sponsorId = NULL, active = 1").run();
  await db.prepare("DELETE FROM sponsors").run();
});

describe("createSponsor + getSponsor + listSponsors", () => {
  it("cria com defaults: tier 'sponsor', active, campos opcionais null", async () => {
    const s = await createSponsor({ name: "Nubank" });
    expect(s.id).toBeTruthy();
    expect(s.tier).toBe("sponsor");
    expect(s.active).toBe(true);
    expect(s.url).toBeNull();
    expect(s.contactEmail).toBeNull();
    expect((await getSponsor(s.id))?.name).toBe("Nubank");
    expect((await listSponsors()).map((x) => x.id)).toContain(s.id);
  });

  it("cria completo: url, tier master, contato e notas", async () => {
    const s = await createSponsor({
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

  it("name é UNIQUE — duplicata lança erro", async () => {
    await createSponsor({ name: "Oracle" });
    await expect(createSponsor({ name: "Oracle" })).rejects.toThrow();
  });

  it("name vazio lança erro", async () => {
    await expect(createSponsor({ name: "  " })).rejects.toThrow();
  });

  it("tier fora de apoio/sponsor/master lança erro", async () => {
    await expect(createSponsor({ name: "X", tier: "diamante" as never }),
    ).rejects.toThrow();
    expect((await createSponsor({ name: "A", tier: "apoio" })).tier).toBe("apoio");
    expect((await createSponsor({ name: "M", tier: "master" })).tier).toBe("master");
  });

  it("listSponsors traz challengeCount — nº de desafios vinculados", async () => {
    const s = await createSponsor({ name: "Oracle" });
    const outro = await createSponsor({ name: "Soy" });
    await createChallenge(PUC, { title: "T1", sponsorId: s.id });
    await createChallenge(PUC, { title: "T2", sponsorId: s.id });
    const list = await listSponsors();
    expect(list.find((x) => x.id === s.id)?.challengeCount).toBe(2);
    expect(list.find((x) => x.id === outro.id)?.challengeCount).toBe(0);
  });
});

describe("updateSponsor — patch parcial + soft-delete", () => {
  it("aplica só os campos enviados", async () => {
    const s = await createSponsor({ name: "Oracle", url: "https://oracle.com" });
    const up = await updateSponsor(s.id, { tier: "master" });
    expect(up?.tier).toBe("master");
    expect(up?.url).toBe("https://oracle.com");
    expect(up?.name).toBe("Oracle");
  });

  it("null limpa url/contactEmail/notes", async () => {
    const s = await createSponsor({
      name: "Oracle",
      url: "https://oracle.com",
      contactEmail: "a@b.c",
      notes: "n",
    });
    const up = await updateSponsor(s.id, {
      url: null,
      contactEmail: null,
      notes: null,
    });
    expect(up?.url).toBeNull();
    expect(up?.contactEmail).toBeNull();
    expect(up?.notes).toBeNull();
  });

  it("active=false é reversível e não apaga o registro", async () => {
    const s = await createSponsor({ name: "Oracle" });
    await updateSponsor(s.id, { active: false });
    expect((await getSponsor(s.id))?.active).toBe(false);
    await updateSponsor(s.id, { active: true });
    expect((await getSponsor(s.id))?.active).toBe(true);
  });

  it("renomear pra nome existente lança erro", async () => {
    await createSponsor({ name: "Oracle" });
    const b = await createSponsor({ name: "Nubank" });
    await expect(updateSponsor(b.id, { name: "Oracle" })).rejects.toThrow();
    await expect(updateSponsor(b.id, { name: "  " })).rejects.toThrow();
  });

  it("tier inválido lança erro; id inexistente retorna null", async () => {
    const s = await createSponsor({ name: "Oracle" });
    await expect(updateSponsor(s.id, { tier: "x" as never })).rejects.toThrow();
    expect(await updateSponsor("fantasma", { name: "x" })).toBeNull();
  });
});

describe("challenge ⋈ sponsor — vínculo via sponsorId", () => {
  it("createChallenge com sponsorId válido vincula e copia o nome", async () => {
    const s = await createSponsor({ name: "Oracle", url: "https://oracle.com" });
    const c = await createChallenge(PUC, { title: "Jornada X", sponsorId: s.id });
    expect(c.sponsorId).toBe(s.id);
    expect(c.sponsor).toBe("Oracle"); // fallback de exibição = nome da entidade
    expect(c.sponsorUrl).toBe("https://oracle.com");
    expect(c.sponsorTier).toBe("sponsor");
  });

  it("sponsor textual explícito convive com sponsorId (display override)", async () => {
    const s = await createSponsor({ name: "Oracle", tier: "master" });
    const c = await createChallenge(PUC, {
      title: "T",
      sponsor: "Oracle + Enterprise X",
      sponsorId: s.id,
    });
    expect(c.sponsor).toBe("Oracle + Enterprise X");
    expect(c.sponsorId).toBe(s.id);
    expect(c.sponsorTier).toBe("master");
  });

  it("sponsorId inexistente lança erro; sem sponsor nem sponsorId também", async () => {
    await expect(createChallenge(PUC, { title: "T", sponsorId: "fantasma" }),
    ).rejects.toThrow();
    await expect(createChallenge(PUC, { title: "T" })).rejects.toThrow();
  });

  it("desafio só-texto: sponsorUrl/sponsorTier null, sponsor TEXT é o fallback", async () => {
    const c = await createChallenge(PUC, { sponsor: "Marca Solta", title: "T" });
    const pub = (await getChallenges(PUC)).find((x) => x.id === c.id)!;
    expect(pub.sponsor).toBe("Marca Solta");
    expect(pub.sponsorId).toBeNull();
    expect(pub.sponsorUrl).toBeNull();
    expect(pub.sponsorTier).toBeNull();
  });

  it("join expõe url+tier na listagem pública e no getChallenge", async () => {
    const s = await createSponsor({
      name: "Oracle",
      url: "https://oracle.com",
      tier: "master",
    });
    const c = await createChallenge(ALPHA, { title: "T", sponsorId: s.id });
    const pub = (await getChallenges(ALPHA)).find((x) => x.id === c.id)!;
    expect(pub.sponsorUrl).toBe("https://oracle.com");
    expect(pub.sponsorTier).toBe("master");
    expect((await getChallenge(c.id))?.sponsorTier).toBe("master");
  });

  it("updateChallenge: sponsorId vincula (copia nome), null desvincula", async () => {
    const s = await createSponsor({ name: "Oracle", url: "https://oracle.com" });
    const c = await createChallenge(PUC, { sponsor: "Legado", title: "T" });
    const linked = await updateChallenge(c.id, { sponsorId: s.id });
    expect(linked?.sponsorId).toBe(s.id);
    expect(linked?.sponsor).toBe("Oracle");
    expect(linked?.sponsorUrl).toBe("https://oracle.com");
    const unlinked = await updateChallenge(c.id, { sponsorId: null });
    expect(unlinked?.sponsorId).toBeNull();
    expect(unlinked?.sponsorUrl).toBeNull();
    expect(unlinked?.sponsor).toBe("Oracle"); // texto fica como fallback
  });

  it("updateChallenge com sponsorId fantasma lança erro", async () => {
    const c = await createChallenge(PUC, { sponsor: "S", title: "T" });
    await expect(updateChallenge(c.id, { sponsorId: "fantasma" })).rejects.toThrow();
  });

  it("getSponsorForChallenge retorna a entidade ou null", async () => {
    const s = await createSponsor({ name: "Oracle" });
    const c = await createChallenge(PUC, { title: "T", sponsorId: s.id });
    const t = await createChallenge(PUC, { sponsor: "Solto", title: "T2" });
    expect((await getSponsorForChallenge(c.id))?.id).toBe(s.id);
    expect(await getSponsorForChallenge(t.id)).toBeNull();
    expect(await getSponsorForChallenge("fantasma")).toBeNull();
  });

  it("sponsor desativado segue vinculado — url/tier ainda expostos (histórico)", async () => {
    const s = await createSponsor({ name: "Oracle", url: "https://oracle.com" });
    const c = await createChallenge(PUC, { title: "T", sponsorId: s.id });
    await updateSponsor(s.id, { active: false });
    const pub = (await getChallenges(PUC)).find((x) => x.id === c.id)!;
    expect(pub.sponsorUrl).toBe("https://oracle.com");
    expect(pub.sponsorTier).toBe("sponsor");
  });
});
