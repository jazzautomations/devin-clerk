import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { CERT_KIND_LABEL, formatCertDate, type Certificate } from "@/lib/certificates";

// PDF do certificado, gerado sob demanda (nada guardado em disco): A4
// paisagem no sistema da Hack Inova — papel, tinta, verde de ação, fios
// retos, Archivo nos títulos (assets/fonts, OFL), mono nos dados.

const PAPER = rgb(0xfe / 255, 0xfe / 255, 0xfe / 255);
const INK = rgb(0x0c / 255, 0x0c / 255, 0x0c / 255);
const MUTED = rgb(0x47 / 255, 0x47 / 255, 0x47 / 255);
const GREEN = rgb(0x04 / 255, 0x7a / 255, 0x43 / 255);
const MINT = rgb(0xd8 / 255, 0xf4 / 255, 0xe5 / 255);

const W = 841.89;
const H = 595.28;
const M = 44; // margem do fio externo

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

function statement(c: Certificate): string {
  switch (c.kind) {
    case "participacao":
      return "participou de";
    case "mentoria":
      return "atuou na mentoria de";
    case "jurado":
      return "integrou o júri de";
    case "organizacao":
      return c.detail ? `fez parte da organização (${c.detail}) de` : "fez parte da organização de";
    case "premiacao":
      return c.detail ? `conquistou o ${c.detail} em` : "recebeu premiação em";
  }
}

function fitSize(font: PDFFont, text: string, max: number, width: number, min = 18) {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > width) size -= 1;
  return size;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function label(page: PDFPage, font: PDFFont, text: string, x: number, y: number, color = MUTED, size = 9) {
  page.drawText(text.toUpperCase(), { x, y, size, font, color });
}

export async function certificatePdf(c: Certificate, baseUrl: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificado ${CERT_KIND_LABEL[c.kind]} — ${c.hackathonName}`);
  pdf.setAuthor("Hack Inova · HackaHub");
  pdf.setSubject(`Verificação: ${baseUrl}/c/${c.code}`);
  pdf.setCreationDate(new Date());

  const bytes = await archivoBytes();
  let title: PDFFont;
  let body: PDFFont;
  if (bytes) {
    pdf.registerFontkit(fontkit);
    title = await pdf.embedFont(bytes.bold, { subset: true });
    body = await pdf.embedFont(bytes.regular, { subset: true });
  } else {
    title = await pdf.embedFont(StandardFonts.HelveticaBold);
    body = await pdf.embedFont(StandardFonts.Helvetica);
  }
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const monoBold = await pdf.embedFont(StandardFonts.CourierBold);

  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });
  // fio externo + faixa verde de ação à esquerda
  page.drawRectangle({ x: M, y: M, width: W - 2 * M, height: H - 2 * M, borderColor: INK, borderWidth: 1.5 });
  page.drawRectangle({ x: M, y: M, width: 14, height: H - 2 * M, color: GREEN });

  const left = M + 14 + 40;
  const right = W - M - 40;
  const width = right - left;

  // barra de título estilo .tbar
  const top = H - M;
  page.drawRectangle({ x: M + 14, y: top - 30, width: W - 2 * M - 14, height: 30, color: INK });
  label(page, monoBold, "hack inova · hackahub", left, top - 19.5, PAPER, 9.5);
  const kindTxt = `certificado · ${CERT_KIND_LABEL[c.kind]}`;
  page.drawText(kindTxt.toUpperCase(), {
    x: right - monoBold.widthOfTextAtSize(kindTxt.toUpperCase(), 9.5),
    y: top - 19.5,
    size: 9.5,
    font: monoBold,
    color: PAPER,
  });

  let y = top - 30 - 74;
  page.drawText("Certificado", { x: left, y, size: 58, font: title, color: INK });
  y -= 30;
  page.drawText(`de ${CERT_KIND_LABEL[c.kind]}`, { x: left + 2, y, size: 22, font: title, color: GREEN });

  y -= 58;
  label(page, mono, "certificamos que", left, y);
  y -= 46;
  const nameSize = fitSize(title, c.memberName, 44, width);
  page.drawText(c.memberName, { x: left, y, size: nameSize, font: title, color: INK });
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: INK });

  y -= 30;
  const where = c.location ? `, em ${c.location}` : "";
  const sentence = `${statement(c)} ${c.hackathonName}, realizada em ${formatCertDate(c.startsAt)}${where}.`;
  for (const line of wrap(body, sentence, 17, width).slice(0, 3)) {
    page.drawText(line, { x: left, y, size: 17, font: body, color: INK });
    y -= 24;
  }

  // rodapé: ficha técnica com código e link de verificação
  const fy = M + 26;
  const boxH = 62;
  page.drawRectangle({ x: left, y: fy, width, height: boxH, color: MINT, borderColor: INK, borderWidth: 1 });
  const col = width / 3;
  const cells: [string, string, PDFFont, number][] = [
    ["código", c.code, monoBold, 15],
    ["emitido em", formatCertDate(c.issuedAt), mono, 11],
    ["verifique em", `${baseUrl.replace(/^https?:\/\//, "")}/c/${c.code}`, mono, 9.5],
  ];
  cells.forEach(([k, v, f, size], i) => {
    const x = left + col * i + 14;
    if (i > 0) {
      page.drawLine({ start: { x: left + col * i, y: fy }, end: { x: left + col * i, y: fy + boxH }, thickness: 1, color: INK });
    }
    label(page, mono, k, x, fy + boxH - 20, MUTED, 8);
    const fitted = fitSize(f, v, size, col - 24, 6);
    page.drawText(v, { x, y: fy + 16, size: fitted, font: f, color: i === 0 ? GREEN : INK });
  });

  return pdf.save();
}
