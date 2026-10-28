import db from "@/lib/db";

// Métricas da rede (spec 046, metricas-e-checkpoint). Só leitura: tudo sai de
// query em tabela que já existe, sem rastreio de clique e sem script de
// terceiro. Quem lê é o /admin/metricas (admin global).
//
// Janela padrão: as últimas 4 semanas, de segunda 00:00 a domingo 23:59 no
// horário de Brasília (UTC-3 fixo, sem horário de verão desde 2019). A semana
// atual entra parcial, até agora.
//
// Regras de contagem (o teste tests/api/metricas.test.ts confere cada uma):
// - ativo na semana: conta não excluída com lastSeenAt na semana OU que
//   publicou post, comentou ou seguiu alguém na semana. lastSeenAt guarda só
//   o último acesso, então sem o resto as semanas antigas encolheriam toda vez
//   que a pessoa volta. Ainda assim é piso: quem só leu e voltou depois some
//   das semanas antigas.
// - segue alguém: dos ativos da semana, quem tinha seguido 1 pessoa ou mais
//   até o fim da semana.
// - post com conversa: post criado na semana com 1 comentário ou mais de
//   outra pessoa (o autor respondendo sozinho não conta).
// - reações: as dos posts criados na semana, contadas até agora.
// - depoimento: times com gente, de edições encerradas nos últimos 60 dias,
//   com 1 depoimento ou mais pra alguém do time naquela edição (escrito =
//   qualquer status; aceito = status 'aceito'). Meta: 30%.
// - denúncias abertas: retrato no fim da semana, por fila. Comunidade quando
//   tem communityId, edição quando tem só hackathonId, global quando não tem
//   nenhum dos dois. Tempo até resolver: mediana das resolvidas na semana.
// - volta em 14 dias: quem fez check-in numa edição que terminou na semana e
//   tem lastSeenAt 14 dias ou mais depois do fim. Edição que terminou há
//   menos de 14 dias ainda não entra.
//
// Depoimento (migration 037) e perfil aberto (041) chegam em branches
// paralelas: enquanto a tabela ou a coluna não existe, a métrica volta null.

export const TESTIMONIAL_GOAL = 0.3;
export const DEFAULT_WEEKS = 4;
const BRT_OFFSET_MS = 3 * 3600_000;
const WEEK_MS = 7 * 24 * 3600_000;

export type MetricWeek = {
  /** início, ISO UTC (segunda 00:00 em Brasília) */
  start: string;
  /** fim exclusivo, ISO UTC */
  end: string;
  /** "dd/mm" da segunda-feira, em Brasília */
  label: string;
  /** semana atual, ainda rolando */
  partial: boolean;
};

export type Ratio = { num: number; den: number; pct: number | null };

export type MetricsOptions = { now?: Date; weeks?: number };

const ratio = (num: number, den: number): Ratio => ({ num, den, pct: den > 0 ? num / den : null });

/** as semanas da janela, da mais antiga pra atual */
export function metricWeeks(now: Date = new Date(), weeks = DEFAULT_WEEKS): MetricWeek[] {
  const brt = new Date(now.getTime() - BRT_OFFSET_MS);
  const sinceMonday = (brt.getUTCDay() + 6) % 7;
  const monday = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() - sinceMonday);
  const current = monday + BRT_OFFSET_MS;
  const out: MetricWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = current - i * WEEK_MS;
    const d = new Date(start - BRT_OFFSET_MS);
    out.push({
      start: new Date(start).toISOString(),
      end: new Date(start + WEEK_MS).toISOString(),
      label: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      partial: i === 0,
    });
  }
  return out;
}

/** fim da semana pra retrato: nunca depois de agora */
const snapshotEnd = (w: MetricWeek, now: Date) =>
  new Date(Math.min(new Date(w.end).getTime(), now.getTime())).toISOString();

// ---------- presença de tabela e coluna (features paralelas) ----------

export async function relationExists(name: string): Promise<boolean> {
  const r = await db.prepare("SELECT to_regclass(?::text) IS NOT NULL AS ok").get<{ ok: boolean }>(name);
  return Boolean(r?.ok);
}

