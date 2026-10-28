import { describe, expect, it } from "vitest";
import {
  EMBED_SANDBOX,
  embedSrc,
  fmtMeetupRange,
  isEmbedWindow,
  isMeetupOver,
  meetupEnd,
  meetupIdParam,
  parseMeetupInput,
  toDbUtc,
  toEmbedUrl,
} from "@/lib/meetups";

// Conversor da live embutida da agenda (migration 051): só YouTube e Twitch
// viram iframe; o resto é null (a rota responde 400). E as regras de tempo
// (janela da live, "já rolou") e a validação do formulário.

describe("toEmbedUrl: YouTube", () => {
  const ID = "dQw4w9WgXcQ";
  const canon = `https://www.youtube.com/embed/${ID}`;
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=30s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])("%s → embed canônico", (raw) => {
    expect(toEmbedUrl(raw)).toBe(canon);
  });

  it.each([
    "https://www.youtube.com/watch?v=curto",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/channel/UCabc",
    "https://www.youtube.com/@canal",
    `https://youtu.be/${ID}/extra`,
    `https://www.youtube-nocookie.com/watch?v=${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
  ])("%s → null", (raw) => {
    expect(toEmbedUrl(raw)).toBeNull();
  });
});

describe("toEmbedUrl: Twitch", () => {
  it.each([
    ["https://www.twitch.tv/HackClubBR", "https://player.twitch.tv/?channel=hackclubbr"],
    ["https://twitch.tv/canal_dev", "https://player.twitch.tv/?channel=canal_dev"],
    ["https://m.twitch.tv/canal_dev", "https://player.twitch.tv/?channel=canal_dev"],
    ["https://www.twitch.tv/videos/123456789", "https://player.twitch.tv/?video=v123456789"],
    ["https://player.twitch.tv/?channel=canal_dev&parent=outro.com", "https://player.twitch.tv/?channel=canal_dev"],
    ["https://player.twitch.tv/?video=v123456789", "https://player.twitch.tv/?video=v123456789"],
    ["https://player.twitch.tv/?video=123456789", "https://player.twitch.tv/?video=v123456789"],
  ])("%s → %s", (raw, canon) => {
    expect(toEmbedUrl(raw)).toBe(canon);
  });

  it.each([
    "https://www.twitch.tv/directory",
    "https://www.twitch.tv/videos/abc",
    "https://www.twitch.tv/canal/clip/xyz",
    "https://www.twitch.tv/",
    "https://player.twitch.tv/?channel=a",
    "https://player.twitch.tv/?channel=canal&video=v123456",
    "https://player.twitch.tv/outra?channel=canal",
  ])("%s → null", (raw) => {
    expect(toEmbedUrl(raw)).toBeNull();
  });
});

describe("toEmbedUrl: domínio estranho", () => {
  it.each([
    "https://vimeo.com/123456",
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://evil.com/?u=https://youtu.be/dQw4w9WgXcQ",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    "",
    "   ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ com espaço",
  ])("%s → null", (raw) => {
    expect(toEmbedUrl(raw)).toBeNull();
  });
  it("não string → null", () => {
    expect(toEmbedUrl(undefined)).toBeNull();
    expect(toEmbedUrl(42)).toBeNull();
    expect(toEmbedUrl({ url: "https://youtu.be/dQw4w9WgXcQ" })).toBeNull();
  });
});

describe("embedSrc", () => {
  it("YouTube sai como está; Twitch ganha o parent do domínio, sem porta", () => {
    expect(embedSrc("https://www.youtube.com/embed/dQw4w9WgXcQ", "hackahub.dev")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(embedSrc("https://player.twitch.tv/?channel=canal_dev", "hackahub.jazzautomations.com.br")).toBe(
      "https://player.twitch.tv/?channel=canal_dev&parent=hackahub.jazzautomations.com.br",
    );
    expect(embedSrc("https://player.twitch.tv/?video=v123456", "localhost:3100")).toBe("https://player.twitch.tv/?video=v123456&parent=localhost");
  });
  it("revalida o que veio do banco: não canônico ou estranho é null", () => {
    expect(embedSrc(null, "x.com")).toBeNull();
    expect(embedSrc("https://evil.com/embed", "x.com")).toBeNull();
    expect(embedSrc("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "x.com")).toBeNull();
    expect(embedSrc("https://player.twitch.tv/?channel=canal_dev", "x.com&parent=evil.com")).toBeNull();
  });
  it("sandbox não deixa o iframe navegar a página nem abrir popup", () => {
    expect(EMBED_SANDBOX).not.toMatch(/top-navigation|popups|forms/);
  });
});

describe("tempo do evento", () => {
  const m = { startsAt: "2026-11-12 22:00:00", endsAt: "2026-11-13 00:00:00" };
  it("janela da live: 15 min antes até o fim", () => {
    expect(isEmbedWindow(m, new Date("2026-11-12T21:44:00Z"))).toBe(false);
    expect(isEmbedWindow(m, new Date("2026-11-12T21:45:00Z"))).toBe(true);
    expect(isEmbedWindow(m, new Date("2026-11-13T00:00:00Z"))).toBe(true);
    expect(isEmbedWindow(m, new Date("2026-11-13T00:00:01Z"))).toBe(false);
  });
  it("sem fim: dura 2h", () => {
    const s = { startsAt: "2026-11-12 22:00:00", endsAt: null };
    expect(meetupEnd(s).toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(isMeetupOver(s, new Date("2026-11-12T23:59:00Z"))).toBe(false);
    expect(isMeetupOver(s, new Date("2026-11-13T00:01:00Z"))).toBe(true);
  });
  it("mostra em Brasília", () => {
    expect(fmtMeetupRange(m)).toMatch(/12.*nov.*19:00 até 21:00/);
    expect(toDbUtc(new Date("2026-11-12T22:00:00.000Z"))).toBe("2026-11-12 22:00:00");
  });
  it("id da rota", () => {
    expect(meetupIdParam("12")).toBe(12);
    expect(meetupIdParam("0")).toBeNull();
    expect(meetupIdParam("1e3")).toBeNull();
    expect(meetupIdParam("../1")).toBeNull();
  });
});

describe("parseMeetupInput", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const base = { kind: "meetup", title: "Rust na prática", startsAt: "2026-11-12T19:00", location: "UFPE, Recife" };
  const ok = (b: Record<string, unknown>) => {
    const r = parseMeetupInput(b, { now });
    if ("error" in r) throw new Error(r.error);
    return r.value;
  };
  const err = (b: Record<string, unknown>) => {
    const r = parseMeetupInput(b, { now });
    return "error" in r ? r.error : null;
  };

  it("horário do formulário é Brasília e sai em UTC", () => {
    const v = ok({ ...base, endsAt: "2026-11-12T21:30" });
    expect(v.startsAt).toBe("2026-11-12 22:00:00");
    expect(v.endsAt).toBe("2026-11-13 00:30:00");
  });
  it("live converte o link; domínio estranho é erro", () => {
    expect(ok({ ...base, kind: "live", location: "", embedUrl: "https://youtu.be/dQw4w9WgXcQ" }).embedUrl).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
    expect(err({ ...base, embedUrl: "https://vimeo.com/1" })).toMatch(/YouTube ou da Twitch/);
  });
  it("regras de campo", () => {
    expect(err({ ...base, kind: "festa" })).toMatch(/tipo/);
    expect(err({ ...base, title: "oi" })).toMatch(/título/);
    expect(err({ ...base, title: "x".repeat(101) })).toMatch(/título/);
    // conta como o Postgres (code points): "🚀🚀" tem length 4 no JS e 2 no banco
    expect(err({ ...base, title: "🚀🚀" })).toMatch(/título/);
    expect(ok({ ...base, title: "🚀".repeat(100) }).title).toBe("🚀".repeat(100));
    expect(err({ ...base, title: "🚀".repeat(101) })).toMatch(/título/);
    expect(ok({ ...base, description: "🚀".repeat(3000) }).description).toHaveLength(6000);
    expect(err({ ...base, description: "x".repeat(3001) })).toMatch(/3000/);
    expect(err({ ...base, startsAt: "" })).toMatch(/quando começa/);
    expect(err({ ...base, startsAt: "amanhã" })).toMatch(/seletor/);
    expect(err({ ...base, startsAt: "2026-10-01T19:00" })).toMatch(/já passou/);
    expect(err({ ...base, endsAt: "2026-11-12T18:00" })).toMatch(/depois do início/);
    expect(err({ ...base, endsAt: "2026-11-20T18:00" })).toMatch(/72 horas/);
    expect(err({ ...base, location: "" })).toMatch(/onde vai ser/);
    expect(err({ ...base, onlineUrl: "http://meet.google.com/x" })).toMatch(/https/);
    expect(err({ ...base, capacity: "0" })).toMatch(/Vagas/);
    expect(err({ ...base, capacity: "2.5" })).toMatch(/Vagas/);
    expect(err({ ...base, hosts: "@a @b @c @d @e @f" })).toMatch(/Até 5/);
    expect(err({ ...base, hosts: "@ana; DROP" })).toMatch(/@ da pessoa/);
  });
  it("vagas e quem conduz normalizados", () => {
    const v = ok({ ...base, capacity: "40", hosts: "@Ana, @joao @ana" });
    expect(v.capacity).toBe(40);
    expect(v.hosts).toEqual(["ana", "joao"]);
  });
  it("na edição, início que não mudou pode estar no passado", () => {
    const r = parseMeetupInput({ ...base, startsAt: "2026-10-01T19:00" }, { now, current: { startsAt: "2026-10-01 22:00:00" } });
    expect("error" in r).toBe(false);
  });
});
