import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import db from "@/lib/db";
import { ticketToken } from "@/lib/checkins";

// Crachás em lote (roadmap 037 Onda 1 #5, 035 #7): PDF A4 pra folha de
// etiqueta adesiva comum de papelaria, impresso em qualquer impressora na
// véspera — nada de driver de impressora no check-in (lista "não fazer").
//
// Folha: Pimaco A4265 — A4, 8 etiquetas de 99,0 × 67,7 mm (2 colunas × 4
// linhas), mesma geometria da Avery L7165. Medidas usadas (mm):
//   margem superior 13,1 · margem lateral 4,65 · etiqueta 99,1 × 67,7
//   passo horizontal 101,6 (2,5 entre colunas) · passo vertical 67,7 (sem
//   espaço entre linhas). 4,65 + 101,6 + 99,1 + 4,65 = 210; 13,1 + 4 × 67,7
//   + 13,1 = 297. (A Pimaco 6180/6080 é folha Carta, não A4, e 25,4 mm de
//   altura não cabe um QR legível + nome.) Trocar de folha = trocar SHEET.
//
// Papel pela cor da faixa (participante verde, staff laranja, mentor azul,
// jurado roxo, organizador preto) + o nome do papel escrito na faixa — a cor
// nunca é a única pista. QR = o mesmo token do ingresso (só quem tem
// inscrição aprovada); QR desenhado em vetor, nítido em qualquer impressora.

export const BADGE_ROLES = ["participante", "staff", "mentor", "jurado", "organizador"] as const;
export type BadgeRole = (typeof BADGE_ROLES)[number];

export function isBadgeRole(v: unknown): v is BadgeRole {
  return typeof v === "string" && (BADGE_ROLES as readonly string[]).includes(v);
}

export type Badge = {
  memberId: number;
  name: string;
  username: string;
  role: BadgeRole;
  team: string | null;
  /** token do QR do ingresso; null = sem inscrição aprovada (só papel) */
  token: string | null;
};

// quem tem mais de um papel sai com o mais alto (organizador > … > participante)
const PRECEDENCE: Record<BadgeRole, number> = {
  organizador: 5,
  staff: 4,
  jurado: 3,
  mentor: 2,
  participante: 1,
};

export async function listBadges(hackathonId: string, role?: BadgeRole | null): Promise<Badge[]> {
  const rows = await db
    .prepare(
      `SELECT m.id AS memberId, m.name, m.username, r.id AS registrationId, r.status,
              (SELECT string_agg(er.role, ',') FROM edition_roles er
                WHERE er.hackathonId = @h AND er.memberId = m.id) AS roles,
              (SELECT t.name FROM team_members tm JOIN teams t ON t.id = tm.teamId
                WHERE t.hackathonId = @h AND tm.username = m.username
                ORDER BY t.id LIMIT 1) AS team
       FROM members m
       LEFT JOIN registrations r ON r.memberId = m.id AND r.hackathonId = @h
       WHERE (r.status = 'approved')
          OR EXISTS (SELECT 1 FROM edition_roles er WHERE er.hackathonId = @h AND er.memberId = m.id)`,
    )
    .all<{
      memberId: number;
      name: string | null;
      username: string;
      registrationId: number | null;
      status: string | null;
      roles: string | null;
      team: string | null;
    }>({ h: hackathonId });

  const badges = rows.map((r): Badge => {
    const roles = (r.roles ? r.roles.split(",") : []).filter(isBadgeRole);
    const top = roles.sort((a, b) => PRECEDENCE[b] - PRECEDENCE[a])[0] ?? "participante";
    const approved = r.status === "approved" && r.registrationId !== null;
    return {
      memberId: r.memberId,
      name: r.name?.trim() || `@${r.username}`,
      username: r.username,
      role: top,
      team: r.team,
      token: approved ? ticketToken(r.registrationId!) : null,
    };
  });
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
  return badges
    .filter((b) => !role || b.role === role)
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.username, b.username));
}

// ---------- PDF ----------

