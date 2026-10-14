import db from "@/lib/db";
import type { EditionArchive } from "@/lib/archive";
import {
  deadlinePassed,
  deriveStatus,
  flowEnabled,
  getEntry,
  getSubmissionSettings,
  isLocked,
  judgedVersions,
  lockAt,
  toDbTime,
  type EntryFields,
  type EntryStatus,
  type JudgedVersion,
} from "@/lib/entries";
import { isPublished } from "@/lib/jury";
import { listWinners, type PrizeKind } from "@/lib/prizes";
import { hasEditionRole } from "@/lib/roles";

// Matriz de visibilidade da entrega (spec 034 §5 "Visibilidade"):
// - antes do prazo: público vê só "N times, M entregues";
// - depois do prazo: All Entries com status; conteúdo completo se a edição
//   deixar (entriesShowContent), sempre da versão avaliada (snapshot);
// - júri: só os atribuídos, na versão julgada (lib/jury);
// - depois da publicação: tudo, com selos, resultados e vídeo do palco.
// Edição sem prazo (modo antigo) mostra o projeto como sempre mostrou.

export type PublicPhase = "legado" | "antes" | "depois" | "publicado";

export type PublicEntry = {
  teamId: number;
  teamName: string;
  members: string[];
  status: EntryStatus;
  showContent: boolean;
  title: string | null;
  tagline: string | null;
  logoUrl: string | null;
  videoUrl: string | null;
  stageVideoUrl: string | null;
  technologies: string[];
  placement: number;
  finalist: boolean;
  awards: string[];
};

export type CategoryResult = {
  categoryId: number;
  name: string;
  kind: PrizeKind;
  winners: { place: number; teamId: number; teamName: string; title: string | null }[];
};

export type EditionEntriesView = {
  phase: PublicPhase;
  lockAt: string | null;
  counts: { teams: number; submitted: number };
  entries: PublicEntry[];
  results: CategoryResult[];
};

type TeamRow = {
  id: number;
  name: string;
  placement: number;
  finalist: number;
  reopenedUntil: string | null;
  title: string | null;
  tagline: string | null;
  logoUrl: string | null;
  videoUrl: string | null;
  stageVideoUrl: string | null;
  technologies: string | null;
  members: string;
};

