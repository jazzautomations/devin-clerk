import db from "@/lib/db";
import type { EditionArchive } from "@/lib/archive";
import {
  deadlinePassed,
  deriveStatus,
  flowEnabled,
  getEntry,
  getSubmissionSettings,
  judgedVersions,
  lockAt,
  toDbTime,
  showcaseDiffers,
  type EntryFields,
  type EntryStatus,
  type JudgedVersion,
  type ShowcaseFields,
} from "@/lib/entries";
import { canNetwork } from "@/lib/network";
import { parseTechEntries, type TechEntry } from "@/lib/techTags";
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
            // lista pública só existe depois do prazo: quem enviou conta como
            // entregue mesmo com reabertura em curso (não mostra "enviado" ×
            // "entregue" pra mesma situação)
            : deriveStatus(!!v, true);
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

/** "Quem fez": integrante fora do canNetwork aparece só como "integrante" */
export type TeamCredit = {
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** papel atual */
  role: string | null;
  /** papel na versão entregue */
  deliveredRole: string | null;
};

/** id de vídeo do YouTube validado (11 caracteres); null pra qualquer outra coisa */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^(www\.|m\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
      id = m ? m[2] : null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

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
  /** vitrine atual (história, capa, galeria); null quando o conteúdo não aparece */
  showcase: ShowcaseFields | null;
  /** vitrine da versão avaliada, pra "ver como foi entregue" */
  delivered: ShowcaseFields | null;
  /** a vitrine mudou depois da entrega travada */
  updatedAfterDelivery: boolean;
  credits: TeamCredit[];
  /** "Feito com": tag + rótulo, na ordem do time */
  tech: TechEntry[];
  editionStartsAt: string | null;
  /** quem não tem conta vê a página completa (spec 046) */
  openToPublic: boolean;
};

/**
 * Texto do cartão público de /p pra quem não tem conta (puro). Só promete
 * que o projeto abre quando ainda pode abrir: time que não entregou não
 * ganha promessa, e conteúdo que já aparece pra quem entra (time abandonado,
 * edição fora do ar) fica pra quem tem conta.
 */
export function anonProjectNote(v: Pick<ProjectView, "status" | "showContent">): string {
  if (v.status === "nao_entregue") return "Este time não entregou projeto nesta edição.";
  if (v.showContent) return "O projeto completo fica pra quem tem conta.";
  return "O projeto entregue aparece aqui quando a edição publica as entregas.";
}

export async function getProjectView(
  teamId: number,
  viewer: { id: number; role: string; username: string } | null,
  now = new Date(),
): Promise<ProjectView | null> {
  const entry = await getEntry(teamId, now);
  if (!entry || !entry.fields) return null;
  const [{ settings, published, phase }, h, versions, winners, people] = await Promise.all([
    phaseOf(entry.hackathonId, now),
    db
      .prepare(
        `SELECT h.name, h.startsAt, h.active, h.publishedAt, t.placement
         FROM teams t JOIN hackathons h ON h.id = t.hackathonId WHERE t.id = ?`,
      )
      .get<{ name: string; startsAt: string | null; active: number; publishedAt: string | null; placement: number }>(
        teamId,
      ),
    judgedVersions(entry.hackathonId),
    listWinners(entry.hackathonId),
    db
      .prepare(
        `SELECT tm.username, m.id, m.name, m.avatarUrl
         FROM team_members tm LEFT JOIN members m ON m.username = tm.username
         WHERE tm.teamId = ? ORDER BY tm.username`,
      )
      .all<{ username: string; id: number | null; name: string | null; avatarUrl: string | null }>(teamId),
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

  // vitrine: a atual quando o conteúdo aparece (o júri não avalia, segue
  // editável depois da trava); a entregue sai do snapshot avaliado
  const showcase = showContent ? entry.showcase : null;
  const delivered = showContent && judged && !isDraftPreview ? judged.snapshot : null;
  const updatedAfterDelivery =
    !!delivered &&
    !!entry.showcase &&
    deadlinePassed(settings, now) &&
    showcaseDiffers({ ...entry.showcase, roles: entry.roles }, delivered);

  const visible = await Promise.all(
    people.map((p) => (p.id === null ? Promise.resolve(false) : canNetwork(p.id, entry.hackathonId))),
  );
  const credits: TeamCredit[] = people.map((p, i) =>
    visible[i]
      ? {
          username: p.username,
          name: p.name,
          avatarUrl: p.avatarUrl,
          // papel é texto da vitrine: some junto com ela antes da trava
          role: showContent ? (entry.roles[p.username] ?? null) : null,
          deliveredRole: showContent ? (delivered?.roles[p.username] ?? null) : null,
        }
      : { username: null, name: null, avatarUrl: null, role: null, deliveredRole: null },
  );

  const abandoned = entry.versions.length > 0 && entry.members.length === 0;
  const editionPublic = !!h && (h.active === 1 || !!h.publishedAt);

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
    showcase,
    delivered,
    updatedAfterDelivery,
    credits,
    tech: parseTechEntries(fields?.technologies ?? []),
    editionStartsAt: h?.startsAt ?? null,
    openToPublic: editionPublic && showContent && !isDraftPreview && !abandoned,
  };
}
