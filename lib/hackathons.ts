import db from "@/lib/db";
import { parseEventTime } from "@/lib/eventTime";

export type HackathonFormat = "online" | "presencial" | "hibrido";

export type Hackathon = {
  id: string;
  name: string;
  organizer: string;
  startsAt: string;
  endsAt: string | null;
  format: HackathonFormat;
  location: string | null;
  registrationUrl: string;
  registrationDeadline: string | null;
  // display string da fonte/curadoria ("$138,000", "R$ 5 mil") — spec 024;
  // a UI repassa verbatim, nunca parseia
  prize: string | null;
  tags: string[];
  active: boolean;
  // roda no HackaHub: inscrição, time, entrega e certificado pela plataforma
  // (edição de comunidade, do painel ou do seed). false = evento externo do
  // radar, inscrição no site oficial. Regra única: isHostedRow / HOSTED_SQL.
  hosted: boolean;
  // spec 032 — edição curada: register entra como 'pending' e a recompensa
  // só cai na aprovação do admin (a coluna nasce do ALTER de registrations)
  requiresApproval: boolean;
  // radar Brasil-first (migration 023): região gravada pelo scraper e a
  // fonte ("sympla", "devpost+taikai"; null, "seed" ou "painel" = edição da casa). lib/radar.ts
  // deriva a região quando a coluna está vazia.
  region?: string | null;
  source?: string | null;
  // radar global (migration 026): alcance (global/latam/brasil/pais/cidade),
  // país, se brasileiro pode ('sim'/'nao'/null = não informado) com o trecho
  // da regra e o link, prêmio aproximado em US$ (só ordena/filtra), prazo de
  // entrega e marca por trás do evento. lib/radar.ts deriva o que faltar.
  scope?: string | null;
  country?: string | null;
  brazilOk?: string | null;
  eligibilityNote?: string | null;
  eligibilityUrl?: string | null;
  prizeUsd?: number | null;
  submissionDeadline?: string | null;
  brand?: string | null;
  // primeira vez que a edição ficou no ar (migration 019). Fora do ar com
  // publishedAt = arquivada; sem publishedAt = rascunho.
  publishedAt?: string | null;
  // texto e link do evento escritos por quem organiza (migration 027)
  description?: string | null;
  infoUrl?: string | null;
  // comunidade dona (migration 027). Nulo = evento externo do radar.
  communityId?: number | null;
  communitySlug?: string | null;
  communityName?: string | null;
  // comunidade escondida pela moderação: a edição some das listas
  communityHidden?: boolean;
};

type Row = Omit<Hackathon, "tags" | "active" | "hosted" | "requiresApproval" | "communityHidden"> & {
  tags: string;
  active: number;
  requiresApproval?: number;
  communityHidden?: number | null;
};

// toda leitura de edição traz a comunidade junto (nome e endereço pro link)
const SELECT = `SELECT h.*, c.slug AS "communitySlug", c.name AS "communityName", c.hidden AS "communityHidden"
  FROM hackathons h LEFT JOIN communities c ON c.id = h.communityId`;

function toHackathon(row: Row): Hackathon {
  return {
    ...row,
    tags: JSON.parse(row.tags),
    active: row.active === 1,
    hosted: isHostedRow(row),
    requiresApproval: row.requiresApproval === 1,
    communityHidden: row.communityHidden === 1,
  };
}

/**
 * "Roda no HackaHub": criada pela plataforma (seed ou painel) ou de uma
 * comunidade. O nome do organizador não decide nada — antes era "contém hack
 * inova", o que fazia da Hack Inova a dona da plataforma.
 */
export function isHostedRow(row: { source?: string | null; communityId?: number | null }): boolean {
  return row.source === "seed" || row.source === "painel" || (row.communityId ?? null) !== null;
}

/** a mesma regra em SQL, pra quem filtra no banco (alias da tabela hackathons) */
export const hostedSql = (alias = "h") =>
  `(${alias}.source IN ('seed', 'painel') OR ${alias}.communityId IS NOT NULL)`;

async function allActive(): Promise<Hackathon[]> {
  const rows = await db
    .prepare(`${SELECT} WHERE h.active = 1 AND COALESCE(c.hidden, 0) = 0`)
    .all() as Row[];
  return rows.map(toHackathon);
}

