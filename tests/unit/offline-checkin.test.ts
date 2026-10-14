import { describe, expect, it } from "vitest";
import {
  applySyncResults,
  checkInOffline,
  enqueue,
  hashToken,
  localCheckedInAt,
  mergeIntoPack,
  type OfflinePack,
  type QueuedCheckin,
} from "@/lib/offlineCheckin";
import { checkinWindow, clampCheckinAt, tokenHash } from "@/lib/checkinPack";
import { ticketToken } from "@/lib/checkins";

// Check-in offline — lógica do aparelho (roadmap 037 #5): valida o QR
// contra o pacote, fila sem duplicar, horário mais cedo vence.

const pack = (): OfflinePack => ({
  v: 1,
  hackathonId: "h",
  issuedAt: "2026-11-07T12:00:00.000Z",
  window: { start: "2026-11-06T00:00:00.000Z", end: "2026-11-10T00:00:00.000Z" },
  sig: "x",
  entries: [
    { h: tokenHash(ticketToken(1)), rid: 1, name: "Ana", username: "ana", status: "approved", at: null },
    { h: tokenHash(ticketToken(2)), rid: 2, name: "Bia", username: "bia", status: "waitlist", at: null },
    { h: tokenHash(ticketToken(3)), rid: 3, name: "Caio", username: "caio", status: "approved", at: "2026-11-07 13:00:00" },
  ],
});

describe("hash do token", () => {
  it("Web Crypto do aparelho bate com o node:crypto do servidor", async () => {
    const t = ticketToken(42);
    expect(await hashToken(t)).toBe(tokenHash(t));
    expect(await hashToken(t)).not.toContain(t.slice(4));
  });
});

describe("checkInOffline", () => {
  const t1 = new Date("2026-11-07T14:00:00Z");

  it("QR válido e aprovado → ok e entra na fila com o horário da leitura", async () => {
    const { result, queue } = await checkInOffline(pack(), [], { token: ticketToken(1) }, t1);
    expect(result).toMatchObject({ kind: "ok", entry: { rid: 1 } });
    expect(queue).toEqual([{ rid: 1, token: ticketToken(1), at: t1.toISOString() }]);
  });

  it("duas leituras do mesmo QR offline não duplicam: a segunda é 'already' com o 1º horário", async () => {
    const a = await checkInOffline(pack(), [], { token: ticketToken(1) }, t1);
    const b = await checkInOffline(pack(), a.queue, { token: ticketToken(1) }, new Date("2026-11-07T15:00:00Z"));
    expect(b.result).toMatchObject({ kind: "already", at: t1.toISOString() });
    expect(b.queue).toBe(a.queue);
    expect(b.queue).toHaveLength(1);
  });

  it("check-in que o servidor já tinha (no pacote) → already", async () => {
    const { result, queue } = await checkInOffline(pack(), [], { token: ticketToken(3) }, t1);
    expect(result.kind).toBe("already");
    expect(queue).toHaveLength(0);
  });

  it("fila de espera bloqueia; ingresso de fora do pacote é unknown; lixo é invalid", async () => {
    expect((await checkInOffline(pack(), [], { token: ticketToken(2) }, t1)).result.kind).toBe("blocked");
    expect((await checkInOffline(pack(), [], { token: ticketToken(999) }, t1)).result.kind).toBe("unknown");
    expect((await checkInOffline(pack(), [], { token: "https://golpe.dev" }, t1)).result.kind).toBe("invalid");
  });

  it("token forjado com o formato certo não passa (sem o segredo não há hash no pacote)", async () => {
    const forged = "HH1." + "A".repeat(43);
    expect((await checkInOffline(pack(), [], { token: forged }, t1)).result.kind).toBe("unknown");
  });

  it("busca manual offline (por inscrição) entra na fila sem token", async () => {
    const { result, queue } = await checkInOffline(pack(), [], { rid: 1 }, t1);
    expect(result.kind).toBe("ok");
    expect(queue).toEqual([{ rid: 1, at: t1.toISOString() }]);
  });
});

describe("fila", () => {
  it("enqueue: mesma inscrição fica com o horário mais cedo", () => {
    let q: QueuedCheckin[] = [];
    q = enqueue(q, { rid: 1, at: "2026-11-07T15:00:00.000Z" });
    q = enqueue(q, { rid: 1, token: "HH1.x", at: "2026-11-07T14:00:00.000Z" });
    q = enqueue(q, { rid: 1, at: "2026-11-07T16:00:00.000Z" });
    expect(q).toEqual([{ rid: 1, token: "HH1.x", at: "2026-11-07T14:00:00.000Z" }]);
  });

  it("localCheckedInAt pega o mais cedo entre servidor e fila", () => {
    const e = pack().entries[2];
    expect(localCheckedInAt(e, [{ rid: 3, at: "2026-11-07T12:30:00.000Z" }])).toBe("2026-11-07T12:30:00.000Z");
    expect(localCheckedInAt(e, [])).toBe("2026-11-07T13:00:00.000Z");
  });

  it("applySyncResults tira da fila o que o servidor respondeu e mantém o resto", () => {
    const q: QueuedCheckin[] = [
      { rid: 1, at: "a" },
      { rid: 2, at: "b" },
      { rid: 3, at: "c" },
    ];
    const left = applySyncResults(q, q.slice(0, 2), [
      { rid: 1, ok: true, outcome: "created", at: "2026-11-07 14:00:00" },
      { rid: null, ok: false, reason: "not_found" },
    ]);
    expect(left).toEqual([{ rid: 3, at: "c" }]);
  });

  it("mergeIntoPack grava o horário oficial no pacote local", () => {
    const p = mergeIntoPack(pack(), [{ rid: 1, ok: true, outcome: "created", at: "2026-11-07 14:00:00" }]);
    expect(p.entries[0].at).toBe("2026-11-07 14:00:00");
  });
});

describe("janela da edição", () => {
  const w = checkinWindow({ startsAt: "2026-11-07", endsAt: "2026-11-08" });
  const now = new Date("2026-11-20T00:00:00Z");

  it("da véspera até 2 dias depois do fim", () => {
    expect(w.start.toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("horário do aparelho fora da janela é puxado pra borda; futuro vira agora; lixo vira agora", () => {
    expect(clampCheckinAt("2020-01-01T00:00:00Z", w, now).toISOString()).toBe(w.start.toISOString());
    expect(clampCheckinAt("2030-01-01T00:00:00Z", w, now).toISOString()).toBe(w.end.toISOString());
    expect(clampCheckinAt("2026-11-07T14:00:00Z", w, now).toISOString()).toBe("2026-11-07T14:00:00.000Z");
    const early = new Date("2026-11-07T10:00:00Z");
    expect(clampCheckinAt("2026-11-07T14:00:00Z", w, early).toISOString()).toBe(early.toISOString());
    expect(clampCheckinAt("ontem", w, early).toISOString()).toBe(early.toISOString());
  });
});
