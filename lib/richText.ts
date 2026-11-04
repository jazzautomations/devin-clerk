import { normalizeTech } from "@/lib/techTags";

// Texto do post e do comentário em pedaços (spec 046, onda 2, mencoes-e-tags).
// Módulo PURO: sem banco, sem DOM — roda no servidor (syncMentionsAndTags) e
// no navegador (components/RichText.tsx). Por isso ele não importa
// lib/members.ts (que puxa o banco): o padrão do @ é repetido aqui e
// tests/unit/rich-text.test.ts confere que ele continua igual ao USERNAME_RE.
//
// - menção: @usuario, sem letra colada antes (e-mail não vira menção);
// - tag: #tag, minúscula, sem acento, passando por normalizeTech quando bater
//   com apelido de stack (#NextJS e #next.js viram a mesma tag nextjs);
// - url: http(s) inteira, pra não pescar @ e # de dentro dela.
//
// O texto continua sendo texto: nada de HTML guardado, nada de innerHTML.

export type RichSegmentType = "text" | "mention" | "tag" | "url";
export type RichSegment = { t: RichSegmentType; v: string };

/** mesmo padrão do USERNAME_RE (lib/members.ts), sem as âncoras */
const USERNAME_SRC = "[a-z0-9_]{3,20}";
/** @ só vale no começo de palavra: "fulano@exemplo.com" não é menção */
const NOT_GLUED_BEFORE = "[\\p{L}\\p{N}_.%+-]";
/** # também não nasce colada em letra ("C#", "cor#tag") */
const NOT_GLUED_BEFORE_TAG = "[\\p{L}\\p{N}_]";

const SCAN = new RegExp(
  // 1: url  2: menção  3: tag
  `(https?:\\/\\/[^\\s<>"'\`]+)` +
    `|(?<!${NOT_GLUED_BEFORE})@(${USERNAME_SRC})` +
    `|(?<!${NOT_GLUED_BEFORE_TAG})#([\\p{L}\\p{N}][\\p{L}\\p{N}_.+#-]*)`,
  "giu",
);

/** ponto e hífen sobrando no fim da tag são do texto, não da tag ("#ia.") */
const TRAILING = /[.\-]+$/;

/** menções e tags guardadas/notificadas por post: até 5 de cada */
export const MENTION_LIMIT = 5;
export const TAG_LIMIT = 5;

const pushText = (out: RichSegment[], v: string) => {
  if (v) out.push({ t: "text", v });
};

/**
 * Texto → segmentos, cobrindo a string inteira (o que não casa vira texto).
 * Menção sai com o @ em minúsculas; tag sai já normalizada.
 */
export function parseRich(body: string): RichSegment[] {
  const text = typeof body === "string" ? body : "";
  if (!text) return [];
  const out: RichSegment[] = [];
  const re = new RegExp(SCAN.source, SCAN.flags);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    if (m[1]) {
      pushText(out, text.slice(last, start));
      out.push({ t: "url", v: m[1] });
      last = start + m[1].length;
      continue;
    }
    if (m[2]) {
      // @ana1234 é outro usuário, não a menção de @ana: se o caractere
      // seguinte continua a palavra, não é menção (mesma regra do USERNAME_RE)
      const end = start + m[0].length;
      if (/[a-z0-9_]/i.test(text[end] ?? "")) {
        pushText(out, text.slice(last, end));
        last = end;
        continue;
      }
      pushText(out, text.slice(last, start));
      out.push({ t: "mention", v: m[2].toLowerCase() });
      last = end;
      continue;
    }
    // tag: o "." e o "-" do fim ficam no texto ("#ia." vira tag ia + ".")
    const raw = m[3].replace(TRAILING, "");
    const tag = raw.length >= 2 ? normalizeTech(raw) : null;
    if (!tag || tag.length < 2) {
      // "#" que não é tag: o "#" volta pro texto e a varredura segue depois dele
      pushText(out, text.slice(last, start + 1));
      last = start + 1;
      re.lastIndex = last;
      continue;
    }
    pushText(out, text.slice(last, start));
    out.push({ t: "tag", v: tag });
    last = start + 1 + raw.length;
    re.lastIndex = last;
  }
  pushText(out, text.slice(last));
  return out;
}

/**
 * @ mencionados, únicos, na ordem em que aparecem, até 5. É esta lista que
 * lib/tags.ts resolve no banco: quem não existe, foi excluído ou tem
 * bloqueio com quem escreveu não é gravado nem notificado.
 */
export function extractMentions(body: string): string[] {
  const out: string[] = [];
  for (const s of parseRich(body)) {
    if (s.t !== "mention" || out.includes(s.v)) continue;
    if (out.length >= MENTION_LIMIT) break;
    out.push(s.v);
  }
  return out;
}

/** # tags, únicas e normalizadas, até 5 */
export function extractTags(body: string): string[] {
  const out: string[] = [];
  for (const s of parseRich(body)) {
    if (s.t !== "tag" || out.includes(s.v)) continue;
    if (out.length >= TAG_LIMIT) break;
    out.push(s.v);
  }
  return out;
}

/** só as menções que existem de verdade, pra virar link no card */
export function mentionedSet(usernames: string[] | null | undefined): Set<string> {
  return new Set((usernames ?? []).filter((u) => typeof u === "string" && u));
}
