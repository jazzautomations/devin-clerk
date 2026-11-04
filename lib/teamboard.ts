import db from "@/lib/db";
import { areasFromJson, type AreaKey } from "@/lib/areas";
import { hiddenAuthorSql } from "@/lib/blocks";

export type BoardEntry = {
  id: number;
  memberId: number;
  hackathonId: string;
  skills: string[];
  need: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  username: string;
  name: string | null;
  headline: string | null;
  persona: string | null;
  xp: number;
  // perfil rico (migration 041): o card mostra "posso ajudar com"
  helpOffer: AreaKey[];
  city: string | null;
  institution: string | null;
  // já está num time desta edição? (o card não oferece convite pra quem já tem)
  hasTeam: boolean;
};

/**
 * O que a página da edição mostra. Sem memberId nunca; a nota só pra quem tem
 * inscrição aprovada na edição (o GET anônimo não leva a nota).
 */
export type BoardCard = Omit<BoardEntry, "memberId" | "note"> & { note?: string | null };

type Row = Omit<BoardEntry, "skills" | "active" | "helpOffer"> & {
  skills: string;
  active: number;
  helpOffer: string;
};

const select = `SELECT l.id, l.memberId, l.hackathonId, l.skills, l.need, l.note,
       l.active, l.createdAt,
       m.username, m.name, m.headline, m.persona, m.xp, m."helpOffer",
       m.city, m.institution,
       EXISTS (SELECT 1 FROM teams t JOIN team_members tm ON tm."teamId" = t.id
                WHERE t."hackathonId" = l."hackathonId" AND tm.username = m.username) AS "hasTeam"
       FROM looking_for_team l JOIN members m ON m.id = l.memberId`;

const toEntry = (r: Row): BoardEntry => ({
  ...r,
  skills: JSON.parse(r.skills),
  active: r.active === 1,
  helpOffer: areasFromJson(r.helpOffer),
  hasTeam: Boolean(r.hasTeam),
});

export const NEED_MAX = 200;
export const NOTE_MAX = 300;
export const SKILLS_MAX = 10;
export const SKILL_LEN = 30;

export type BoardInput = {
  skills: string[];
  need: string;
  note: string | null;
};

// valida o payload do POST: need é a essência do anúncio (o que falta no
// time); skills sanitiza (trim/dedup/limites) em vez de rejeitar
export function validateBoardInput(b: {
  skills?: unknown;
  need?: unknown;
  note?: unknown;
}): BoardInput {
  const need = typeof b.need === "string" ? b.need.trim() : "";
  if (!need || need.length > NEED_MAX) {
    throw new Error(`diga o que falta no time (até ${NEED_MAX} caracteres)`);
  }
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string") throw new Error("nota inválida");
    const n = b.note.trim();
    if (n.length > NOTE_MAX) throw new Error(`nota longa demais (até ${NOTE_MAX} caracteres)`);
    note = n || null;
  }
  let skills: string[] = [];
  if (b.skills !== undefined && b.skills !== null) {
    if (!Array.isArray(b.skills)) throw new Error("habilidades inválidas");
    skills = [
      ...new Set(
        b.skills
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.slice(0, SKILL_LEN)),
      ),
    ].slice(0, SKILLS_MAX);
  }
  return { skills, need, note };
}

// telefone ou e-mail dentro da nota (menor de idade não pode publicar contato)
const CONTACT_RE = /(\d[\d\s().-]{7,}\d)|(\S+@\S+\.\S+)/;
export const hasContact = (note: string | null) => !!note && CONTACT_RE.test(note);

/** idade na data do evento < 18 (vem do aceite dos termos na inscrição) */
export async function isMinorAtEdition(memberId: number, hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS y FROM registration_terms WHERE memberId = ? AND hackathonId = ? AND ageAtEvent < 18")
    .get(memberId, hackathonId);
  return !!row;
}

// board da edição — cronológico, só ativos (edição passada vira histórico:
// o dado fica, a UI decide se mostra o composer). memberId nunca sai; a nota
// só com withNotes (quem tem inscrição aprovada na edição).
export async function listBoardEntries(
  hackathonId: string,
  opts: { withNotes?: boolean } = {},
): Promise<BoardCard[]> {
  return (
    await db
      .prepare(
        `${select} WHERE l.hackathonId = ? AND l.active = 1
         ORDER BY l.createdAt ASC, l.id ASC`,
      )
      .all(hackathonId) as Row[]
  ).map((r) => {
    const { memberId: _m, note, ...card } = toEntry(r);
    void _m;
    return opts.withNotes ? { ...card, note } : card;
  });
}

