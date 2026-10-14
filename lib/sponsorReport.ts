import db from "@/lib/db";
import {
  challengesByTeam,
  deadlinePassed,
  flowEnabled,
  getSubmissionSettings,
  judgedVersions,
} from "@/lib/entries";
import { getEditionSponsor, sponsorCategories, sponsorChallenges, type EditionSponsor } from "@/lib/editionSponsors";
import { getRanking, isPublished } from "@/lib/jury";
import { getNpsAggregate, type NpsSummary } from "@/lib/nps";
import { personaLabel } from "@/lib/personas";
import { listWinners } from "@/lib/prizes";
import { csvField, displayAnswer } from "@/lib/registrationForm";
import { audienceQuorum } from "@/lib/stage";
import { listTalents, type Talent } from "@/lib/sponsorContacts";

// Relatório do patrocinador (roadmap 037 #8; pesquisa 036 #4 — "ninguém
// expõe; é o produto pago"). Tudo agregado e sem dado pessoal: funil,
// perfil, stack, times do desafio (projeto e links, sem integrante),
// vencedores, votos, nota do júri, NPS. A única exceção são os talentos que
// deram opt-in pra ESTA marca (lib/sponsorContacts).

/** faixa com menos gente que isso vira "outros" (instituição/persona rara identifica) */
export const REPORT_MIN_BUCKET = 3;

export type Bucket = { label: string; n: number };

/** puro: ordena por contagem e funde faixas pequenas em "outros" */
export function kAnonymize(counts: Map<string, number>, min = REPORT_MIN_BUCKET, top = 10): Bucket[] {
  const sorted = [...counts.entries()]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "pt-BR"));
  const kept: Bucket[] = [];
  let others = 0;
  for (const b of sorted) {
    if (b.n >= min && kept.length < top) kept.push(b);
    else others += b.n;
  }
  if (others > 0) kept.push({ label: "outros", n: others });
  return kept;
}

export type Funnel = { inscritos: number; aprovados: number; confirmados: number | null; presentes: number };

export type ReportTeam = {
  teamId: number;
  teamName: string;
  title: string;
  tagline: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  challenges: string[];
  communityVotes: number;
  liveVotes: number;
  liveAvg: number | null;
  /** média ponderada do júri (1–5); null = sem nota ou ainda sigiloso */
  juryAvg: number | null;
};