export async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?) AS ok`,
    )
    .get<{ ok: boolean }>(table, column);
  return Boolean(r?.ok);
}

// ---------- por semana ----------

const IN_WEEK = (col: string) => `to_ts(${col}) >= @s::timestamptz AND to_ts(${col}) < @e::timestamptz`;

/** ativos na semana (WAU) e quantos deles seguem alguém */
export async function activeWeek(w: MetricWeek): Promise<{ active: number; following: Ratio }> {
  const r = await db
    .prepare(
      `WITH active AS (
         SELECT m.id FROM members m
         WHERE m.clerkId NOT LIKE 'deleted:%' AND (
           (${IN_WEEK("m.lastSeenAt")})
           OR EXISTS (SELECT 1 FROM posts p WHERE p.memberId = m.id AND ${IN_WEEK("p.createdAt")})
           OR EXISTS (SELECT 1 FROM post_comments c WHERE c.memberId = m.id AND ${IN_WEEK("c.createdAt")})
           OR EXISTS (SELECT 1 FROM member_follows f WHERE f.memberId = m.id AND ${IN_WEEK("f.createdAt")})
         )
       )
       SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM member_follows f WHERE f.memberId = a.id AND to_ts(f.createdAt) < @e::timestamptz
              ))::int AS following
       FROM active a`,
    )
    .get<{ n: number; following: number }>({ s: w.start, e: w.end });
  const n = r?.n ?? 0;
  return { active: n, following: ratio(r?.following ?? 0, n) };
}

export type PostWeek = {
  posts: number;
  /** posts com comentário de outra pessoa */
  commented: Ratio;
  reactions: number;
  /** média de reações por post; null sem post */
  reactionsPerPost: number | null;
  /** reações que não são 'curti' */
  otherReactions: Ratio;
};

/** posts criados na semana, conversa e reações neles */
export async function postsWeek(w: MetricWeek): Promise<PostWeek> {
  const r = await db
    .prepare(
      `SELECT COUNT(*)::int AS posts,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM post_comments c WHERE c.postId = p.id AND c.memberId <> p.memberId
              ))::int AS commented,
              COALESCE(SUM(rx.n), 0)::int AS reactions,
              COALESCE(SUM(rx.other), 0)::int AS other
       FROM posts p
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE l.kind <> 'curti') AS other
         FROM likes l WHERE l.postId = p.id
       ) rx ON true
       WHERE ${IN_WEEK("p.createdAt")}`,
    )
    .get<{ posts: number; commented: number; reactions: number; other: number }>({ s: w.start, e: w.end });
  const posts = r?.posts ?? 0;
  const reactions = r?.reactions ?? 0;
  return {
    posts,
    commented: ratio(r?.commented ?? 0, posts),
    reactions,
    reactionsPerPost: posts > 0 ? reactions / posts : null,
    otherReactions: ratio(r?.other ?? 0, reactions),
  };
}

export type ReportQueues = { global: number; comunidade: number; edicao: number };

/** denúncias abertas no fim da semana (ou agora, na semana atual), por fila */
export async function openReportsAt(at: string): Promise<ReportQueues> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE communityId IS NULL AND hackathonId IS NULL)::int AS global,
              COUNT(*) FILTER (WHERE communityId IS NOT NULL)::int AS comunidade,
              COUNT(*) FILTER (WHERE communityId IS NULL AND hackathonId IS NOT NULL)::int AS edicao
       FROM reports
       WHERE to_ts(createdAt) < @at::timestamptz
         AND (resolvedAt IS NULL OR to_ts(resolvedAt) >= @at::timestamptz)`,
    )
    .get<ReportQueues>({ at });
  return { global: r?.global ?? 0, comunidade: r?.comunidade ?? 0, edicao: r?.edicao ?? 0 };
}

/** mediana, em horas, entre abrir e resolver, das denúncias resolvidas na semana */
export async function medianResolutionHours(w: MetricWeek): Promise<{ hours: number | null; resolved: number }> {
  const r = await db
    .prepare(
      `SELECT COUNT(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM to_ts(resolvedAt) - to_ts(createdAt)) / 3600.0
              ) AS hours
       FROM reports
       WHERE resolvedAt IS NOT NULL AND ${IN_WEEK("resolvedAt")}`,
    )
    .get<{ n: number; hours: number | null }>({ s: w.start, e: w.end });
  const n = r?.n ?? 0;
  return { hours: n > 0 && r?.hours != null ? Number(r.hours) : null, resolved: n };
}

const EDITION_END = "to_ts(COALESCE(NULLIF(h.endsAt, ''), h.startsAt))";

/**
 * Volta em 14 dias: quem fez check-in em edição que terminou na semana e
 * voltou (lastSeenAt) 14 dias ou mais depois do fim. null quando nenhuma
 * edição da semana completou os 14 dias ou ninguém fez check-in nelas.
 */
export async function retentionWeek(w: MetricWeek, now: Date): Promise<Ratio | null> {
  const r = await db
    .prepare(
      `WITH ended AS (
         SELECT h.id, ${EDITION_END} AS endAt FROM hackathons h
         WHERE ${EDITION_END} >= @s::timestamptz AND ${EDITION_END} < @e::timestamptz
           AND ${EDITION_END} + interval '14 days' <= @now::timestamptz
       ), cohort AS (
         SELECT r.memberId, MAX(e.endAt) AS endAt
         FROM checkins c
         JOIN registrations r ON r.id = c.registrationId
         JOIN ended e ON e.id = r.hackathonId
         GROUP BY r.memberId
       )
       SELECT COUNT(*)::int AS den,
              COUNT(*) FILTER (WHERE to_ts(m.lastSeenAt) >= co.endAt + interval '14 days')::int AS num
       FROM cohort co JOIN members m ON m.id = co.memberId`,
    )
    .get<{ den: number; num: number }>({ s: w.start, e: w.end, now: now.toISOString() });
  if (!r || r.den === 0) return null;
  return ratio(r.num, r.den);
}

