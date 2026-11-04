import db from "@/lib/db";
import { hiddenIdsFor } from "@/lib/blocks";

// Missões do encontro (spec 046, onda 5 — migration 050).
//
// SUGESTÕES, não etapa: o organizador liga por edição
// (hackathons."encounterMissionsOn", desligado por padrão) e nada bloqueia
// por missão feita ou não. O servidor verifica pelo perfil de quem estava no
// encontro confirmado — nunca pelo que a pessoa digita.
//
// Contadores da tela: "pessoas" (encontros confirmados, gente distinta) e
// "além do oi" (os dois marcaram "fomos além do oi"). Sem ranking, sem XP
// (spec 043): só selo e item do bicho.
//
// 10 pessoas distintas dão o selo 'roda'; 3 pontes dão 'ponte' (lib/game.ts
// já declara os dois com o item que cada um veste: antena e mapa).

export const MISSION_KEYS = ["primeira-viagem", "mentor", "outra-faculdade", "ponte"] as const;
export type MissionKey = (typeof MISSION_KEYS)[number];

export type MissionDef = { key: MissionKey; label: string; note: string };

export const MISSIONS: MissionDef[] = [
  {
    key: "primeira-viagem",
    label: "primeira viagem",
    note: "conversar com quem está no primeiro hackathon e topou aparecer como estreante",
  },
  { key: "mentor", label: "um mentor", note: "conversar com quem é mentor desta edição" },
  {
    key: "outra-faculdade",
    label: "outra faculdade ou cidade",
    note: "conversar com quem vem de outra faculdade ou cidade",
  },
  { key: "ponte", label: "ponte", note: "apresentar duas pessoas que acabam se encontrando" },
];

export const MISSION_LABEL: Record<MissionKey, string> = {
  "primeira-viagem": "primeira viagem",
  mentor: "um mentor",
  "outra-faculdade": "outra faculdade ou cidade",
  ponte: "ponte",
};

export type EncounterDepth = "rapido" | "alem";

/**
 * Profundidade do par: só conta quando OS DOIS marcaram "fomos além do oi".
 * Um lado "além" e o outro "papo rápido" (ou sem resposta) não é profundo.
 */
export function mutualDepth(a: string | null, b: string | null): "alem" | "rapido" | null {
  if (a === "alem" && b === "alem") return "alem";
  if (!a && !b) return null;
  return "rapido";
}

export function countsAsDeep(a: string | null, b: string | null): boolean {
  return mutualDepth(a, b) === "alem";
}

export type MissionProgress = { key: MissionKey; label: string; note: string; done: boolean; count: number };

export type EncounterCounters = { people: number; deep: number; bridges: number };

type PeerRow = {
  peerId: number;
  peerName: string | null;
  peerUsername: string;
  peerAvatar: string | null;
  peerPersonas: string | null;
  peerInstitution: string | null;
  peerCity: string | null;
  peerNewcomer: number;
  peerMentor: boolean;
  otherEditions: number;
  myInstitution: string | null;
  myCity: string | null;
};

const PEERS_SQL = `SELECT m.id AS "peerId", m.name AS "peerName", m.username AS "peerUsername",
    m.avatarUrl AS "peerAvatar", m.personas AS "peerPersonas", m.institution AS "peerInstitution",
    m.city AS "peerCity",
    COALESCE((SELECT mc."newcomerOptIn" FROM edition_meet_codes mc
              WHERE mc."memberId" = m.id AND mc."hackathonId" = @h), 0) AS "peerNewcomer",
    EXISTS (SELECT 1 FROM edition_roles er
            WHERE er."memberId" = m.id AND er."hackathonId" = @h AND er.role = 'mentor') AS "peerMentor",
    (SELECT COUNT(*)::int FROM registrations r
      WHERE r."memberId" = m.id AND r.status = 'approved' AND r."hackathonId" <> @h) AS "otherEditions",
    a.institution AS "myInstitution", a.city AS "myCity"
  FROM encounters e
  JOIN members m ON m.id = CASE WHEN e."lowId" = @me THEN e."highId" ELSE e."lowId" END
  JOIN members a ON a.id = @me
  WHERE e."hackathonId" = @h AND e.status = 'confirmed' AND (e."lowId" = @me OR e."highId" = @me)`;