export type SeekerFilter = {
  hackathonId?: string | null;
  area?: AreaKey | null;
  cidade?: string | null;
  faculdade?: string | null;
  limit?: number;
};

/**
 * Quem procura time, de todas as edições (/times, spec 046 onda 3). Bloqueio
 * e silêncio (dois sentidos) somem da lista; `viewerId` nulo não esconde nada.
 */
export async function listSeekers(filter: SeekerFilter, viewerId: number | null = null): Promise<BoardCard[]> {
  return (
    await db
      .prepare(
        `${select} WHERE l.active = 1
           AND (@hid::text IS NULL OR l."hackathonId" = @hid::text)
           AND (@area::text IS NULL OR m."helpOffer" LIKE '%"' || @area || '"%')
           AND (@cidade::text IS NULL OR m.city LIKE '%' || @cidade || '%')
           AND (@faculdade::text IS NULL OR m.institution LIKE '%' || @faculdade || '%')
           AND ${hiddenAuthorSql("l.memberId", "me")}
         ORDER BY l."createdAt" DESC, l.id DESC
         LIMIT @limit`,
      )
      .all({
        hid: filter.hackathonId ?? null,
        area: filter.area ?? null,
        cidade: filter.cidade ?? null,
        faculdade: filter.faculdade ?? null,
        me: viewerId ?? -1,
        limit: filter.limit ?? 60,
      }) as Row[]
  ).map((r) => {
    const { memberId: _m, note: _n, ...card } = toEntry(r);
    void _m;
    void _n;
    return card;
  });
}

// visão admin: inclui inativos pra moderação (reativar entry escondida)
export async function listAllBoardEntries(hackathonId: string): Promise<BoardEntry[]> {
  return (
    await db
      .prepare(
        `${select} WHERE l.hackathonId = ?
         ORDER BY l.active DESC, l.createdAt ASC, l.id ASC`,
      )
      .all(hackathonId) as Row[]
  ).map(toEntry);
}

export async function countBoardEntries(hackathonId: string): Promise<number> {
  return (
    await db
      .prepare(
        "SELECT COUNT(*) n FROM looking_for_team WHERE hackathonId = ? AND active = 1",
      )
      .get(hackathonId) as { n: number }
  ).n;
}

// o anúncio do próprio membro — qualquer estado (pra saber se reativa)
export async function getBoardEntry(
  memberId: number,
  hackathonId: string,
): Promise<BoardEntry | null> {
  const r = await db
    .prepare(`${select} WHERE l.memberId = ? AND l.hackathonId = ?`)
    .get(memberId, hackathonId) as Row | undefined;
  return r ? toEntry(r) : null;
}

export async function getBoardEntryById(id: number): Promise<BoardEntry | null> {
  const r = await db.prepare(`${select} WHERE l.id = ?`).get(id) as Row | undefined;
  return r ? toEntry(r) : null;
}

// INSERT OR IGNORE: changes>0 = primeira vez (created → gate do XP);
// conflito = re-anúncio → atualiza campos e reativa
export async function upsertBoardEntry(
  memberId: number,
  hackathonId: string,
  input: BoardInput,
): Promise<{ entry: BoardEntry; created: boolean }> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO looking_for_team (memberId, hackathonId, skills, need, note, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(memberId, hackathonId, JSON.stringify(input.skills), input.need, input.note);
  const created = res.changes > 0;
  if (!created) {
    await db.prepare(
      `UPDATE looking_for_team SET skills = ?, need = ?, note = ?, active = 1
       WHERE memberId = ? AND hackathonId = ?`,
    ).run(
      JSON.stringify(input.skills),
      input.need,
      input.note,
      memberId,
      hackathonId,
    );
  }
  return { entry: (await getBoardEntry(memberId, hackathonId))!, created };
}

// time formado → o membro desativa; idempotente (sem entry não é erro)
export async function deactivateBoardEntry(
  memberId: number,
  hackathonId: string,
): Promise<void> {
  await db.prepare(
    "UPDATE looking_for_team SET active = 0 WHERE memberId = ? AND hackathonId = ?",
  ).run(memberId, hackathonId);
}

// moderação admin — liga/desliga por id (entry abusiva esconde, não apaga)
export async function setBoardEntryActive(
  entryId: number,
  active: boolean,
): Promise<BoardEntry | null> {
  const res = await db
    .prepare("UPDATE looking_for_team SET active = ? WHERE id = ?")
    .run(active ? 1 : 0, entryId);
  if (res.changes === 0) return null;
  return getBoardEntryById(entryId);
}
