import db from "@/lib/db";
import { hiddenIdsFor } from "@/lib/blocks";
import { listCommunities, nearby, type CommunityListItem } from "@/lib/communities";
import { followStates } from "@/lib/follows";
import { canNetwork } from "@/lib/network";

// Sugestão de quem seguir e de qual comunidade entrar (spec 046, onda 2).
// É o estado vazio da aba "seguindo" do /feed: em vez de uma tela morta, a
// pessoa vê quem já cruzou com ela.
//
// - suggestPeople(meId, 6): quem eu ainda não sigo, nesta ordem: quem fez
//   time comigo (o mesmo join de sameTeam, lib/evidence.ts), quem está numa
//   comunidade minha, quem tem skill ou persona em comum. Nunca por
//   popularidade: dentro de cada faixa a ordem é a do vínculo (time mais
//   recente, entrada mais recente na comunidade, conta mais nova).
// - Fora da lista: eu, quem eu já sigo, conta excluída, bloqueio nos dois
//   sentidos e silêncio (hiddenIdsFor). Quem aparece pra outra pessoa passa
//   por canNetwork (lib/network.ts), a regra única de contato da rede.
// - suggestCommunities(meId, 4): a mesma lógica do CommunitySuggestions do
//   onboarding (cidade do perfil, depois estado), sem as que eu já
//   acompanho; sem nada perto, cai pras comunidades com atividade recente.
// - Sugerir não dá XP, badge nem item do bicho (plano 046, naoFazer).

export const SUGGEST_PEOPLE = 6;
export const SUGGEST_COMMUNITIES = 4;

export type SuggestReason = "time" | "comunidade" | "skill" | "persona";

export type SuggestPerson = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  reason: SuggestReason;
  /** time ou comunidade em comum; null em skill/persona */
  shared: string | null;
};

type Row = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  shared: string | null;
};

// a forma de sameTeam (lib/evidence.ts): mesmo time, por username
const TEAM_SQL = `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline,
       MAX(t.id) AS rank, (array_agg(h.name ORDER BY t.id DESC))[1] AS shared
  FROM members me
  JOIN team_members tme ON tme.username = me.username
  JOIN teams t ON t.id = tme.teamId
  JOIN team_members tm ON tm.teamId = t.id AND tm.username <> me.username
  JOIN members m ON m.username = tm.username
  JOIN hackathons h ON h.id = t.hackathonId
  WHERE me.id = @me AND m.clerkId NOT LIKE 'deleted:%'
  GROUP BY m.id, m.username, m.name, m.avatarUrl, m.headline
  ORDER BY MAX(t.id) DESC
  LIMIT 30`;

// mesma comunidade: a que eu tenho em comum, entrando mais recente primeiro
const COMMUNITY_SQL = `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline,
       MAX(cm.joinedAt) AS rank, (array_agg(c.name ORDER BY cm.joinedAt DESC))[1] AS shared
  FROM community_members mine
  JOIN communities c ON c.id = mine.communityId AND c.hidden = 0
  JOIN community_members cm ON cm.communityId = mine.communityId AND cm.memberId <> mine.memberId
  JOIN members m ON m.id = cm.memberId
  WHERE mine.memberId = @me AND m.clerkId NOT LIKE 'deleted:%'
  GROUP BY m.id, m.username, m.name, m.avatarUrl, m.headline
  ORDER BY MAX(cm.joinedAt) DESC
  LIMIT 30`;

// skill ou persona em comum: o overlap de skills é JSON, então filtra em JS
const PEER_SQL = `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline, m.persona, m.skills
  FROM members m
  WHERE m.id <> @me AND m.clerkId NOT LIKE 'deleted:%'
  ORDER BY m.id DESC
  LIMIT 300`;

type PeerRow = Omit<Row, "shared"> & { persona: string | null; skills: string };

function skillsOf(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map((s) => s.trim().toLowerCase()) : [];
  } catch {
    return [];
  }
}