async function peersOf(memberId: number, hackathonId: string): Promise<PeerRow[]> {
  return db.prepare(PEERS_SQL).all<PeerRow>({ me: memberId, h: hackathonId });
}

/** pontes que contam: X e Y confirmaram encontro entre si depois da apresentação */
export async function bridgeCount(memberId: number, hackathonId?: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM introductions i
       WHERE i."memberId" = @me ${hackathonId ? `AND i."hackathonId" = @h` : ""}
         AND EXISTS (SELECT 1 FROM encounters e
                     WHERE e."hackathonId" = i."hackathonId" AND e.status = 'confirmed'
                       AND ((e."lowId" = i."peerId" AND e."highId" = i."recipientId")
                         OR (e."lowId" = i."recipientId" AND e."highId" = i."peerId"))
                       AND to_ts(e."confirmedAt") >= to_ts(i."createdAt"))`,
    )
    .get<{ n: number }>({ me: memberId, h: hackathonId ?? "" });
  return Number(row?.n ?? 0);
}

/** contadores da tela: gente distinta confirmada e profundidade mútua */
export async function encounterCounters(memberId: number, hackathonId: string): Promise<EncounterCounters> {
  const people = await db
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN e."lowId" = @me THEN e."highId" ELSE e."lowId" END)::int AS n
       FROM encounters e
       WHERE e."hackathonId" = @h AND e.status = 'confirmed' AND (e."lowId" = @me OR e."highId" = @me)`,
    )
    .get<{ n: number }>({ me: memberId, h: hackathonId });
  const deep = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM encounters e
       WHERE e."hackathonId" = @h AND e.status = 'confirmed' AND (e."lowId" = @me OR e."highId" = @me)
         AND EXISTS (SELECT 1 FROM encounter_sides a
                     WHERE a."encounterId" = e.id AND a."memberId" = @me AND a.depth = 'alem')
         AND EXISTS (SELECT 1 FROM encounter_sides b
                     WHERE b."encounterId" = e.id AND b."memberId" <> @me AND b.depth = 'alem')`,
    )
    .get<{ n: number }>({ me: memberId, h: hackathonId });
  return {
    people: Number(people?.n ?? 0),
    deep: Number(deep?.n ?? 0),
    bridges: await bridgeCount(memberId, hackathonId),
  };
}

/** missões da edição, verificadas pelo perfil de quem estava no encontro */
export async function missionProgress(memberId: number, hackathonId: string): Promise<MissionProgress[]> {
  const [peers, bridges] = await Promise.all([peersOf(memberId, hackathonId), bridgeCount(memberId, hackathonId)]);
  const newcomer = peers.filter((p) => Number(p.peerNewcomer) === 1 && Number(p.otherEditions) === 0).length;
  const mentor = peers.filter((p) => Boolean(p.peerMentor)).length;
  const elsewhere = peers.filter((p) => {
    const otherSchool = !!p.peerInstitution && !!p.myInstitution && p.peerInstitution !== p.myInstitution;
    const otherCity = !!p.peerCity && !!p.myCity && p.peerCity !== p.myCity;
    return otherSchool || otherCity;
  }).length;
  const count: Record<MissionKey, number> = {
    "primeira-viagem": newcomer,
    mentor,
    "outra-faculdade": elsewhere,
    ponte: bridges,
  };
  return MISSIONS.map((m) => ({ ...m, done: count[m.key] > 0, count: count[m.key] }));
}

export type MissionSuggestion = {
  mission: MissionKey;
  missionLabel: string;
  people: { username: string; firstName: string; avatarUrl: string | null }[];
};

type CandidateRow = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  personas: string | null;
  institution: string | null;
  city: string | null;
  newcomer: number;
  mentor: boolean;
  otherEditions: number;
};

/**
 * "Procure no evento": até 3 pessoas por missão que ainda falta. Só entra
 * quem fez check-in, ativou os encontros, aceitou aparecer na lista pública
 * (registrations."publicListing") e está sem time. Nunca diz onde a pessoa
 * está — nome, bicho e nada mais.
 */
export async function suggestionsFor(
  memberId: number,
  hackathonId: string,
  myInstitution: string | null,
  myCity: string | null,
): Promise<MissionSuggestion[]> {
  const { blocked, muted } = await hiddenIdsFor(memberId);
  const hidden = [...new Set([...blocked, ...muted, memberId])];
  const rows = await db
    .prepare(
      `SELECT m.id, m.username, m.name, m.avatarUrl, m.personas, m.institution, m.city,
              COALESCE(mc."newcomerOptIn", 0) AS newcomer,
              EXISTS (SELECT 1 FROM edition_roles er
                      WHERE er."memberId" = m.id AND er."hackathonId" = @h AND er.role = 'mentor') AS mentor,
              (SELECT COUNT(*)::int FROM registrations r2
                WHERE r2."memberId" = m.id AND r2.status = 'approved' AND r2."hackathonId" <> @h) AS "otherEditions"
       FROM registrations r
       JOIN checkins c ON c."registrationId" = r.id
       JOIN members m ON m.id = r."memberId"
       JOIN edition_meet_codes mc ON mc."memberId" = m.id AND mc."hackathonId" = r."hackathonId"
            AND mc."pausedAt" IS NULL
       WHERE r."hackathonId" = @h AND r.status = 'approved' AND r."publicListing" = 1
         AND NOT (m.id = ANY(@hidden::int[]))
         AND NOT EXISTS (
           SELECT 1 FROM encounters e
           WHERE e."hackathonId" = @h AND e.status IN ('pending', 'confirmed')
             AND ((e."lowId" = @me AND e."highId" = m.id) OR (e."highId" = @me AND e."lowId" = m.id)))
         AND NOT EXISTS (
           SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm."teamId"
           WHERE tm.username = m.username AND t."hackathonId" = @h)
       ORDER BY m.id
       LIMIT 60`,
    )
    .all<CandidateRow>({ me: memberId, h: hackathonId, hidden });

  const progress = await missionProgress(memberId, hackathonId);
  const out: MissionSuggestion[] = [];
  for (const p of progress) {
    if (p.done) continue;
    let matches: CandidateRow[] = [];
    if (p.key === "primeira-viagem") {
      matches = rows.filter((r) => Number(r.newcomer) === 1 && Number(r.otherEditions) === 0);
    } else if (p.key === "mentor") {
      matches = rows.filter((r) => Boolean(r.mentor));
    } else if (p.key === "outra-faculdade") {
      matches = rows.filter((r) => {
        const otherSchool = !!r.institution && !!myInstitution && r.institution !== myInstitution;
        const otherCity = !!r.city && !!myCity && r.city !== myCity;
        return otherSchool || otherCity;
      });
    } else {
      continue; // ponte não se procura numa lista: acontece apresentando
    }
    if (matches.length === 0) continue;
    out.push({
      mission: p.key,
      missionLabel: p.label,
      people: matches.slice(0, 3).map((r) => ({
        username: r.username,
        firstName: (r.name ?? "").trim().split(/\s+/)[0] || `@${r.username}`,
        avatarUrl: r.avatarUrl,
      })),
    });
  }
  return out;
}

/**
 * Selos do encontro: 10 pessoas distintas confirmadas dão 'roda'; 3 pontes
 * dão 'ponte'. INSERT ... ON CONFLICT DO NOTHING (lib/game.ts não é editado:
 * os dois selos e os itens antena/mapa já estão declarados lá).
 */
export async function grantEncounterBadges(memberId: number): Promise<string[]> {
  const [people, bridges] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(DISTINCT CASE WHEN e."lowId" = ? THEN e."highId" ELSE e."lowId" END)::int AS n
         FROM encounters e
         WHERE e.status = 'confirmed' AND (e."lowId" = ? OR e."highId" = ?)`,
      )
      .get<{ n: number }>(memberId, memberId, memberId),
    bridgeCount(memberId),
  ]);
  const earned: string[] = [];
  if (Number(people?.n ?? 0) >= 10) earned.push("roda");
  if (bridges >= 3) earned.push("ponte");
  const fresh: string[] = [];
  for (const badgeId of earned) {
    const res = await db
      .prepare("INSERT OR IGNORE INTO member_badges (memberId, badgeId) VALUES (?, ?)")
      .run(memberId, badgeId);
    if (res.changes > 0) fresh.push(badgeId);
  }
  return fresh;
}