// spec 027 — "aberto" = ainda não encerrado. O fim efetivo é a primeira
// data disponível: endsAt (fim do evento/janela de submissão) → deadline
// de inscrição → startsAt. Evento cuja janela já abriu (Devpost usa
// startsAt = abertura da submissão) segue no radar enquanto roda —
// antes disso 43 ativos (25 c/ prêmio) sumiam da listagem.
// Data inválida (NaN) conta como "não encerrado": nunca esconde por dado ruim.
// Datas sem fuso são horário de Brasília (lib/eventTime, o mesmo parser do
// RSVP e do to_ts no banco) — new Date() leria no fuso do servidor.
const ts = (v: string | null | undefined) => parseEventTime(v)?.getTime() ?? NaN;

export function isOver(h: Hackathon, now = new Date()): boolean {
  const t = ts(h.endsAt ?? h.registrationDeadline ?? h.startsAt);
  return !Number.isNaN(t) && t < now.getTime();
}

// a data que importa agora: o início, se ainda não começou; o fim (ou o
// prazo), se já está rolando. Hackathon online do Devpost começa em junho e
// fica aberto até novembro — mostrar "24 JUN" em outubro parece lista velha.
export function nextDate(h: Hackathon, now = new Date()): { at: string; ongoing: boolean } {
  if (ts(h.startsAt) > now.getTime()) return { at: h.startsAt, ongoing: false };
  return { at: h.endsAt ?? h.registrationDeadline ?? h.startsAt, ongoing: true };
}

export async function getOpenHackathons(now = new Date()): Promise<Hackathon[]> {
  const key = (h: Hackathon) => ts(nextDate(h, now).at);
  return (await allActive())
    .filter((h) => !isOver(h, now))
    .sort((a, b) => key(a) - key(b));
}

// arquivo = complemento exato da lista aberta: edição rolando não é
// histórico; sem data de fim, startsAt passado é tudo que sabemos
export async function getPastHackathons(now = new Date()): Promise<Hackathon[]> {
  return (await allActive())
    .filter((h) => isOver(h, now))
    .sort((a, b) => ts(b.startsAt) - ts(a.startsAt));
}

// busca textual do radar (?q=, spec 023) — substring case-insensitive sobre
// nome/local/organizador/marca/país/tags. A lista já é materializada em JS (tags são JSON), então
// filtrar aqui é mais honesto que LIKE na coluna serializada
export async function searchHackathons(q: string, now = new Date()): Promise<Hackathon[]> {
  const list = await getOpenHackathons(now);
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((h) =>
    [h.name, h.location ?? "", h.organizer, h.brand ?? "", h.country ?? "", ...h.tags]
      .join("\n")
      .toLowerCase()
      .includes(needle),
  );
}

export async function getHackathon(id: string): Promise<Hackathon | null> {
  const row = await db
    .prepare(`${SELECT} WHERE h.id = ?`)
    .get(id) as Row | undefined;
  return row ? toHackathon(row) : null;
}

export function isRegistrationClosed(
  h: Pick<Hackathon, "registrationDeadline">,
  now = new Date(),
): boolean {
  const t = ts(h.registrationDeadline);
  return !Number.isNaN(t) && t < now.getTime();
}

/**
 * Hackathons de uma comunidade: no ar (próximos e encerrados) e, pra quem
 * organiza, os rascunhos. Arquivada (saiu do ar depois de publicada) não entra.
 */
export async function getCommunityHackathons(
  communityId: number,
  now = new Date(),
): Promise<{ upcoming: Hackathon[]; past: Hackathon[]; drafts: Hackathon[] }> {
  const rows = (await db
    .prepare(`${SELECT} WHERE h.communityId = ? AND (h.active = 1 OR h.publishedAt IS NULL)`)
    .all(communityId)) as Row[];
  const all = rows.map(toHackathon);
  const live = all.filter((h) => h.active);
  return {
    upcoming: live.filter((h) => !isOver(h, now)).sort((a, b) => ts(a.startsAt) - ts(b.startsAt)),
    past: live.filter((h) => isOver(h, now)).sort((a, b) => ts(b.startsAt) - ts(a.startsAt)),
    drafts: all.filter((h) => !h.active).sort((a, b) => ts(a.startsAt) - ts(b.startsAt)),
  };
}