const MM = 72 / 25.4;
export const SHEET = {
  name: "Pimaco A4265 / Avery L7165 (A4, 8 por folha, 99 × 67,7 mm)",
  pageW: 210 * MM,
  pageH: 297 * MM,
  cols: 2,
  rows: 4,
  labelW: 99.1 * MM,
  labelH: 67.7 * MM,
  marginTop: 13.1 * MM,
  marginLeft: 4.65 * MM,
  pitchX: 101.6 * MM,
  pitchY: 67.7 * MM,
} as const;
export const PER_SHEET = SHEET.cols * SHEET.rows;

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = hex("#0c0c0c");
const PAPER = hex("#fefefe");
const MUTED = hex("#474747");
export const ROLE_COLOR: Record<BadgeRole, string> = {
  participante: "#047a43",
  staff: "#ba3919",
  mentor: "#1f4fbf",
  jurado: "#6b2fa3",
  organizador: "#0c0c0c",
};

const FONT_DIR = join(process.cwd(), "assets", "fonts");
let fontCache: Promise<{ bold: Uint8Array; regular: Uint8Array } | null> | null = null;
function archivoBytes() {
  fontCache ??= Promise.all([
    readFile(join(FONT_DIR, "archivo-latin-800-normal.woff")),
    readFile(join(FONT_DIR, "archivo-latin-400-normal.woff")),
  ])
    .then(([bold, regular]) => ({ bold: new Uint8Array(bold), regular: new Uint8Array(regular) }))
    .catch(() => null);
  return fontCache;
}

/** fonte subset latin: o que não for Latin-1 perde o acento ou some (nunca quebra o PDF) */
export function printable(s: string): string {
  return [...s.normalize("NFC")]
    .map((ch) => {
      if (ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0xff && ch.length === 1) return ch;
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      return /^[\x20-\xff]+$/.test(base) ? base : "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function fit(font: PDFFont, text: string, max: number, width: number, min = 7): number {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
  return size;
}

function ellipsize(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** quebra gulosa por palavra; palavra maior que a linha fica sozinha */
function wrapWords(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Nome no maior tamanho (22 → 11pt) que cabe em até 3 linhas sem cortar
 * palavra. Nome enorme: 11pt, 3 linhas, reticências só no fim.
 */
function nameLines(font: PDFFont, name: string, width: number): { lines: string[]; size: number } {
  for (let size = 22; size >= 11; size -= 1) {
    const lines = wrapWords(font, name, size, width);
    const maxLines = size >= 18 ? 2 : 3;
    if (lines.length <= maxLines && lines.every((l) => font.widthOfTextAtSize(l, size) <= width)) {
      return { lines, size };
    }
  }
  const lines = wrapWords(font, name, 11, width);
  const kept = lines.slice(0, 3);
  if (lines.length > 3) kept[2] = `${kept[2]} ${lines.slice(3).join(" ")}`;
  return { lines: kept.map((l) => ellipsize(font, l, 11, width)), size: 11 };
}

function drawQr(page: PDFPage, token: string, x: number, y: number, size: number) {
  const qr = QRCode.create(token, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: PAPER });
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!qr.modules.get(row, col)) continue;
      page.drawRectangle({
        x: x + (col + quiet) * cell,
        // PDF cresce pra cima: linha 0 do QR fica no topo
        y: y + size - (row + quiet + 1) * cell,
        width: cell + 0.01,
        height: cell + 0.01,
        color: INK,
      });
    }
  }
}

export const ROLE_LABEL: Record<BadgeRole, string> = {
  participante: "participante",
  staff: "staff",
  mentor: "mentoria",
  jurado: "júri",
  organizador: "organização",
};

