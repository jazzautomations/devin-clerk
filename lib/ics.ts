// Gerador iCalendar (RFC 5545) da programação. Puro — sem banco.
//
// Fuso: DTSTART/DTEND em UTC com "Z" (forma 2 do §3.3.5), não TZID +
// VTIMEZONE. O banco já guarda UTC; todo cliente (Google, Apple, Outlook)
// converte pro fuso do aparelho; e um VTIMEZONE de America/Sao_Paulo teria
// que carregar as regras de horário de verão (extinto em 2019, mas pode
// voltar por decreto) — errar ali erra a hora de todo mundo. X-WR-TIMEZONE
// vai só como dica de exibição pro feed.

export type IcsEvent = {
  uid: string;
  /** "YYYY-MM-DD HH:MM:SS" UTC */
  startsAt: string;
  endsAt: string;
  /** última alteração ("YYYY-MM-DD HH:MM:SS" UTC) — vira DTSTAMP/LAST-MODIFIED */
  stamp: string;
  sequence?: number;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  categories?: string[];
};

export type IcsCalendar = {
  name?: string;
  events: IcsEvent[];
  /** feed assinável: o cliente rebusca nesse intervalo */
  refresh?: boolean;
};

const PRODID = "-//HackaHub//Programacao//PT-BR";

/** TEXT (§3.3.11): \ ; , e quebra de linha escapados */
export function escapeText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) → "YYYYMMDDTHHMMSSZ" */
export function icsUtc(dbText: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(dbText);
  if (!m) throw new Error(`data inválida pro .ics: ${dbText}`);
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`;
}

const enc = new TextEncoder();

/**
 * Dobra (§3.1): nenhuma linha passa de 75 octetos sem contar o CRLF; a
 * continuação começa com um espaço. Conta bytes UTF-8 e nunca corta um
 * caractere multibyte ao meio.
 */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = " ";
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

function eventLines(e: IcsEvent): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsUtc(e.stamp)}`,
    `LAST-MODIFIED:${icsUtc(e.stamp)}`,
    `DTSTART:${icsUtc(e.startsAt)}`,
    `DTEND:${icsUtc(e.endsAt)}`,
    `SEQUENCE:${e.sequence ?? 0}`,
    `SUMMARY:${escapeText(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`);
  lines.push("STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT");
  return lines;
}

export function buildIcs(cal: IcsCalendar): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (cal.name) lines.push(`X-WR-CALNAME:${escapeText(cal.name)}`, "X-WR-TIMEZONE:America/Sao_Paulo");
  if (cal.refresh) lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H");
  for (const e of cal.events) lines.push(...eventLines(e));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** link "adicionar ao Google Agenda" (template público, sem API) */
export function googleCalendarUrl(e: Pick<IcsEvent, "startsAt" | "endsAt" | "summary" | "description" | "location">): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.summary,
    dates: `${icsUtc(e.startsAt)}/${icsUtc(e.endsAt)}`,
    ctz: "America/Sao_Paulo",
  });
  if (e.description) p.set("details", e.description);
  if (e.location) p.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function icsResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "-")}"`,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