// ---------- retrato de agora ----------

export type TestimonialCoverage = { teams: number; written: Ratio; accepted: Ratio };

/**
 * Times com gente, de edições encerradas nos últimos 60 dias, com depoimento
 * pra alguém do time. null enquanto team_testimonials não existe.
 */
export async function testimonialCoverage(now: Date = new Date()): Promise<TestimonialCoverage | null> {
  if (!(await relationExists("team_testimonials"))) return null;
  const has = (extra: string) => `EXISTS (
      SELECT 1 FROM team_testimonials x JOIN members tm ON tm.id = x.memberId
      WHERE x.hackathonId = t.hackathonId ${extra}
        AND (x.teamId = t.id OR EXISTS (
          SELECT 1 FROM team_members mm WHERE mm.teamId = t.id AND mm.username = tm.username)))`;
  const r = await db
    .prepare(
      `WITH t AS (
         SELECT tt.id, tt.hackathonId FROM teams tt JOIN hackathons h ON h.id = tt.hackathonId
         WHERE ${EDITION_END} < @now::timestamptz
           AND ${EDITION_END} >= @now::timestamptz - interval '60 days'
           AND EXISTS (SELECT 1 FROM team_members mm WHERE mm.teamId = tt.id)
       )
       SELECT COUNT(*)::int AS teams,
              COUNT(*) FILTER (WHERE ${has("")})::int AS written,
              COUNT(*) FILTER (WHERE ${has("AND x.status = 'aceito'")})::int AS accepted
       FROM t`,
    )
    .get<{ teams: number; written: number; accepted: number }>({ now: now.toISOString() });
  const teams = r?.teams ?? 0;
  return { teams, written: ratio(r?.written ?? 0, teams), accepted: ratio(r?.accepted ?? 0, teams) };
}

/** contas ativas com perfil aberto. null enquanto members.publicProfile não existe */
export async function publicProfileShare(): Promise<Ratio | null> {
  if (!(await columnExists("members", "publicProfile"))) return null;
  const r = await db
    .prepare(
      `SELECT COUNT(*)::int AS den, COUNT(*) FILTER (WHERE publicProfile = 1)::int AS num
       FROM members WHERE clerkId NOT LIKE 'deleted:%'`,
    )
    .get<{ den: number; num: number }>();
  return ratio(r?.num ?? 0, r?.den ?? 0);
}

// ---------- tudo junto ----------

export type NetworkMetrics = {
  generatedAt: string;
  weeks: MetricWeek[];
  active: number[];
  following: Ratio[];
  posts: PostWeek[];
  openReports: ReportQueues[];
  resolution: { hours: number | null; resolved: number }[];
  retention: (Ratio | null)[];
  testimonials: TestimonialCoverage | null;
  publicProfile: Ratio | null;
};

export async function getNetworkMetrics(opts: MetricsOptions = {}): Promise<NetworkMetrics> {
  const now = opts.now ?? new Date();
  const weeks = metricWeeks(now, opts.weeks ?? DEFAULT_WEEKS);
  const [activity, posts, openReports, resolution, retention, testimonials, publicProfile] = await Promise.all([
    Promise.all(weeks.map(activeWeek)),
    Promise.all(weeks.map(postsWeek)),
    Promise.all(weeks.map((w) => openReportsAt(snapshotEnd(w, now)))),
    Promise.all(weeks.map(medianResolutionHours)),
    Promise.all(weeks.map((w) => retentionWeek(w, now))),
    testimonialCoverage(now),
    publicProfileShare(),
  ]);
  return {
    generatedAt: now.toISOString(),
    weeks,
    active: activity.map((a) => a.active),
    following: activity.map((a) => a.following),
    posts,
    openReports,
    resolution,
    retention,
    testimonials,
    publicProfile,
  };
}

/** quem pode ver o painel: só o admin global */
export function canSeeMetrics(member: { role: string } | null | undefined): boolean {
  return member?.role === "admin";
}

// ---------- formato (a página e o teste usam) ----------

export function formatPct(r: Ratio | null | undefined): string {
  if (!r || r.pct === null) return "—";
  return `${Math.round(r.pct * 100)}%`;
}

export function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h >= 48) return `${(h / 24).toFixed(1).replace(".", ",")} d`;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${h.toFixed(1).replace(".", ",")} h`;
}

export function formatAvg(n: number | null): string {
  return n === null ? "—" : n.toFixed(1).replace(".", ",");
}

/** 60 dias, pro texto da página */
export const TESTIMONIAL_WINDOW_DAYS = 60;
export const RETENTION_DAYS = 14;
