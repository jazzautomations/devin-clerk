import db from "@/lib/db";
import { publishToMembers } from "@/lib/announcements";
import { brtInputToDb, formatBrt, parseDbTime, toDbTime } from "@/lib/entries";
import { absoluteUrl } from "@/lib/seo";

// NPS por papel, só pra quem esteve lá (roadmap 037 #11, pesquisa 035 #11 —
// MLH). Depois que a edição termina, participante com check-in e quem teve
// papel (staff, mentor, jurado, patrocinador) recebe a pesquisa pela fila de
// avisos (system: true). Uma resposta por pessoa por edição, editável até o
// prazo (default: fim + 7 dias). O painel é anônimo: memberId só deduplica.

export class NpsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const NPS_ROLES = ["participante", "staff", "mentor", "jurado", "patrocinador"] as const;
export type NpsRole = (typeof NPS_ROLES)[number];

export const NPS_ROLE_LABEL: Record<NpsRole, string> = {
  participante: "participantes",
  staff: "staff",
  mentor: "mentores",
  jurado: "jurados",
  patrocinador: "patrocinadores",
};

/** perguntas fixas por papel: a nota muda de objeto, as abertas são as mesmas duas */
export const NPS_QUESTIONS: Record<NpsRole, { score: string; worked: string; improve: string }> = {
  participante: {
    score: "De 0 a 10, quanto você recomendaria participar desta edição pra um amigo?",
    worked: "O que funcionou no evento?",
    improve: "O que a gente precisa melhorar pra próxima?",
  },
  staff: {
    score: "De 0 a 10, quanto você recomendaria ser staff numa edição como esta?",
    worked: "O que funcionou na operação do dia?",
    improve: "O que travou ou faltou pra equipe?",
  },
  mentor: {
    score: "De 0 a 10, quanto você recomendaria ser mentor numa edição como esta?",
    worked: "O que funcionou na mentoria?",
    improve: "O que faltou pra você ajudar melhor os times?",
  },
  jurado: {
    score: "De 0 a 10, quanto você recomendaria ser jurado numa edição como esta?",
    worked: "O que funcionou na avaliação?",
    improve: "O que melhorar na rubrica, nos prazos ou na plataforma do júri?",
  },
  patrocinador: {
    score: "De 0 a 10, quanto você recomendaria patrocinar uma edição como esta?",
    worked: "O que deu retorno pra sua marca?",
    improve: "O que faltou pra valer mais o investimento?",
  },
};

export const NPS_DEFAULT_DAYS = 7;
/** abaixo disso o papel não mostra nota nem rótulo nos comentários (anonimato) */
export const NPS_MIN_GROUP = 3;
export const NPS_TEXT_MAX = 2000;

// ---------- janela ----------

/** fim efetivo da edição: endsAt (ou startsAt); data sem hora = fim do dia em Brasília */
export function editionEnd(h: { startsAt: string; endsAt: string | null }): Date | null {
  const raw = (h.endsAt ?? h.startsAt ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = parseDbTime(raw);
    return d ? new Date(d.getTime() + 27 * 3_600_000) : null; // 24h + 3h (UTC−3)
  }
  return parseDbTime(raw);
}

export type NpsWindow = {
  opensAt: Date | null;
  closesAt: Date | null;
  /** organizador mudou o prazo (senão é fim + 7 dias) */
  custom: boolean;
};

export function npsWindow(h: { startsAt: string; endsAt: string | null; npsClosesAt: string | null }): NpsWindow {
  const opensAt = editionEnd(h);
  const custom = parseDbTime(h.npsClosesAt);
  return {
    opensAt,
    closesAt: custom ?? (opensAt ? new Date(opensAt.getTime() + NPS_DEFAULT_DAYS * 86_400_000) : null),
    custom: !!custom,
  };
}

export type NpsPhase = "antes" | "aberta" | "encerrada";

export function npsPhase(w: NpsWindow, now = new Date()): NpsPhase {
  if (!w.opensAt || now.getTime() < w.opensAt.getTime()) return "antes";
  if (w.closesAt && now.getTime() > w.closesAt.getTime()) return "encerrada";
  return "aberta";
}

type EditionRow = { id: string; name: string; startsAt: string; endsAt: string | null; npsClosesAt: string | null };

