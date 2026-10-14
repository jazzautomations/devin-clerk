import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, googleCalendarUrl, icsUtc } from "@/lib/ics";

// Gerador RFC 5545 da programação (roadmap 037 #4).

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** desdobra (§3.1) e devolve as linhas lógicas */
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);

describe("escapeText (§3.3.11)", () => {
  it("escapa vírgula, ponto-e-vírgula, barra invertida e quebra de linha", () => {
    expect(escapeText("Almoço; pizza, refri")).toBe("Almoço\\; pizza\\, refri");
    expect(escapeText("C:\\dir")).toBe("C:\\\\dir");
    expect(escapeText("linha 1\nlinha 2\r\nlinha 3")).toBe("linha 1\\nlinha 2\\nlinha 3");
    // barra primeiro: não reescapa o que acabou de escapar
    expect(escapeText("\\;")).toBe("\\\\\\;");
  });
});

describe("foldLine (§3.1)", () => {
  it("linha curta passa intacta", () => {
    expect(foldLine("SUMMARY:curta")).toBe("SUMMARY:curta");
  });

  it("dobra em 75 octetos com CRLF + espaço e não perde conteúdo", () => {
    const line = `DESCRIPTION:${"a".repeat(200)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("conta bytes UTF-8 e nunca corta caractere multibyte", () => {
    const line = `SUMMARY:${"ção ".repeat(40)}🍕🍕🍕`;
    const folded = foldLine(line);
    for (const p of folded.split("\r\n")) {
      expect(bytes(p)).toBeLessThanOrEqual(75);
      expect(p).not.toContain("\uFFFD");
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("buildIcs", () => {
  const ev = {
    uid: "programacao-7-ed@hackahub.dev",
    startsAt: "2026-11-14 12:00:00",
    endsAt: "2026-11-14 13:30:00",
    stamp: "2026-10-01 10:00:00",
    sequence: 2,
    summary: "Almoço, café; e mais",
    description: "Refeitório do bloco B.\nTraga o crachá.",
    location: "Refeitório, bloco B",
    url: "https://hackahub.dev/h/ed/programacao#item-7",
    categories: ["refeição"],
  };

  it("monta VCALENDAR/VEVENT válido com CRLF, UTC com Z e UID/DTSTAMP", () => {
    const ics = buildIcs({ name: "Ed — programação", refresh: true, events: [ev] });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n/);
    const lines = unfold(ics);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.some((l) => l.startsWith("PRODID:"))).toBe(true);
    expect(lines).toContain("UID:programacao-7-ed@hackahub.dev");
    expect(lines).toContain("DTSTAMP:20261001T100000Z");
    expect(lines).toContain("DTSTART:20261114T120000Z");
    expect(lines).toContain("DTEND:20261114T133000Z");
    expect(lines).toContain("SEQUENCE:2");
    expect(lines).toContain("SUMMARY:Almoço\\, café\\; e mais");
    expect(lines).toContain("DESCRIPTION:Refeitório do bloco B.\\nTraga o crachá.");
    expect(lines).toContain("LOCATION:Refeitório\\, bloco B");
    expect(lines).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    for (const raw of ics.split("\r\n")) expect(bytes(raw)).toBeLessThanOrEqual(75);
  });

  it("mesmo item gera o mesmo UID (estável entre downloads)", () => {
    const a = unfold(buildIcs({ events: [ev] })).find((l) => l.startsWith("UID:"));
    const b = unfold(buildIcs({ events: [{ ...ev, summary: "outro título" }] })).find((l) => l.startsWith("UID:"));
    expect(a).toBe(b);
  });

  it("calendário vazio ainda é válido", () => {
    const lines = unfold(buildIcs({ events: [] }));
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
  });

  it("icsUtc recusa data fora do formato", () => {
    expect(() => icsUtc("amanhã")).toThrow();
  });
});

describe("googleCalendarUrl", () => {
  it("monta o link template com datas UTC e fuso de São Paulo", () => {
    const u = new URL(
      googleCalendarUrl({
        startsAt: "2026-11-14 12:00:00",
        endsAt: "2026-11-14 13:00:00",
        summary: "Abertura & regras",
        location: "Auditório",
      }),
    );
    expect(u.hostname).toBe("calendar.google.com");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("text")).toBe("Abertura & regras");
    expect(u.searchParams.get("dates")).toBe("20261114T120000Z/20261114T130000Z");
    expect(u.searchParams.get("ctz")).toBe("America/Sao_Paulo");
    expect(u.searchParams.get("location")).toBe("Auditório");
  });
});