const list = (v: string | null): string[] => {
  try {
    const p = JSON.parse(v ?? "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

async function phaseOf(hackathonId: string, now: Date) {
  const [settings, published] = await Promise.all([getSubmissionSettings(hackathonId), isPublished(hackathonId)]);
  const phase: PublicPhase = !flowEnabled(settings)
    ? "legado"
    : published
      ? "publicado"
      : deadlinePassed(settings, now)
        ? "depois"
        : "antes";
  return { settings, published: !!published, phase };
}

export async function getEditionEntriesView(hackathonId: string, now = new Date()): Promise<EditionEntriesView> {
  const { settings, published, phase } = await phaseOf(hackathonId, now);
  const [teams, versions, winners] = await Promise.all([
    db
      .prepare(
        `SELECT t.id, t.name, t.placement, t.finalist, t.reopenedUntil,
                tp.title, tp.tagline, tp.logoUrl, tp.videoUrl, tp.stageVideoUrl, tp.technologies,
                COALESCE((SELECT string_agg(tm.username, ',' ORDER BY tm.username)
                          FROM team_members tm WHERE tm.teamId = t.id), '') AS members
         FROM teams t LEFT JOIN team_projects tp ON tp.teamId = t.id
         WHERE t.hackathonId = ?
         ORDER BY CASE WHEN t.placement = 0 THEN 99 ELSE t.placement END, t.name`,
      )
      .all<TeamRow>(hackathonId),
    judgedVersions(hackathonId),
    published ? listWinners(hackathonId) : Promise.resolve([]),
  ]);

  const legacy = phase === "legado";
  const submitted = legacy ? teams.filter((t) => t.title !== null).length : versions.size;
  const at = lockAt(settings);

  const awardsByTeam = new Map<number, string[]>();
  for (const w of winners) {
    awardsByTeam.set(w.teamId, [...(awardsByTeam.get(w.teamId) ?? []), `${w.place}º · ${w.categoryName}`]);
  }

  const entries: PublicEntry[] =
    phase === "antes"
      ? []
      : teams.map((t) => {
          const v = versions.get(t.id);
          const status: EntryStatus = legacy
            ? t.title !== null
              ? "travado"
              : "nao_entregue"
            : deriveStatus(!!v, isLocked(settings, t.reopenedUntil, now));
          const snap = legacy ? null : (v?.snapshot ?? null);
          const showContent =
            (legacy ? t.title !== null : !!v) && (phase !== "depois" || !!settings?.entriesShowContent);
          return {
            teamId: t.id,
            teamName: t.name,
            members: t.members ? t.members.split(",") : [],
            status,
            showContent,
            title: legacy ? t.title : (snap?.title ?? null),
            tagline: showContent ? (legacy ? t.tagline : (snap?.tagline ?? null)) : null,
            logoUrl: showContent ? (legacy ? t.logoUrl : (snap?.logoUrl ?? null)) : null,
            videoUrl: showContent ? (legacy ? t.videoUrl : (snap?.videoUrl ?? null)) : null,
            stageVideoUrl: published ? t.stageVideoUrl : null,
            technologies: showContent ? (legacy ? list(t.technologies) : (snap?.technologies ?? [])) : [],
            placement: published || legacy ? t.placement : 0,
            finalist: t.finalist === 1,
            awards: awardsByTeam.get(t.id) ?? [],
          };
        });

  const results: CategoryResult[] = [];
  for (const w of winners) {
    let r = results.find((x) => x.categoryId === w.categoryId);
    if (!r) {
      r = { categoryId: w.categoryId, name: w.categoryName, kind: w.kind, winners: [] };
      results.push(r);
    }
    r.winners.push({ place: w.place, teamId: w.teamId, teamName: w.teamName, title: w.title });
  }

  // sem categorias cadastradas, o pódio do júri (teams.placement) vira o "geral"
  const podium = teams.filter((t) => t.placement >= 1 && t.placement <= 3);
  if (results.length === 0 && podium.length > 0 && (published || legacy)) {
    results.push({
      categoryId: 0,
      name: "Pódio",
      kind: "geral",
      winners: podium.map((t) => ({ place: t.placement, teamId: t.id, teamName: t.name, title: t.title })),
    });
  }

  return {
    phase,
    lockAt: at ? toDbTime(at) : null,
    counts: { teams: teams.length, submitted },
    entries,
    results,
  };
}

/**
 * Arquivo da edição (/h/[id] "Resultado") respeitando a matriz: antes do
 * prazo nenhum projeto aparece; depois, só a versão avaliada de quem entregou.
 */
export async function visibleArchive(
  hackathonId: string,
  archive: EditionArchive,
  now = new Date(),
): Promise<EditionArchive> {
  const settings = await getSubmissionSettings(hackathonId);
  if (!flowEnabled(settings)) return archive;
  if (!deadlinePassed(settings, now)) return { ...archive, teams: [] };
  const versions = await judgedVersions(hackathonId);
  return {
    ...archive,
    teams: archive.teams.map((t) => {
      const s = versions.get(t.id)?.snapshot;
      return {
        ...t,
        project: s
          ? {
              title: s.title,
              description: s.tagline ?? s.description,
              repoUrl: s.repoUrl,
              demoUrl: s.demoUrl,
              videoUrl: s.videoUrl,
              logoUrl: s.logoUrl,
            }
          : null,
      };
    }),
  };
}

// ---------- /p/[teamId] ----------

export type ProjectView = {
  teamId: number;
  teamName: string;
  hackathonId: string;
  hackathonName: string;
  members: string[];
  placement: number;
  finalist: boolean;
  phase: PublicPhase;
  status: EntryStatus;
  /** false = só título/time (antes do prazo, ou edição que esconde conteúdo) */
  showContent: boolean;
  /** viewer vê o rascunho atual (integrante/organização antes do prazo) */
  isDraftPreview: boolean;
  fields: EntryFields | null;
  title: string;
  judged: Pick<JudgedVersion, "version" | "submittedAt"> | null;
  afterNotes: string | null;
  stageVideoUrl: string | null;
  awards: string[];
  challenges: { id: string; title: string; sponsor: string }[];
  isMember: boolean;
};

export async function getProjectView(
  teamId: number,
  viewer: { id: number; role: string; username: string } | null,
  now = new Date(),
): Promise<ProjectView | null> {
  const entry = await getEntry(teamId, now);
  if (!entry || !entry.fields) return null;
  const [{ settings, published, phase }, h, versions, winners] = await Promise.all([
    phaseOf(entry.hackathonId, now),
    db
      .prepare(
        `SELECT h.name, t.placement FROM teams t JOIN hackathons h ON h.id = t.hackathonId WHERE t.id = ?`,
      )
      .get<{ name: string; placement: number }>(teamId),
    judgedVersions(entry.hackathonId),
    listWinners(entry.hackathonId),
  ]);
  const isMember = !!viewer && entry.members.includes(viewer.username);
  const isStaff = !!viewer && (await hasEditionRole(viewer, entry.hackathonId, "staff"));
  const judged = phase === "legado" ? null : (versions.get(teamId) ?? null);

  let fields: EntryFields | null = null;
  let isDraftPreview = false;
  let showContent = true;
  if (phase === "legado") {
    fields = entry.fields;
  } else if (phase === "antes" || (entry.status !== "travado" && entry.status !== "nao_entregue" && !judged)) {
    // antes do prazo (ou reaberto sem versão): só quem é do time/organização vê o rascunho
    if (isMember || isStaff) {
      fields = entry.fields;
      isDraftPreview = true;
    } else {
      showContent = false;
    }
  } else if (judged) {
    showContent = phase === "publicado" || settings!.entriesShowContent || isMember || isStaff;
    fields = showContent ? judged.snapshot : null;
  } else {
    showContent = false; // não entregue
  }

  const challengeIds = fields?.challengeIds ?? [];
  const challenges =
    challengeIds.length === 0
      ? []
      : await db
          .prepare(`SELECT id, title, sponsor FROM challenges WHERE id = ANY(?) ORDER BY seq`)
          .all<{ id: string; title: string; sponsor: string }>(challengeIds);

  return {
    teamId,
    teamName: entry.teamName,
    hackathonId: entry.hackathonId,
    hackathonName: h?.name ?? "",
    members: entry.members,
    placement: published || phase === "legado" ? (h?.placement ?? 0) : 0,
    finalist: entry.finalist,
    phase,
    status: entry.status,
    showContent,
    isDraftPreview,
    fields,
    title: fields?.title ?? judged?.snapshot.title ?? entry.fields.title,
    judged: judged ? { version: judged.version, submittedAt: judged.submittedAt } : null,
    afterNotes: entry.afterNotes,
    stageVideoUrl: published || isStaff ? entry.stageVideoUrl : null,
    awards: winners.filter((w) => w.teamId === teamId).map((w) => `${w.place}º lugar · ${w.categoryName}`),
    challenges,
    isMember,
  };
}