/**
 * Quem seguir agora. `limit` 6 por padrão (o vazio da aba seguindo).
 * Devolve na ordem das faixas: time, comunidade, skill, persona.
 */
export async function suggestPeople(meId: number, limit = SUGGEST_PEOPLE): Promise<SuggestPerson[]> {
  const size = Math.min(Math.max(Math.floor(limit) || SUGGEST_PEOPLE, 1), 12);
  const [following, hidden, me, team, community, peers] = await Promise.all([
    db.prepare("SELECT followedId AS id FROM member_follows WHERE memberId = ?").all<{ id: number }>(meId),
    hiddenIdsFor(meId),
    db.prepare("SELECT persona, skills FROM members WHERE id = ?").get<{ persona: string | null; skills: string }>(meId),
    db.prepare(TEAM_SQL).all<Row>({ me: meId }),
    db.prepare(COMMUNITY_SQL).all<Row>({ me: meId }),
    db.prepare(PEER_SQL).all<PeerRow>({ me: meId }),
  ]);
  const skip = new Set<number>([
    meId,
    ...following.map((r) => Number(r.id)),
    ...hidden.blocked,
    ...hidden.muted,
  ]);
  const mySkills = new Set(skillsOf(me?.skills));
  const myPersona = me?.persona?.trim().toLowerCase() ?? "";

  const buckets: { reason: SuggestReason; rows: Row[] }[] = [
    { reason: "time", rows: team },
    { reason: "comunidade", rows: community },
  ];
  const bySkill: Row[] = [];
  const byPersona: Row[] = [];
  for (const r of peers) {
    if (mySkills.size > 0 && skillsOf(r.skills).some((s) => mySkills.has(s))) {
      bySkill.push({ id: r.id, username: r.username, name: r.name, avatarUrl: r.avatarUrl, headline: r.headline, shared: null });
    } else if (myPersona && r.persona?.trim().toLowerCase() === myPersona) {
      byPersona.push({ id: r.id, username: r.username, name: r.name, avatarUrl: r.avatarUrl, headline: r.headline, shared: null });
    }
  }
  buckets.push({ reason: "skill", rows: bySkill }, { reason: "persona", rows: byPersona });

  const out: SuggestPerson[] = [];
  for (const bucket of buckets) {
    for (const r of bucket.rows) {
      if (out.length >= size) return out;
      const id = Number(r.id);
      if (skip.has(id)) continue;
      skip.add(id);
      if (!(await canNetwork(id))) continue;
      out.push({
        id,
        username: r.username,
        name: r.name,
        avatarUrl: r.avatarUrl,
        headline: r.headline,
        reason: bucket.reason,
        shared: r.shared,
      });
    }
  }
  return out;
}

/**
 * Qual comunidade entrar agora. Mesma ideia do onboarding
 * (components/CommunitySuggestions): cidade do perfil, depois estado, sem as
 * que eu já acompanho; se não tem nada perto, as de atividade mais recente.
 */
export async function suggestCommunities(meId: number, limit = SUGGEST_COMMUNITIES): Promise<CommunityListItem[]> {
  const size = Math.min(Math.max(Math.floor(limit) || SUGGEST_COMMUNITIES, 1), 8);
  const [me, states, list] = await Promise.all([
    db.prepare("SELECT city FROM members WHERE id = ?").get<{ city: string | null }>(meId),
    followStates(meId),
    listCommunities({ limit: 200 }),
  ]);
  const skip = new Set<number>([...states.member, ...states.following]);
  const free = list.filter((c) => !skip.has(c.id));
  const near = nearby(free, me?.city ?? null).map((n) => n.item);
  const out: CommunityListItem[] = [];
  for (const c of [...near, ...free]) {
    if (out.length >= size) break;
    if (!out.some((x) => x.id === c.id)) out.push(c);
  }
  return out;
}