export async function badgesPdf(
  badges: Badge[],
  opts: { hackathonName: string; guides?: boolean },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Crachás — ${opts.hackathonName}`);
  pdf.setAuthor("Hack Inova · HackaHub");
  pdf.setSubject(`Folha ${SHEET.name}`);
  pdf.setCreationDate(new Date());

  const bytes = await archivoBytes();
  let bold: PDFFont;
  let regular: PDFFont;
  if (bytes) {
    pdf.registerFontkit(fontkit);
    bold = await pdf.embedFont(bytes.bold, { subset: true });
    regular = await pdf.embedFont(bytes.regular, { subset: true });
  } else {
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    regular = await pdf.embedFont(StandardFonts.Helvetica);
  }
  const mono = await pdf.embedFont(StandardFonts.CourierBold);
  const edition = printable(opts.hackathonName);

  const pages = Math.max(1, Math.ceil(badges.length / PER_SHEET));
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([SHEET.pageW, SHEET.pageH]);
    badges.slice(p * PER_SHEET, (p + 1) * PER_SHEET).forEach((b, i) => {
      const col = i % SHEET.cols;
      const row = Math.floor(i / SHEET.cols);
      const x = SHEET.marginLeft + col * SHEET.pitchX;
      const y = SHEET.pageH - SHEET.marginTop - row * SHEET.pitchY - SHEET.labelH;
      drawBadge(page, b, x, y, { bold, regular, mono, edition, guides: !!opts.guides });
    });
  }
  return pdf.save();
}

function drawBadge(
  page: PDFPage,
  b: Badge,
  x: number,
  y: number,
  f: { bold: PDFFont; regular: PDFFont; mono: PDFFont; edition: string; guides: boolean },
) {
  const W = SHEET.labelW;
  const H = SHEET.labelH;
  const pad = 4 * MM; // respiro: o corte da etiqueta não é perfeito
  const color = hex(ROLE_COLOR[b.role]);
  if (f.guides) {
    page.drawRectangle({ x, y, width: W, height: H, borderColor: hex("#9a9a9a"), borderWidth: 0.4 });
  }
  // faixa do papel no topo
  const bandH = 8 * MM;
  page.drawRectangle({ x, y: y + H - bandH, width: W, height: bandH, color });
  const roleTxt = ROLE_LABEL[b.role].toUpperCase();
  page.drawText(roleTxt, { x: x + pad, y: y + H - bandH + 2.6 * MM, size: 10, font: f.mono, color: PAPER });
  const ed = ellipsize(f.mono, f.edition.toUpperCase(), 7, W * 0.5);
  page.drawText(ed, {
    x: x + W - pad - f.mono.widthOfTextAtSize(ed, 7),
    y: y + H - bandH + 2.9 * MM,
    size: 7,
    font: f.mono,
    color: PAPER,
  });

  const qrSize = b.token ? H - bandH - 2 * pad + 2 * MM : 0;
  const textW = W - 2 * pad - (b.token ? qrSize + 3 * MM : 0);
  if (b.token) drawQr(page, b.token, x + W - pad - qrSize + 1 * MM, y + pad - 1 * MM, qrSize);

  // nome (até 2 linhas), @username, time
  const name = printable(b.name) || `@${b.username}`;
  const { lines, size } = nameLines(f.bold, name, textW);
  let ty = y + H - bandH - pad - size;
  for (const line of lines) {
    page.drawText(line, { x: x + pad, y: ty, size, font: f.bold, color: INK });
    ty -= size * 1.08;
  }
  const user = ellipsize(f.regular, `@${printable(b.username)}`, 9, textW);
  page.drawText(user, { x: x + pad, y: ty - 2, size: 9, font: f.regular, color: MUTED });

  if (b.team) {
    const team = printable(b.team);
    const teamSize = fit(f.bold, team, 11, textW - 8, 8);
    const teamTxt = ellipsize(f.bold, team, teamSize, textW - 8);
    const tagY = y + pad;
    page.drawText("TIME", { x: x + pad, y: tagY + 13, size: 6.5, font: f.mono, color: MUTED });
    page.drawRectangle({ x: x + pad, y: tagY, width: 3, height: 11, color });
    page.drawText(teamTxt, { x: x + pad + 6, y: tagY + 2, size: teamSize, font: f.bold, color: INK });
  }
}