async function edition(hackathonId: string): Promise<EditionRow | null> {
  return (
    (await db
      .prepare("SELECT id, name, startsAt, endsAt, npsClosesAt FROM hackathons WHERE id = ?")
      .get<EditionRow>(hackathonId)) ?? null
  );
}

export async function getNpsWindow(hackathonId: string): Promise<NpsWindow | null> {
  const h = await edition(hackathonId);
  return h ? npsWindow(h) : null;
}

/** organizador define o prazo (datetime-local em Brasília); null/"" volta pro default */
export async function setNpsClosesAt(hackathonId: string, raw: unknown): Promise<NpsWindow> {
  const h = await edition(hackathonId);
  if (!h) throw new NpsError("edição não encontrada", 404);
  let value: string | null;
  try {
    value = brtInputToDb(raw);
  } catch (e) {
    throw new NpsError((e as Error).message);
  }
  const end = editionEnd(h);
  const d = parseDbTime(value);
  if (d && end && d.getTime() <= end.getTime()) {
    throw new NpsError("o prazo da pesquisa precisa ser depois do fim da edição");
  }
  await db.prepare("UPDATE hackathons SET npsClosesAt = ? WHERE id = ?").run(value, hackathonId);
  return npsWindow({ ...h, npsClosesAt: value });
}

// ---------- quem responde ----------

// prioridade quando a pessoa acumula: o papel mais "de dentro" ganha
const PRIORITY: NpsRole[] = ["jurado", "mentor", "staff", "patrocinador", "participante"];

export function pickRole(roles: Iterable<NpsRole>): NpsRole | null {
  const set = new Set(roles);
  return PRIORITY.find((r) => set.has(r)) ?? null;
}

/**
 * Elegíveis da edição com o papel de cada um: participante = inscrição
 * aprovada com check-in; staff/mentor/jurado = papel da edição (organizador
 * fica de fora — é quem lê o resultado); patrocinador = pessoa da marca.
 */
export async function eligibleMembers(hackathonId: string): Promise<Map<number, NpsRole>> {
  const rows = await db
    .prepare(
      `SELECT r.memberId, 'participante' AS role FROM registrations r
         JOIN checkins c ON c.registrationId = r.id
        WHERE r.hackathonId = @h AND r.status = 'approved'
       UNION ALL
       SELECT memberId, role FROM edition_roles
        WHERE hackathonId = @h AND role IN ('staff', 'mentor', 'jurado')
       UNION ALL
       SELECT memberId, 'patrocinador' AS role FROM edition_sponsor_members WHERE hackathonId = @h`,
    )
    .all<{ memberId: number; role: NpsRole }>({ h: hackathonId });
  const byMember = new Map<number, NpsRole[]>();
  for (const r of rows) byMember.set(r.memberId, [...(byMember.get(r.memberId) ?? []), r.role]);
  const out = new Map<number, NpsRole>();
  for (const [m, roles] of byMember) {
    // conta anonimizada (LGPD) não recebe nem responde
    out.set(m, pickRole(roles)!);
  }
  const deleted = await db
    .prepare("SELECT id FROM members WHERE id = ANY(?::int[]) AND clerkId LIKE 'deleted:%'")
    .all<{ id: number }>(`{${[...out.keys()].join(",")}}`);
  for (const d of deleted) out.delete(d.id);
  return out;
}

export async function npsRoleFor(hackathonId: string, memberId: number): Promise<NpsRole | null> {
  return (await eligibleMembers(hackathonId)).get(memberId) ?? null;
}

// ---------- resposta ----------

export type NpsAnswer = { score: number; worked: string | null; improve: string | null };
export type MyNps = NpsAnswer & { role: NpsRole; updatedAt: string };

function optText(v: unknown, key: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new NpsError(`${key} inválido`);
  const s = v.trim();
  if (s.length > NPS_TEXT_MAX) throw new NpsError(`${key} longo demais (máx. ${NPS_TEXT_MAX})`);
  return s || null;
}

export function validateNpsAnswer(raw: unknown): NpsAnswer {
  const b = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!b) throw new NpsError("corpo JSON inválido");
  const score = typeof b.score === "number" ? b.score : Number.NaN;
  if (!Number.isInteger(score) || score < 0 || score > 10) throw new NpsError("nota precisa ser inteiro de 0 a 10");
  return { score, worked: optText(b.worked, "worked"), improve: optText(b.improve, "improve") };
}

