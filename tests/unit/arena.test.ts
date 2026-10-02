import { describe, expect, it } from "vitest";
import type { Hackathon } from "@/lib/hackathons";
import {
  ARCHIVE_GRACE_MS,
  countdownParts,
  countdownTarget,
  editionPhase,
  LIVE_WINDOW_MS,
} from "@/lib/arena";

// spec 016 — arena ao vivo: fase derivada puramente de (hackathon, now).
// T0 é um instante arbitrário; as datas dos fixtures pendem dele.
const T0 = new Date("2026-10-02T12:00:00-03:00");
const iso = (msOffset: number) => new Date(T0.getTime() + msOffset).toISOString();
const H = 3_600_000;
const D = 24 * H;

function makeH(overrides: Partial<Hackathon> = {}): Hackathon {
  return {
    id: "h-test",
    name: "Test",
    organizer: "Org",
    startsAt: iso(10 * D), // daqui a 10 dias por padrão
    endsAt: null,
    format: "online",
    location: null,
    registrationUrl: "https://x.dev",
    registrationDeadline: null,
    tags: [],
    active: true,
    partner: true,
    ...overrides,
  };
}

describe("editionPhase — matriz de fases", () => {
  it("open: evento distante, sem deadline", () => {
    expect(editionPhase(makeH(), T0)).toBe("open");
  });

  it("open: deadline no futuro não muda a fase", () => {
    const h = makeH({ registrationDeadline: iso(5 * D) });
    expect(editionPhase(h, T0)).toBe("open");
  });

  it("closed-soon: deadline passado, evento ainda >48h", () => {
    const h = makeH({ registrationDeadline: iso(-1 * H) });
    expect(editionPhase(h, T0)).toBe("closed-soon");
  });

  it("closed-soon: deadline passado E evento ≤48h (fechado ganha do hype)", () => {
    const h = makeH({
      startsAt: iso(24 * H),
      registrationDeadline: iso(-1 * H),
    });
    expect(editionPhase(h, T0)).toBe("closed-soon");
  });

  it("live: startsAt - now < 48h com inscrição aberta (deadline null)", () => {
    expect(editionPhase(makeH({ startsAt: iso(24 * H) }), T0)).toBe("live");
  });

  it("live: deadline ainda no futuro não bloqueia", () => {
    const h = makeH({
      startsAt: iso(24 * H),
      registrationDeadline: iso(12 * H),
    });
    expect(editionPhase(h, T0)).toBe("live");
  });

  it("ended: startsAt já passou (evento rolando conta como arquivo)", () => {
    const h = makeH({ startsAt: iso(-1 * H), endsAt: iso(24 * H) });
    expect(editionPhase(h, T0)).toBe("ended");
  });

  it("ended: recém-terminado, dentro da grace de 7d", () => {
    const h = makeH({ startsAt: iso(-2 * D), endsAt: iso(-1 * D) });
    expect(editionPhase(h, T0)).toBe("ended");
  });

  it("archived: passou de endsAt + 7d", () => {
    const h = makeH({ startsAt: iso(-30 * D), endsAt: iso(-8 * D) });
    expect(editionPhase(h, T0)).toBe("archived");
  });

  it("archived: sem endsAt usa startsAt + 7d", () => {
    expect(editionPhase(makeH({ startsAt: iso(-8 * D) }), T0)).toBe(
      "archived",
    );
    expect(editionPhase(makeH({ startsAt: iso(-6 * D) }), T0)).toBe("ended");
  });
});

describe("editionPhase — boundaries", () => {
  it("startsAt - now === 48h exatas → live (janela inclusiva)", () => {
    const h = makeH({ startsAt: iso(LIVE_WINDOW_MS) });
    expect(editionPhase(h, T0)).toBe("live");
    expect(
      editionPhase(makeH({ startsAt: iso(LIVE_WINDOW_MS + 1) }), T0),
    ).toBe("open");
  });

  it("now === startsAt → ended (passou, não é mais live)", () => {
    const h = makeH({ startsAt: iso(0) });
    expect(editionPhase(h, T0)).toBe("ended");
    expect(editionPhase(h, new Date(T0.getTime() - 1))).toBe("live");
  });

  it("deadline === now → ainda aberto (fecha só com deadline < now)", () => {
    const h = makeH({ registrationDeadline: iso(0) });
    expect(editionPhase(h, T0)).toBe("open");
    expect(
      editionPhase(makeH({ registrationDeadline: iso(-1) }), T0),
    ).toBe("closed-soon");
  });

  it("endsAt + 7d exatos → ended; +1ms → archived", () => {
    const ends = iso(-ARCHIVE_GRACE_MS);
    expect(
      editionPhase(makeH({ startsAt: iso(-9 * D), endsAt: ends }), T0),
    ).toBe("ended");
    const endsBefore = iso(-ARCHIVE_GRACE_MS - 1);
    expect(
      editionPhase(
        makeH({ startsAt: iso(-9 * D), endsAt: endsBefore }),
        T0,
      ),
    ).toBe("archived");
  });
});

describe("countdownTarget — o alvo certo do relógio", () => {
  it("sem deadline → startsAt / 'start'", () => {
    expect(countdownTarget(makeH(), T0)).toEqual({
      iso: makeH().startsAt,
      kind: "start",
    });
  });

  it("deadline futuro anterior ao startsAt → deadline / 'deadline'", () => {
    const h = makeH({ registrationDeadline: iso(12 * H) });
    expect(countdownTarget(h, T0)).toEqual({
      iso: h.registrationDeadline,
      kind: "deadline",
    });
  });

  it("deadline passado → volta pro startsAt", () => {
    const h = makeH({ registrationDeadline: iso(-1 * H) });
    expect(countdownTarget(h, T0)?.kind).toBe("start");
  });

  it("deadline depois do startsAt → startsAt (nunca aponta além do evento)", () => {
    const h = makeH({
      startsAt: iso(10 * D),
      registrationDeadline: iso(11 * D),
    });
    expect(countdownTarget(h, T0)?.kind).toBe("start");
  });

  it("edição ended/archived → null (sem relógio no arquivo)", () => {
    expect(countdownTarget(makeH({ startsAt: iso(-1 * H) }), T0)).toBeNull();
    expect(countdownTarget(makeH({ startsAt: iso(-9 * D) }), T0)).toBeNull();
  });
});

describe("countdownParts", () => {
  it("decompõe 1d 2h 3m 4s exatos", () => {
    const target = new Date(T0.getTime() + D + 2 * H + 3 * 60_000 + 4_000);
    expect(countdownParts(target.toISOString(), T0)).toEqual({
      d: 1,
      h: 2,
      m: 3,
      s: 4,
    });
  });

  it("zero quando alvo === now; clamp em alvo passado", () => {
    expect(countdownParts(iso(0), T0)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
    expect(countdownParts(iso(-5 * D), T0)).toEqual({
      d: 0,
      h: 0,
      m: 0,
      s: 0,
    });
  });

  it("arredonda pra baixo (999ms não vira segundo)", () => {
    expect(countdownParts(iso(59_999), T0)).toEqual({
      d: 0,
      h: 0,
      m: 0,
      s: 59,
    });
  });

  it("dias grandes e alvo inválido → dígitos seguros", () => {
    const p = countdownParts(iso(100 * D), T0);
    expect(p.d).toBe(100);
    expect(countdownParts("não-é-data", T0)).toEqual({
      d: 0,
      h: 0,
      m: 0,
      s: 0,
    });
  });
});
