import db from "@/lib/db";
import { getHackathon, type Hackathon } from "@/lib/hackathons";

// schema próprio (idempotente) — não edita lib/db.ts (pattern lib/leads.ts).
// Terceira origem do radar: a comunidade indica, a curadoria decide — a
// indicação nunca alimenta listagem pública direto.
db.exec(`CREATE TABLE IF NOT EXISTS event_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  startsAt TEXT,
  location TEXT,
  format TEXT NOT NULL DEFAULT 'online'
    CHECK (format IN ('online','presencial','hibrido')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  createdAt TEXT NOT NULL,
  reviewedAt TEXT
)`);
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_event_submissions_url_recent
   ON event_submissions(url, createdAt)`,
);

export type SubmissionFormat = "online" | "presencial" | "hibrido";
export const SUBMISSION_FORMATS: SubmissionFormat[] = [
  "online",
  "presencial",
  "hibrido",
];
export type SubmissionStatus = "pending" | "approved" | "rejected";

export type EventSubmission = {
  id: number;
  name: string;
  url: string;
  startsAt: string | null;
  location: string | null;
  format: SubmissionFormat;
  note: string | null;
  status: SubmissionStatus;
  createdAt: string;
  reviewedAt: string | null;
};

// rate-limit-lite: mesma url dentro da janela é retry — não indicação nova.
// Janela mais larga que a de leads (10min): re-indicar amanhã é legítimo,
// mas duplo clique/refresh não pode sujar a fila.
export const SUBMISSION_DEDUPE_MS = 24 * 60 * 60 * 1000;

// hackathons.startsAt é NOT NULL e quem indica pode não saber a data —
// aprovado sem data nasce no fim da agenda e o admin corrige na edição.
export const NO_DATE_SENTINEL = "2099-12-31T00:00:00.000Z";

const opt = (v?: string | null) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function createSubmission(input: {
  name: string;
  url: string;
  startsAt?: string | null;
  location?: string | null;
  format?: string;
  note?: string | null;
}): { submission: EventSubmission; created: boolean } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("nome do evento obrigatório");

  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url || !isHttpUrl(url)) {
    throw new Error("link oficial obrigatório (http/https)");
  }

  const format = input.format === undefined ? "online" : input.format;
  if (!SUBMISSION_FORMATS.includes(format as SubmissionFormat)) {
    throw new Error("formato inválido");
  }

  for (const k of ["startsAt", "location", "note"] as const) {
    if (input[k] !== undefined && input[k] !== null && typeof input[k] !== "string") {
      throw new Error(`${k} inválido`);
    }
  }
  const startsAt = opt(input.startsAt);
  if (startsAt && Number.isNaN(Date.parse(startsAt))) {
    throw new Error("data inválida");
  }

  // dedupe por url (case-insensitive) em qualquer status — retry é no-op
  const cutoff = new Date(Date.now() - SUBMISSION_DEDUPE_MS).toISOString();
  const existing = db
    .prepare(
      `SELECT * FROM event_submissions
       WHERE lower(url) = lower(?) AND createdAt > ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(url, cutoff) as EventSubmission | undefined;
  if (existing) return { submission: existing, created: false };

  const res = db
    .prepare(
      `INSERT INTO event_submissions
         (name, url, startsAt, location, format, note, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      name,
      url,
      startsAt,
      opt(input.location),
      format,
      opt(input.note),
      new Date().toISOString(),
    );
  const submission = getSubmission(Number(res.lastInsertRowid));
  if (!submission) throw new Error("falha ao gravar indicação");
  return { submission, created: true };
}

export function getSubmission(id: number): EventSubmission | null {
  const row = db
    .prepare("SELECT * FROM event_submissions WHERE id = ?")
    .get(id) as EventSubmission | undefined;
  return row ?? null;
}

// fila de curadoria: só pending, mais antiga primeiro (FIFO — quem espera
// mais é revisado primeiro)
export function listPendingSubmissions(limit = 200): EventSubmission[] {
  return db
    .prepare(
      `SELECT * FROM event_submissions
       WHERE status = 'pending'
       ORDER BY createdAt ASC, id ASC LIMIT ?`,
    )
    .all(limit) as EventSubmission[];
}

// port do slugify do scraper (scripts/scrape_radar.py): minúsculas, sem
// diacríticos, não-alfanum vira hífen, máx 60 — mesma forma dos ids seed
export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// id público da edição aprovada: nome + ano quando a data existe; conflito
// ganha sufixo numérico (hackathon-ia-2026, hackathon-ia-2026-2…)
export function uniqueHackathonId(
  name: string,
  startsAt: string | null,
): string {
  const year = startsAt ? new Date(startsAt).getFullYear() : NaN;
  let base = slugify(name);
  if (Number.isFinite(year) && !base.endsWith(`-${year}`)) {
    base = base ? `${base}-${year}` : `evento-${year}`;
  }
  if (!base) base = "evento-sem-data";
  let id = base;
  let n = 2;
  while (getHackathon(id)) id = `${base}-${n++}`;
  return id;
}

// convenção leve: "org: Nome" na nota vira o organizer; sem padrão, a
// indicação é creditada à comunidade (admin edita depois se precisar)
function organizerFromNote(note: string | null): string {
  const m = note?.match(/(?:^|\s)(?:org|organizador|organiza[cç][aã]o)\s*:\s*([^\n;]+)/i);
  return m?.[1]?.trim() || "comunidade";
}

// approve: a indicação vira edição ativa no radar (source='comunidade');
// reject: só sai da fila. Revisão é terminal — já revisada → retorna como
// está, sem duplicar hackathon.
export function reviewSubmission(
  id: number,
  action: "approve" | "reject",
): { submission: EventSubmission; hackathon?: Hackathon } | null {
  const submission = getSubmission(id);
  if (!submission) return null;
  if (submission.status !== "pending") return { submission };

  const reviewedAt = new Date().toISOString();
  if (action === "reject") {
    db.prepare(
      "UPDATE event_submissions SET status = 'rejected', reviewedAt = ? WHERE id = ?",
    ).run(reviewedAt, id);
    return { submission: getSubmission(id) as EventSubmission };
  }

  const hackathonId = uniqueHackathonId(submission.name, submission.startsAt);
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO hackathons
         (id, name, organizer, startsAt, endsAt, format, location,
          registrationUrl, registrationDeadline, tags, active, source)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, '[]', 1, 'comunidade')`,
    ).run(
      hackathonId,
      submission.name,
      organizerFromNote(submission.note),
      submission.startsAt ?? NO_DATE_SENTINEL,
      submission.format,
      submission.location,
      submission.url,
    );
    db.prepare(
      "UPDATE event_submissions SET status = 'approved', reviewedAt = ? WHERE id = ?",
    ).run(reviewedAt, id);
  });
  tx();
  return {
    submission: getSubmission(id) as EventSubmission,
    hackathon: getHackathon(hackathonId) ?? undefined,
  };
}