export async function getMyNps(hackathonId: string, memberId: number): Promise<MyNps | null> {
  return (
    (await db
      .prepare(
        `SELECT role, score, worked, improve, updatedAt FROM nps_responses
         WHERE hackathonId = ? AND memberId = ?`,
      )
      .get<MyNps>(hackathonId, memberId)) ?? null
  );
}

/** grava/edita a resposta: 403 sem presença/papel, 409 fora da janela */
export async function submitNps(
  hackathonId: string,
  memberId: number,
  raw: unknown,
  now = new Date(),
): Promise<MyNps> {
  const h = await edition(hackathonId);
  if (!h) throw new NpsError("edição não encontrada", 404);
  const answer = validateNpsAnswer(raw);
  const role = await npsRoleFor(hackathonId, memberId);
  if (!role) throw new NpsError("a pesquisa é só pra quem esteve na edição (check-in ou papel)", 403);
  const w = npsWindow(h);
  const phase = npsPhase(w, now);
  if (phase === "antes") throw new NpsError("a pesquisa abre quando a edição terminar", 409);
  if (phase === "encerrada") throw new NpsError("a pesquisa já fechou", 409);
  const stamp = toDbTime(now);
  await db
    .prepare(
      `INSERT INTO nps_responses (hackathonId, memberId, role, score, worked, improve, createdAt, updatedAt)
       VALUES (@h, @m, @role, @score, @worked, @improve, @t, @t)
       ON CONFLICT (hackathonId, memberId) DO UPDATE SET
         role = excluded.role, score = excluded.score, worked = excluded.worked,
         improve = excluded.improve, updatedAt = excluded.updatedAt`,
    )
    .run({ h: hackathonId, m: memberId, role, ...answer, t: stamp });
  return (await getMyNps(hackathonId, memberId))!;
}

// ---------- agregado (anônimo) ----------

export type NpsStats = {
  responses: number;
  /** % promotores − % detratores, inteiro; null sem resposta */
  nps: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  /** quantas notas 0..10 */
  dist: number[];
};

/** puro: NPS clássico (9–10 promotor, 7–8 neutro, 0–6 detrator) */
export function computeNps(scores: number[]): NpsStats {
  const dist = Array.from({ length: 11 }, () => 0);
  for (const s of scores) dist[s]++;
  const promoters = dist[9] + dist[10];
  const passives = dist[7] + dist[8];
  const detractors = scores.length - promoters - passives;
  return {
    responses: scores.length,
    nps: scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null,
    promoters,
    passives,
    detractors,
    dist,
  };
}

export type NpsRoleStats = {
  role: NpsRole;
  invited: number;
  /** null quando o papel tem menos de NPS_MIN_GROUP respostas */
  stats: NpsStats | null;
  responses: number;
};

export type NpsComment = { role: NpsRole | null; score: number; worked: string | null; improve: string | null };

export type NpsSummary = {
  overall: NpsStats;
  byRole: NpsRoleStats[];
  comments: NpsComment[];
};

/**
 * Puro: monta o painel sem nada que identifique — nem memberId, nem data.
 * Papel com menos de NPS_MIN_GROUP respostas não mostra a nota do papel e os
 * comentários dele perdem o rótulo (um único jurado seria reconhecível).
 * Ordem dos comentários = papel, nota, texto (nunca ordem de chegada).
 */
export function summarize(
  rows: { role: NpsRole; score: number; worked: string | null; improve: string | null }[],
  invited: Partial<Record<NpsRole, number>> = {},
): NpsSummary {
  const byRole: NpsRoleStats[] = NPS_ROLES.map((role) => {
    const mine = rows.filter((r) => r.role === role);
    return {
      role,
      invited: invited[role] ?? 0,
      responses: mine.length,
      stats: mine.length >= NPS_MIN_GROUP ? computeNps(mine.map((r) => r.score)) : null,
    };
  });
  const big = new Set(byRole.filter((r) => r.stats).map((r) => r.role));
  const comments = rows
    .filter((r) => r.worked || r.improve)
    .map((r) => ({ role: big.has(r.role) ? r.role : null, score: r.score, worked: r.worked, improve: r.improve }))
    .sort(
      (a, b) =>
        (a.role === null ? 99 : NPS_ROLES.indexOf(a.role)) - (b.role === null ? 99 : NPS_ROLES.indexOf(b.role)) ||
        a.score - b.score ||
        `${a.worked ?? ""}${a.improve ?? ""}`.localeCompare(`${b.worked ?? ""}${b.improve ?? ""}`, "pt-BR"),
    );
  return { overall: computeNps(rows.map((r) => r.score)), byRole, comments };
}