export type SponsorReport = {
  generatedAt: string;
  edition: { id: string; name: string; startsAt: string };
  sponsor: EditionSponsor;
  challenges: { id: string; title: string; prize: string | null }[];
  categories: { id: number; name: string; kind: "geral" | "desafio" }[];
  funnel: Funnel;
  profile: { base: number; personas: Bucket[]; institutions: { question: string; buckets: Bucket[] }[] };
  stack: Bucket[];
  /** projetos só aparecem depois do prazo de entrega (antes: só a contagem) */
  teamsVisible: boolean;
  teamCount: number;
  teams: ReportTeam[];
  winners: { categoryName: string; place: number; teamId: number; teamName: string; title: string | null }[];
  votes: { community: number; live: number; liveQuorumMet: boolean };
  jury: { visible: boolean; avg: number | null; judgedTeams: number };
  nps: Omit<NpsSummary, "comments">;
  talents: Talent[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const INSTITUTION_RE = /institui|universidade|faculdade|escola|curso|gradua/i;

async function funnel(hackathonId: string): Promise<Funnel> {
  const [live, rel] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*)::int AS total,
                (COUNT(*) FILTER (WHERE r.status = 'approved'))::int AS approved,
                (COUNT(*) FILTER (WHERE r.status = 'approved' AND r.rsvpStatus = 'confirmed'))::int AS confirmed,
                (COUNT(c.registrationId) FILTER (WHERE r.status = 'approved'))::int AS present,
                (SELECT rsvpEnabled FROM hackathons WHERE id = @h) AS rsvp
         FROM registrations r LEFT JOIN checkins c ON c.registrationId = r.id
         WHERE r.hackathonId = @h`,
      )
      .get<{ total: number; approved: number; confirmed: number; present: number; rsvp: number }>({ h: hackathonId }),
    db
      .prepare(
        `SELECT COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE wasConfirmed = 1))::int AS confirmed
         FROM rsvp_releases WHERE hackathonId = ?`,
      )
      .get<{ n: number; confirmed: number }>(hackathonId),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  // quem foi aprovado e liberou a vaga pelo RSVP segue contando como inscrito/aprovado
  return {
    inscritos: n(live?.total) + n(rel?.n),
    aprovados: n(live?.approved) + n(rel?.n),
    confirmados: n(live?.rsvp) === 1 ? n(live?.confirmed) : null,
    presentes: n(live?.present),
  };
}

async function profile(hackathonId: string): Promise<SponsorReport["profile"]> {
  const [members, answers] = await Promise.all([
    db
      .prepare(
        `SELECT m.personas FROM registrations r JOIN members m ON m.id = r.memberId
         WHERE r.hackathonId = ? AND r.status = 'approved'`,
      )
      .all<{ personas: string }>(hackathonId),
    db
      .prepare(
        `SELECT q.id, q.label, a.value FROM registration_answers a
         JOIN registrations r ON r.id = a.registrationId AND r.status = 'approved'
         JOIN edition_questions q ON q.id = a.questionId
         WHERE r.hackathonId = ? AND q.audience = 'participante'
           AND q.kind IN ('short_text', 'single', 'multi')`,
      )
      .all<{ id: number; label: string; value: string }>(hackathonId),
  ]);
  const personas = new Map<string, number>();
  for (const m of members) {
    let keys: unknown = [];
    try {
      keys = JSON.parse(m.personas || "[]");
    } catch {}
    for (const k of Array.isArray(keys) ? keys : []) {
      const label = personaLabel(String(k));
      if (label) personas.set(label, (personas.get(label) ?? 0) + 1);
    }
  }
  const byQuestion = new Map<number, { question: string; counts: Map<string, number> }>();
  for (const a of answers) {
    if (!INSTITUTION_RE.test(a.label)) continue;
    const q = byQuestion.get(a.id) ?? { question: a.label, counts: new Map<string, number>() };
    for (const raw of displayAnswer(a.value).split(";")) {
      const v = raw.trim().replace(/\s+/g, " ");
      if (!v) continue;
      // mesma instituição com caixa diferente conta junto
      const key = [...q.counts.keys()].find((k) => k.toLowerCase() === v.toLowerCase()) ?? v;
      q.counts.set(key, (q.counts.get(key) ?? 0) + 1);
    }
    byQuestion.set(a.id, q);
  }
  return {
    base: members.length,
    personas: kAnonymize(personas),
    institutions: [...byQuestion.values()].map((q) => ({ question: q.question, buckets: kAnonymize(q.counts) })),
  };
}

type ProjectBits = { title: string; tagline: string | null; repoUrl: string | null; demoUrl: string | null; technologies: string[] };

/** projeto avaliado por time: snapshot no fluxo novo; rascunho no modo antigo */
async function projectsOf(hackathonId: string, flow: boolean): Promise<Map<number, ProjectBits>> {
  const map = new Map<number, ProjectBits>();
  if (flow) {
    for (const [teamId, v] of await judgedVersions(hackathonId)) {
      const s = v.snapshot;
      map.set(teamId, { title: s.title, tagline: s.tagline, repoUrl: s.repoUrl, demoUrl: s.demoUrl, technologies: s.technologies });
    }
    return map;
  }
  const rows = await db
    .prepare(
      `SELECT tp.teamId, tp.title, tp.tagline, tp.repoUrl, tp.demoUrl, tp.technologies
       FROM team_projects tp JOIN teams t ON t.id = tp.teamId WHERE t.hackathonId = ?`,
    )
    .all<{ teamId: number; title: string; tagline: string | null; repoUrl: string | null; demoUrl: string | null; technologies: string }>(
      hackathonId,
    );
  for (const r of rows) {
    map.set(r.teamId, {
      title: r.title,
      tagline: r.tagline,
      repoUrl: r.repoUrl,
      demoUrl: r.demoUrl,
      technologies: safeList(r.technologies),
    });
  }
  return map;
}

function safeList(v: string | null): string[] {
  try {
    const p = JSON.parse(v ?? "[]");
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

export async function getSponsorReport(
  hackathonId: string,
  sponsorId: string,
  viewer: { manager: boolean },
  now = new Date(),
): Promise<SponsorReport | null> {
  const [sponsor, edition] = await Promise.all([
    getEditionSponsor(hackathonId, sponsorId),
    db.prepare("SELECT id, name, startsAt FROM hackathons WHERE id = ?").get<SponsorReport["edition"]>(hackathonId),
  ]);
  if (!sponsor || !edition) return null;

  const [challenges, categories, settings, f, prof, published, quorum, nps, talents, allWinners] = await Promise.all([
    sponsorChallenges(hackathonId, sponsorId),
    sponsorCategories(hackathonId, sponsorId),
    getSubmissionSettings(hackathonId),
    funnel(hackathonId),
    profile(hackathonId),
    isPublished(hackathonId),
    audienceQuorum(hackathonId),
    getNpsAggregate(hackathonId),
    listTalents(hackathonId, sponsorId),
    listWinners(hackathonId),
  ]);
  const flow = flowEnabled(settings);
  const [byTeam, projects] = await Promise.all([challengesByTeam(hackathonId), projectsOf(hackathonId, flow)]);

  // stack da edição inteira (o que os times usaram) — agregado por time
  const tech = new Map<string, number>();
  for (const p of projects.values()) for (const t of p.technologies) tech.set(t, (tech.get(t) ?? 0) + 1);

  const mine = new Map(challenges.map((c) => [c.id, c.title]));
  const teamIds = [...byTeam.entries()].filter(([, ids]) => ids.some((c) => mine.has(c))).map(([t]) => t);
  const teamsVisible = !flow || deadlinePassed(settings, now);
  const juryVisible = viewer.manager || !!published;

  const [names, community, live, ranking] = await Promise.all([
    teamIds.length
      ? db.prepare("SELECT id, name FROM teams WHERE id = ANY(?::int[])").all<{ id: number; name: string }>(`{${teamIds.join(",")}}`)
      : Promise.resolve([]),
    teamIds.length
      ? db
          .prepare("SELECT teamId, COUNT(*)::int AS n FROM votes WHERE teamId = ANY(?::int[]) GROUP BY teamId")
          .all<{ teamId: number; n: number }>(`{${teamIds.join(",")}}`)
      : Promise.resolve([]),
    teamIds.length
      ? db
          .prepare(
            `SELECT teamId, COUNT(*)::int AS n, AVG(score)::float AS avg FROM live_votes
             WHERE hackathonId = ? AND teamId = ANY(?::int[]) GROUP BY teamId`,
          )
          .all<{ teamId: number; n: number; avg: number }>(hackathonId, `{${teamIds.join(",")}}`)
      : Promise.resolve([]),
    juryVisible && teamIds.length ? getRanking(hackathonId) : Promise.resolve([]),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const votesOf = new Map(community.map((v) => [v.teamId, Number(v.n)]));
  const liveOf = new Map(live.map((v) => [v.teamId, v]));
  const juryOf = new Map(ranking.map((r) => [r.teamId, r.weighted]));

  const teams: ReportTeam[] = teamsVisible
    ? teamIds
        .map((teamId) => {
          const p = projects.get(teamId);
          const l = liveOf.get(teamId);
          return {
            teamId,
            teamName: nameOf.get(teamId) ?? "",
            title: p?.title ?? nameOf.get(teamId) ?? "",
            tagline: p?.tagline ?? null,
            repoUrl: p?.repoUrl ?? null,
            demoUrl: p?.demoUrl ?? null,
            challenges: (byTeam.get(teamId) ?? []).filter((c) => mine.has(c)).map((c) => mine.get(c)!),
            communityVotes: votesOf.get(teamId) ?? 0,
            liveVotes: Number(l?.n ?? 0),
            // média do voto ao vivo só com quórum (mesma regra do palco)
            liveAvg: l && quorum.met ? round2(Number(l.avg)) : null,
            juryAvg: juryOf.get(teamId) ?? null,
          };
        })
        .sort((a, b) => (b.juryAvg ?? -1) - (a.juryAvg ?? -1) || a.teamName.localeCompare(b.teamName, "pt-BR"))
    : [];

  const judged = teams.filter((t) => t.juryAvg !== null);
  const categoryIds = new Set(categories.map((c) => c.id));
  return {
    generatedAt: new Date().toISOString(),
    edition,
    sponsor,
    challenges,
    categories: categories.map(({ id, name, kind }) => ({ id, name, kind })),
    funnel: f,
    profile: prof,
    stack: kAnonymize(tech, 1, 12),
    teamsVisible,
    teamCount: teamIds.length,
    teams,
    // vencedor só existe depois da publicação (prize_winners nasce nela)
    winners: allWinners
      .filter((w) => categoryIds.has(w.categoryId))
      .map((w) => ({ categoryName: w.categoryName, place: w.place, teamId: w.teamId, teamName: w.teamName, title: w.title })),
    votes: {
      community: teams.reduce((s, t) => s + t.communityVotes, 0),
      live: teams.reduce((s, t) => s + t.liveVotes, 0),
      liveQuorumMet: quorum.met,
    },
    jury: {
      visible: juryVisible,
      avg: judged.length ? round2(judged.reduce((s, t) => s + t.juryAvg!, 0) / judged.length) : null,
      judgedTeams: judged.length,
    },
    nps,
    talents,
  };
}

/** CSV em seções (seção, item, valor, detalhes…) — abre direto na planilha */
export function sponsorReportCsv(r: SponsorReport): string {
  const rows: (string | number | null)[][] = [["secao", "item", "valor", "detalhe1", "detalhe2", "detalhe3", "detalhe4"]];
  rows.push(["edicao", r.edition.name, r.edition.startsAt]);
  rows.push(["patrocinador", r.sponsor.name, r.sponsor.tier]);
  for (const c of r.challenges) rows.push(["desafio", c.title, c.prize]);
  rows.push(["funil", "inscritos", r.funnel.inscritos]);
  rows.push(["funil", "aprovados", r.funnel.aprovados]);
  rows.push(["funil", "confirmados", r.funnel.confirmados ?? "RSVP desligado"]);
  rows.push(["funil", "presentes", r.funnel.presentes]);
  for (const b of r.profile.personas) rows.push(["perfil", b.label, b.n]);
  for (const q of r.profile.institutions) for (const b of q.buckets) rows.push(["instituicao", b.label, b.n, q.question]);
  for (const b of r.stack) rows.push(["stack", b.label, b.n]);
  rows.push(["times_no_desafio", "total", r.teamCount]);
  for (const t of r.teams) {
    rows.push(["time", t.teamName, t.title, t.repoUrl, t.demoUrl, t.juryAvg, `votos ${t.communityVotes} · palco ${t.liveVotes}`]);
  }
  for (const w of r.winners) rows.push(["vencedor", w.categoryName, `${w.place}º`, w.teamName, w.title]);
  rows.push(["votos", "comunidade", r.votes.community]);
  rows.push(["votos", "palco", r.votes.live]);
  rows.push(["juri", "media_no_desafio", r.jury.visible ? r.jury.avg : "sigiloso até a publicação"]);
  rows.push(["nps", "geral", r.nps.overall.nps, `${r.nps.overall.responses} respostas`]);
  for (const g of r.nps.byRole) {
    if (g.stats) rows.push(["nps", g.role, g.stats.nps, `${g.stats.responses} respostas`]);
  }
  for (const t of r.talents) rows.push(["talento", t.name, t.email, t.linkedin, t.github, t.project, t.sharedAt]);
  return rows.map((row) => row.map((v) => csvField(v)).join(",")).join("\n") + "\n";
}
