import { randomBytes } from "node:crypto";
import db from "@/lib/db";
import { isPublished } from "@/lib/jury";

// Certificado verificável (spec 033 US6, FR-007). Emissão é idempotente por
// (membro, edição, tipo): reemitir não duplica nem troca o código, só
// atualiza o detalhe (ex.: pódio republicado). O código é curto, aleatório e
// não sequencial; /c/[code] é o link público de verificação.

export const CERT_KINDS = ["participacao", "mentoria", "jurado", "organizacao", "premiacao"] as const;
export type CertKind = (typeof CERT_KINDS)[number];

export const CERT_KIND_LABEL: Record<CertKind, string> = {
  participacao: "participação",
  mentoria: "mentoria",
  jurado: "júri",
  organizacao: "organização",
  premiacao: "premiação",
};

// base32 de Crockford: sem I, L, O, U (não confunde com 1/0 nem vira palavrão)
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** 10 chars = 50 bits de aleatoriedade */
export function newCertificateCode(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

/**
 * Quem conta como presente pra certificado de participação.
 * Spec: "sem presença, sem certificado" — a presença vem do check-in (frente A).
 */
export async function attendeesForCertificates(hackathonId: string): Promise<number[]> {
  // TODO(check-in): trocar por `SELECT memberId FROM checkins ...` de lib/checkins.ts quando a frente A entrar
  const rows = await db
    .prepare("SELECT memberId FROM registrations WHERE hackathonId = ? AND status = 'approved' ORDER BY memberId")
    .all<{ memberId: number }>(hackathonId);
  return rows.map((r) => r.memberId);
}

type Grant = { memberId: number; kind: CertKind; detail: string | null };

const PLACE = (n: number) => `${n}º lugar`;

async function grantsFor(hackathonId: string): Promise<Grant[]> {
  const grants: Grant[] = (await attendeesForCertificates(hackathonId)).map((memberId) => ({
    memberId,
    kind: "participacao",
    detail: null,
  }));

  const roles = await db
    .prepare("SELECT memberId, role FROM edition_roles WHERE hackathonId = ? ORDER BY memberId, role")
    .all<{ memberId: number; role: string }>(hackathonId);
  const byKind = new Map<string, string[]>();
  for (const r of roles) {
    const kind = r.role === "mentor" ? "mentoria" : r.role === "jurado" ? "jurado" : "organizacao";
    const key = `${r.memberId}:${kind}`;
    byKind.set(key, [...(byKind.get(key) ?? []), r.role]);
  }
  for (const [key, list] of byKind) {
    const [id, kind] = key.split(":");
    grants.push({
      memberId: Number(id),
      kind: kind as CertKind,
      detail: kind === "organizacao" ? list.join(" e ") : null,
    });
  }

  // premiação só com resultado do júri publicado; vale pra todo o time do
  // pódio (o pódio já pressupõe que o time apresentou)
  if (await isPublished(hackathonId)) {
    const winners = await db
      .prepare(
        `SELECT m.id AS memberId, t.placement, t.name FROM teams t
         JOIN team_members tm ON tm.teamId = t.id
         JOIN members m ON m.username = tm.username
         WHERE t.hackathonId = ? AND t.placement BETWEEN 1 AND 3`,
      )
      .all<{ memberId: number; placement: number; name: string }>(hackathonId);
    for (const w of winners) {
      grants.push({ memberId: w.memberId, kind: "premiacao", detail: `${PLACE(w.placement)} com o time ${w.name}` });
    }
  }
  return grants;
}

/** emite o que falta; devolve quantos certificados novos nasceram e o total da edição */
export async function issueCertificates(hackathonId: string): Promise<{ created: number; total: number }> {
  const grants = await grantsFor(hackathonId);
  let created = 0;
  await db.transaction(async () => {
    for (const g of grants) {
      // colisão de código (50 bits) é improvável; ainda assim tenta de novo
      for (let attempt = 0; ; attempt++) {
        const code = newCertificateCode();
        const taken = await db.prepare("SELECT 1 FROM certificates WHERE code = ?").get(code);
        if (taken) {
          if (attempt > 5) throw new Error("não consegui gerar código de certificado");
          continue;
        }
        const row = await db
          .prepare(
            `INSERT INTO certificates (code, memberId, hackathonId, kind, detail)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (memberId, hackathonId, kind) DO UPDATE SET detail = EXCLUDED.detail
             RETURNING code`,
          )
          .get<{ code: string }>(code, g.memberId, hackathonId, g.kind, g.detail);
        if (row?.code === code) created++;
        break;
      }
    }
  })();
  const total = await db
    .prepare("SELECT COUNT(*) AS n FROM certificates WHERE hackathonId = ?")
    .get<{ n: number }>(hackathonId);
  return { created, total: total?.n ?? 0 };
}

export type Certificate = {
  code: string;
  memberId: number;
  memberName: string;
  username: string;
  hackathonId: string;
  hackathonName: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  kind: CertKind;
  detail: string | null;
  issuedAt: string;
};

const SELECT_CERT = `
  SELECT c.code, c.memberId, COALESCE(NULLIF(m.name, ''), m.username) AS memberName, m.username,
         c.hackathonId, h.name AS hackathonName, h.startsAt, h.endsAt, h.location,
         c.kind, c.detail, c.issuedAt
  FROM certificates c
  JOIN members m ON m.id = c.memberId
  JOIN hackathons h ON h.id = c.hackathonId`;

export async function getCertificate(code: string): Promise<Certificate | null> {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(normalized)) return null;
  return (await db.prepare(`${SELECT_CERT} WHERE c.code = ?`).get<Certificate>(normalized)) ?? null;
}

export async function listMemberCertificates(memberId: number): Promise<Certificate[]> {
  return db
    .prepare(`${SELECT_CERT} WHERE c.memberId = ? ORDER BY h.startsAt DESC, c.kind`)
    .all<Certificate>(memberId);
}

export async function listEditionCertificates(hackathonId: string): Promise<Certificate[]> {
  return db
    .prepare(`${SELECT_CERT} WHERE c.hackathonId = ? ORDER BY c.kind, memberName`)
    .all<Certificate>(hackathonId);
}

/** data do banco em pt-BR: "YYYY-MM-DD" é dia civil; com hora é UTC → horário de Brasília */
export function formatCertDate(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const iso = dateOnly ? `${value}T00:00:00Z` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : "America/Sao_Paulo",
  }).format(d);
}