export async function getNpsSummary(hackathonId: string): Promise<NpsSummary> {
  const [rows, invites] = await Promise.all([
    db
      .prepare("SELECT role, score, worked, improve FROM nps_responses WHERE hackathonId = ?")
      .all<{ role: NpsRole; score: number; worked: string | null; improve: string | null }>(hackathonId),
    db
      .prepare("SELECT role, COUNT(*)::int AS n FROM nps_invites WHERE hackathonId = ? GROUP BY role")
      .all<{ role: NpsRole; n: number }>(hackathonId),
  ]);
  return summarize(rows, Object.fromEntries(invites.map((i) => [i.role, Number(i.n)])));
}

/** versão do relatório do patrocinador: só números, sem comentário */
export async function getNpsAggregate(hackathonId: string): Promise<Omit<NpsSummary, "comments">> {
  const { overall, byRole } = await getNpsSummary(hackathonId);
  return { overall, byRole };
}

// ---------- disparo ----------

export type NpsDispatchResult = { editions: number; invited: number };

/**
 * Convida quem ainda não foi convidado nas edições com a pesquisa aberta.
 * Idempotente: a PK de nps_invites decide quem é novo (INSERT … ON CONFLICT
 * DO NOTHING RETURNING), então cron repetido ou em paralelo nunca manda duas
 * vezes; quem ganha papel depois do primeiro disparo entra no próximo.
 */
export async function runNpsDispatch(now = new Date()): Promise<NpsDispatchResult> {
  const candidates = await db
    .prepare(
      `SELECT id, name, startsAt, endsAt, npsClosesAt FROM hackathons
       WHERE active = 1
         AND to_ts(COALESCE(endsAt, startsAt)) BETWEEN ?::timestamptz - interval '120 days' AND ?::timestamptz`,
    )
    .all<EditionRow>(now.toISOString(), now.toISOString());
  const result: NpsDispatchResult = { editions: 0, invited: 0 };
  for (const h of candidates) {
    const w = npsWindow(h);
    if (npsPhase(w, now) !== "aberta") continue;
    result.editions++;
    const [eligible, already] = await Promise.all([
      eligibleMembers(h.id),
      db.prepare("SELECT memberId FROM nps_invites WHERE hackathonId = ?").all<{ memberId: number }>(h.id),
    ]);
    // o cron roda a cada 2 min: sem gente nova, não abre transação nenhuma
    const seen = new Set(already.map((r) => r.memberId));
    const pending = [...eligible].filter(([m]) => !seen.has(m));
    if (pending.length === 0) continue;
    result.invited += await db.transaction(async () => {
      const fresh: number[] = [];
      for (const [memberId, role] of pending) {
        const row = await db
          .prepare(
            `INSERT INTO nps_invites (hackathonId, memberId, role) VALUES (?, ?, ?)
             ON CONFLICT DO NOTHING RETURNING memberId`,
          )
          .get<{ memberId: number }>(h.id, memberId, role);
        if (row) fresh.push(row.memberId);
      }
      if (fresh.length === 0) return 0;
      const { id } = await publishToMembers(
        h.id,
        null,
        {
          title: "Como foi a edição? Pesquisa de 1 minuto",
          body:
            `Você esteve em ${h.name} e a sua opinião decide o que muda na próxima. ` +
            `É uma nota de 0 a 10 e duas perguntas abertas; a organização vê só o agregado, sem o seu nome.\n\n` +
            `Responda até ${formatBrt(toDbTime(w.closesAt!))}: ${absoluteUrl(`/h/${h.id}/nps`)}`,
        },
        fresh,
        { system: true },
      );
      await db
        .prepare("UPDATE nps_invites SET announcementId = ? WHERE hackathonId = ? AND memberId = ANY(?::int[])")
        .run(id, h.id, `{${fresh.join(",")}}`);
      return fresh.length;
    })();
  }
  return result;
}
