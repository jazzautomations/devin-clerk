import db from "@/lib/db";
import { getHackathon } from "@/lib/hackathons";
import { hashMascote, mascoteSrc } from "@/lib/mascote/isometrico";
import { resolveMascote } from "@/lib/mascote/semente";
import { canNetwork } from "@/lib/network";
import { MAX_MALHA, SALAO_MAX, type SalaoBicho, type SalaoTime } from "@/lib/telaoLayout";
import type { MascoteConfig } from "@/lib/mascote/tipos";

// Salão do telão (spec 046, onda 4 — telao-e-bicho-do-time): quem está
// presente na edição e o bicho de cada um. O telão é público e roda no
// projetor sem login, então a regra de consentimento é a mesma da lista de
// inscritos (migration 016): APARECER é opt-in (registrations.publicListing);
// quem não consentiu entra só na contagem, nunca no JSON.
//
// Contadores: `presentes` é todo mundo com check-in na edição (agregado, sem
// dado pessoal); `times`/`entregas` são os grupos que o telão desenha — time
// com pelo menos um bicho visível e, dentro desses, os que entregaram.
//
// Performance: `configs` só traz o config dos MAX_MALHA primeiros (o que vira
// malha 3D de verdade); o resto da cena são sprites desenhados do SVG. O
// resultado de canNetwork fica em cache curto — o telão faz polling de 10s e
// a resposta de "essa pessoa pode aparecer" não muda a cada poll.

export type Salao = {
  presentes: number;
  times: number;
  entregas: number;
  bichos: SalaoBicho[];
  teams: SalaoTime[];
  /** config dos bichos que viram malha 3D (até MAX_MALHA) */
  configs: Record<number, MascoteConfig>;
};

type PresenteRow = {
  memberId: number;
  username: string;
  name: string | null;
  mascote: string | null;
  publicListing: number;
};

type TimeRow = { id: number; name: string; delivered: boolean };

type MembroTimeRow = { teamId: number; username: string };

const CAN_NETWORK_TTL_MS = 60_000;
const canCache = new Map<number, { ok: boolean; at: number }>();

async function podeAparecer(memberId: number, now: number): Promise<boolean> {
  const hit = canCache.get(memberId);
  if (hit && now - hit.at < CAN_NETWORK_TTL_MS) return hit.ok;
  const ok = await canNetwork(memberId);
  canCache.set(memberId, { ok, at: now });
  return ok;
}

/** só testes: esquece o cache de consentimento/rede */
export function resetSalaoCache(): void {
  canCache.clear();
}

const primeiroNome = (name: string | null, username: string): string => {
  const n = (name ?? "").trim().split(/\s+/)[0];
  return n || username;
};

/**
 * O salão da edição. `null` quando a edição não existe ou não roda no
 * HackaHub (mesma regra de "hospedado" do resto do site) — a rota devolve
 * 404 nesse caso.
 */
export async function salaoDaEdicao(hackathonId: string): Promise<Salao | null> {
  const h = await getHackathon(hackathonId);
  if (!h || !h.active || !h.hosted) return null;

  const [contagem, presentes, times, vinculos] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*)::int AS n FROM registrations r JOIN checkins c ON c.registrationId = r.id
         WHERE r.hackathonId = ? AND r.status = 'approved'`,
      )
      .get<{ n: number }>(hackathonId),
    db
      .prepare(
        `SELECT m.id AS memberId, m.username, m.name, m.mascote, r.publicListing AS publicListing
         FROM registrations r
         JOIN checkins c ON c.registrationId = r.id
         JOIN members m ON m.id = r.memberId
         WHERE r.hackathonId = ? AND r.status = 'approved'
         ORDER BY m.id`,
      )
      .all<PresenteRow>(hackathonId),
    db
      .prepare(
        `SELECT t.id, t.name,
                EXISTS (SELECT 1 FROM project_submissions ps WHERE ps.teamId = t.id) AS delivered
         FROM teams t WHERE t.hackathonId = ?
         ORDER BY t.id`,
      )
      .all<TimeRow>(hackathonId),
    db
      .prepare(
        `SELECT tm.teamId, tm.username FROM team_members tm
         JOIN teams t ON t.id = tm.teamId
         WHERE t.hackathonId = ?
         ORDER BY tm.teamId`,
      )
      .all<MembroTimeRow>(hackathonId),
  ]);

  const timeDoMembro = new Map<string, number>();
  for (const v of vinculos) if (!timeDoMembro.has(v.username)) timeDoMembro.set(v.username, v.teamId);

  const now = Date.now();
  const consentidos = presentes.filter((p) => Number(p.publicListing) === 1);
  const liberados = await Promise.all(consentidos.map((p) => podeAparecer(p.memberId, now)));

  const bichos: SalaoBicho[] = [];
  for (const [i, p] of consentidos.entries()) {
    if (!liberados[i]) continue;
    const config = resolveMascote({ id: p.memberId, mascote: p.mascote });
    bichos.push({
      memberId: p.memberId,
      primeiroNome: primeiroNome(p.name, p.username),
      src: mascoteSrc(p.memberId, hashMascote(config)),
      teamId: timeDoMembro.get(p.username) ?? null,
    });
  }
  const visiveis = bichos.slice(0, SALAO_MAX);

  const timePorId = new Map(times.map((t) => [Number(t.id), t]));
  const idsPresentes = [...new Set(visiveis.map((b) => b.teamId).filter((id): id is number => id !== null))].sort(
    (a, b) => a - b,
  );
  const teams: SalaoTime[] = idsPresentes.map((id) => {
    const t = timePorId.get(id);
    return {
      id,
      name: t?.name ?? "time",
      delivered: Boolean(t?.delivered),
      src: `/api/mascote/time/${id}`,
    };
  });

  const configs: Record<number, MascoteConfig> = {};
  const mascotePorId = new Map(presentes.map((p) => [p.memberId, p.mascote]));
  for (const b of visiveis.slice(0, MAX_MALHA)) {
    configs[b.memberId] = resolveMascote({ id: b.memberId, mascote: mascotePorId.get(b.memberId) ?? null });
  }

  return {
    presentes: Number(contagem?.n ?? 0),
    times: teams.length,
    entregas: teams.filter((t) => t.delivered).length,
    bichos: visiveis,
    teams,
    configs,
  };
}
