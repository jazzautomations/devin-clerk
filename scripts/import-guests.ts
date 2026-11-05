/**
 * Importa convidados (CSV do Luma ou planilha) como inscritos aprovados.
 *
 * Uso:
 *   npx tsx scripts/import-guests.ts lista.csv blis-sanfran-2026          # dry-run
 *   npx tsx scripts/import-guests.ts lista.csv blis-sanfran-2026 --apply  # aplica
 *
 * O CSV precisa ter uma coluna de e-mail (cabeçalho com "email"/"e-mail") e,
 * se tiver, uma de nome ("name"/"nome"). Sem cabeçalho reconhecível, tenta a
 * primeira coluna com cara de e-mail.
 */
import { readFileSync } from "node:fs";
import { importGuests, normalizeGuestEmail } from "../lib/guestImport";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseGuestsCsv(text: string): { email: string; name: string | null }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  let emailIdx = header.findIndex((h) => /e-?mail/.test(h));
  let nameIdx = header.findIndex((h) => /^(name|nome)/.test(h));
  const start = emailIdx >= 0 ? 1 : 0;
  if (emailIdx < 0) {
    emailIdx = parseCsvLine(lines[0]).findIndex((c) => normalizeGuestEmail(c));
    if (emailIdx < 0) throw new Error("CSV sem coluna de e-mail");
  }
  const rows: { email: string; name: string | null }[] = [];
  for (const line of lines.slice(start)) {
    const cols = parseCsvLine(line);
    const email = cols[emailIdx] ?? "";
    if (!email) continue;
    const name = nameIdx >= 0 ? (cols[nameIdx] || null) : null;
    rows.push({ email, name });
  }
  return rows;
}

async function main() {
  const [file, hackathonId, flag] = process.argv.slice(2);
  if (!file || !hackathonId) {
    console.error("uso: npx tsx scripts/import-guests.ts <csv> <hackathonId> [--apply]");
    process.exit(1);
  }
  const rows = parseGuestsCsv(readFileSync(file, "utf8"));
  const apply = flag === "--apply";
  console.log(`${rows.length} linhas no CSV · edição ${hackathonId} · ${apply ? "APLICANDO" : "dry-run"}`);
  const result = await importGuests(hackathonId, rows, { dryRun: !apply });
  console.log(`importados: ${result.imported.length}`);
  for (const r of result.imported) {
    console.log(`  ${r.email} → ${r.memberCreated ? "membro novo" : "membro existente"} ${r.username || ""}`);
  }
  if (result.skipped.length) {
    console.log(`pulados: ${result.skipped.length}`);
    for (const s of result.skipped) console.log(`  ${s.email}: ${s.reason}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("erro:", e.message);
  process.exit(1);
});
