import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { emailDriver } from "@/lib/notify/email";
import { eventRegion } from "@/lib/regions";
import { absoluteUrl } from "@/lib/seo";
import { createReport, ReportError, resolveCommunityTargetReports } from "@/lib/reports";

// Comunidades (migration 027): faculdade, coletivo, cidade ou empresa que
// junta gente e organiza hackathon no HackaHub. Qualquer membro cria e vira
// dono; o dono convida organizadores; qualquer pessoa logada entra e sai.
// Admin global (members.role = 'admin') administra todas, inclusive as sem
// dono (a Hack Inova nasce assim), e modera (esconder, selo).

export const COMMUNITY_ROLES = ["dono", "organizador", "membro"] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

type Actor = { id: number; role: string };

export type Community = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  city: string | null;
  online: boolean;
  website: string | null;
  instagram: string | null;
  linkedin: string | null;
  discord: string | null;
  groupUrl: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  createdBy: number | null;
  createdAt: string;
  hidden: boolean;
  verified: boolean;
};

type Row = Omit<Community, "online" | "hidden" | "verified"> & { online: number; hidden: number; verified: number };

const toCommunity = (r: Row): Community => ({
  ...r,
  online: r.online === 1,
  hidden: r.hidden === 1,
  verified: r.verified === 1,
});

export class CommunityError extends Error {
  constructor(
    public code: "slug_taken" | "invalid" | "last_owner" | "not_member",
    message: string,
  ) {
    super(message);
  }
}

// ---------- validação ----------

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
// endereços que viram rota ou confundem com a plataforma
const RESERVED = new Set(["nova", "novo", "nova-comunidade", "editar", "admin", "api", "hackahub", "comunidade", "comunidades", "suporte"]);

export const COMMUNITY_LIMITS = { name: 60, description: 280, city: 60, url: 300, notice: 1000, noticeTitle: 90, report: 500 } as const;

export const LINK_FIELDS = ["website", "instagram", "linkedin", "discord", "groupUrl"] as const;
export const IMAGE_FIELDS = ["logoUrl", "coverUrl"] as const;

/** "Hack Club Sorocaba!" → "hack-club-sorocaba" (sem acento, até 40) */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED.has(slug) && !slug.includes("--");
}

/** link de rede/grupo: http(s), host com ponto, sem espaço */
export function cleanUrl(raw: unknown, opts: { httpsOnly?: boolean } = {}): { value: string | null } | { error: string } {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") return { error: "link inválido" };
  const s = raw.trim();
  if (!s) return { value: null };
  if (s.length > COMMUNITY_LIMITS.url || /\s/.test(s)) return { error: "link inválido" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "link inválido: comece com https://" };
  }
  const okProto = opts.httpsOnly ? u.protocol === "https:" : u.protocol === "https:" || u.protocol === "http:";
  if (!okProto) return { error: opts.httpsOnly ? "imagem precisa de link https://" : "link inválido: comece com https://" };
  if (!u.hostname.includes(".") || u.username || u.password) return { error: "link inválido" };
  return { value: u.toString() };
}

export type CommunityInput = {
  name?: string;
  slug?: string;
  description?: string | null;
  city?: string | null;
  online?: boolean;
} & Partial<Record<(typeof LINK_FIELDS)[number] | (typeof IMAGE_FIELDS)[number], string | null>>;

const text = (v: unknown, max: number, field: string): { value: string | null } | { error: string } => {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: `${field} inválido` };
  const s = v.trim().replace(/[ \t]+/g, " ");
  if (s.length > max) return { error: `${field}: até ${max} caracteres` };
  return { value: s || null };
};

/**
 * Valida o corpo de criar/editar. Na criação o nome é obrigatório e o
 * endereço sai do nome quando não vem. Na edição só o que veio muda; o
 * endereço não muda (link já divulgado).
 */
export function parseCommunityInput(
  b: Record<string, unknown>,
  mode: "create" | "update",
): { value: CommunityInput } | { error: string } {
  const out: CommunityInput = {};
  if (mode === "create" || "name" in b) {
    const n = text(b.name, COMMUNITY_LIMITS.name, "nome");
    if ("error" in n) return n;
    if (!n.value || n.value.length < 3) return { error: "Dê um nome com pelo menos 3 letras." };
    out.name = n.value;
  }
  if (mode === "create") {
    const raw = typeof b.slug === "string" && b.slug.trim() ? b.slug.trim().toLowerCase() : slugify(out.name!);
    if (!isValidSlug(raw)) {
      return { error: "Endereço inválido: de 3 a 40 letras minúsculas, números ou hífen (ex.: hack-club-sorocaba)." };
    }
    out.slug = raw;
  }
  if ("description" in b) {
    const d = text(b.description, COMMUNITY_LIMITS.description, "descrição");
    if ("error" in d) return d;
    out.description = d.value;
  }
  if ("city" in b) {
    const c = text(b.city, COMMUNITY_LIMITS.city, "cidade");
    if ("error" in c) return c;
    out.city = c.value;
  }
  if ("online" in b) {
    if (typeof b.online !== "boolean") return { error: "online deve ser sim ou não" };
    out.online = b.online;
  }
  for (const k of LINK_FIELDS) {
    if (!(k in b)) continue;
    const r = cleanUrl(b[k]);
    if ("error" in r) return { error: `${r.error} (${k === "groupUrl" ? "grupo" : k})` };
    out[k] = r.value;
  }
  for (const k of IMAGE_FIELDS) {
    if (!(k in b)) continue;
    const r = cleanUrl(b[k], { httpsOnly: true });
    if ("error" in r) return { error: `${r.error} (${k === "logoUrl" ? "logo" : "capa"})` };
    out[k] = r.value;
  }
  if (mode === "create" && !out.online && !out.city) {
    return { error: "Diga a cidade da comunidade ou marque que ela é online." };
  }
  return { value: out };
}

// ---------- leitura ----------

export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  const row = await db.prepare("SELECT * FROM communities WHERE slug = ?").get<Row>(slug);
  return row ? toCommunity(row) : null;
}

export async function getCommunityById(id: number): Promise<Community | null> {
  const row = await db.prepare("SELECT * FROM communities WHERE id = ?").get<Row>(id);
  return row ? toCommunity(row) : null;
}

export async function getMembership(communityId: number, memberId: number): Promise<CommunityRole | null> {
  const row = await db
    .prepare("SELECT role FROM community_members WHERE communityId = ? AND memberId = ?")
    .get<{ role: CommunityRole }>(communityId, memberId);
  return row?.role ?? null;
}

/** dono, organizador ou admin global: edita a comunidade e abre hackathon nela */
export async function canManageCommunity(actor: Actor | null, communityId: number): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  const r = await getMembership(communityId, actor.id);
  return r === "dono" || r === "organizador";
}

/** dono ou admin global: convida e tira organizador */
export async function isCommunityOwner(actor: Actor | null, communityId: number): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  return (await getMembership(communityId, actor.id)) === "dono";
}

export type CommunityListItem = Community & {
  members: number;
  hackathons: number;
  upcoming: number;
  /** próxima edição publicada (nome e id), se houver */
  nextId: string | null;
  nextName: string | null;
  nextStartsAt: string | null;
  owners: number;
  reports: number;
};

// "atividade real": a última coisa que aconteceu na comunidade (entrada de
// membro, post no mural, aviso, hackathon publicado ou a criação). Nada de
// número inventado: a ordem sai disso e os contadores são COUNT do banco.
const LIST_SQL = `
  SELECT c.*,
    (SELECT COUNT(*)::int FROM community_members cm JOIN members m ON m.id = cm.memberId
      WHERE cm.communityId = c.id AND m.clerkId NOT LIKE 'deleted:%') AS members,
    (SELECT COUNT(*)::int FROM community_members cm WHERE cm.communityId = c.id AND cm.role = 'dono') AS owners,
    (SELECT COUNT(*)::int FROM hackathons h WHERE h.communityId = c.id AND h.active = 1) AS hackathons,
    (SELECT COUNT(*)::int FROM hackathons h WHERE h.communityId = c.id AND h.active = 1
      AND to_ts(COALESCE(h.endsAt, h.startsAt)) >= now()) AS upcoming,
    (SELECT COUNT(*)::int FROM reports r
      WHERE r.targetType = 'community' AND r.targetId = c.id::text AND r.resolvedAt IS NULL) AS reports,
    nx.id AS "nextId", nx.name AS "nextName", nx.startsAt AS "nextStartsAt",
    GREATEST(
      to_ts(c.createdAt),
      (SELECT MAX(to_ts(cm.joinedAt)) FROM community_members cm WHERE cm.communityId = c.id),
      (SELECT MAX(to_ts(p.createdAt)) FROM posts p WHERE p.communityId = c.id),
      (SELECT MAX(to_ts(n.createdAt)) FROM community_notices n WHERE n.communityId = c.id),
      (SELECT MAX(to_ts(h.publishedAt)) FROM hackathons h WHERE h.communityId = c.id AND h.active = 1)
    ) AS "lastActivity"
  FROM communities c
  LEFT JOIN LATERAL (
    SELECT h.id, h.name, h.startsAt FROM hackathons h
    WHERE h.communityId = c.id AND h.active = 1 AND to_ts(COALESCE(h.endsAt, h.startsAt)) >= now()
    ORDER BY to_ts(h.startsAt) LIMIT 1
  ) nx ON true`;

type ListRow = Row & Omit<CommunityListItem, keyof Community>;

const toItem = (r: ListRow): CommunityListItem => ({
  ...toCommunity(r),
  members: Number(r.members),
  hackathons: Number(r.hackathons),
  upcoming: Number(r.upcoming),
  owners: Number(r.owners),
  reports: Number(r.reports),
  nextId: r.nextId ?? null,
  nextName: r.nextName ?? null,
  nextStartsAt: r.nextStartsAt ?? null,
});

/**
 * Lista pra /comunidades, landing e onboarding. Escondida nunca aparece
 * (só pro admin, com includeHidden). Busca por nome, cidade ou descrição.
 */
export async function listCommunities(
  opts: { q?: string | null; includeHidden?: boolean; limit?: number } = {},
): Promise<CommunityListItem[]> {
  const q = (opts.q ?? "").trim().toLowerCase().slice(0, 80);
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = await db
    .prepare(
      `SELECT * FROM (${LIST_SQL}) x
       WHERE (@all = 1 OR x.hidden = 0)
         AND (@q = '' OR lower(x.name) LIKE @like ESCAPE '\\' OR lower(COALESCE(x.city, '')) LIKE @like ESCAPE '\\'
              OR lower(COALESCE(x.description, '')) LIKE @like ESCAPE '\\')
       ORDER BY x."lastActivity" DESC NULLS LAST, x.id DESC
       LIMIT @limit`,
    )
    .all<ListRow>({ q, like, all: opts.includeHidden ? 1 : 0, limit: opts.limit ?? 200 });
  return rows.map(toItem);
}

export async function getCommunityItem(slug: string): Promise<CommunityListItem | null> {
  const row = await db.prepare(`SELECT * FROM (${LIST_SQL}) x WHERE x.slug = ?`).get<ListRow>(slug);
  return row ? toItem(row) : null;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * "Perto de você" pela cidade do perfil: mesma cidade primeiro, depois o
 * mesmo estado. Sem cidade no perfil (ou cidade que não dá pra ler), vazio.
 */
export function nearby<T extends Pick<Community, "city" | "online">>(
  list: T[],
  city: string | null | undefined,
): { item: T; match: "cidade" | "estado" }[] {
  if (!city?.trim()) return [];
  const myCity = norm(city.split(",")[0]);
  const myUf = eventRegion({ format: "presencial", location: city });
  const out: { item: T; match: "cidade" | "estado" }[] = [];
  for (const item of list) {
    if (item.online || !item.city) continue;
    if (norm(item.city.split(",")[0]) === myCity) out.push({ item, match: "cidade" });
  }
  if (myUf.length === 2) {
    for (const item of list) {
      if (item.online || !item.city || out.some((o) => o.item === item)) continue;
      if (eventRegion({ format: "presencial", location: item.city }) === myUf) out.push({ item, match: "estado" });
    }
  }
  return out;
}

export type CommunityMember = {
  memberId: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  role: CommunityRole;
  joinedAt: string;
};

export async function listCommunityMembers(communityId: number, limit = 200): Promise<CommunityMember[]> {
  return db
    .prepare(
      `SELECT m.id AS "memberId", m.username, m.name, m.avatarUrl, m.headline, cm.role, cm.joinedAt
       FROM community_members cm JOIN members m ON m.id = cm.memberId
       WHERE cm.communityId = ? AND m.clerkId NOT LIKE 'deleted:%'
       ORDER BY CASE cm.role WHEN 'dono' THEN 0 WHEN 'organizador' THEN 1 ELSE 2 END, cm.joinedAt
       LIMIT ?`,
    )
    .all<CommunityMember>(communityId, limit);
}

export type MyCommunity = Pick<Community, "id" | "slug" | "name" | "city" | "online"> & {
  /** "segue" = só segue, sem ser membro (migration 030) */
  role: CommunityRole | "segue";
  /** rascunho mais recente da comunidade (pro próximo passo de quem organiza) */
  draftId: string | null;
  draftName: string | null;
  nextId: string | null;
  nextName: string | null;
  nextStartsAt: string | null;
  members: number;
};

export async function listMyCommunities(memberId: number): Promise<MyCommunity[]> {
  return (
    await db
      .prepare(
        `SELECT c.id, c.slug, c.name, c.city, c.online, cm.role,
           d.id AS "draftId", d.name AS "draftName",
           nx.id AS "nextId", nx.name AS "nextName", nx.startsAt AS "nextStartsAt",
           (SELECT COUNT(*)::int FROM community_members x WHERE x.communityId = c.id) AS members
         FROM (
           SELECT communityId, memberId, role FROM community_members
           UNION ALL
           SELECT f.communityId, f.memberId, 'segue' FROM community_follows f
           WHERE NOT EXISTS (SELECT 1 FROM community_members x WHERE x.communityId = f.communityId AND x.memberId = f.memberId)
         ) cm JOIN communities c ON c.id = cm.communityId
         LEFT JOIN LATERAL (
           SELECT h.id, h.name FROM hackathons h
           WHERE h.communityId = c.id AND h.active = 0 AND h.publishedAt IS NULL
           ORDER BY h.id DESC LIMIT 1
         ) d ON true
         LEFT JOIN LATERAL (
           SELECT h.id, h.name, h.startsAt FROM hackathons h
           WHERE h.communityId = c.id AND h.active = 1 AND to_ts(COALESCE(h.endsAt, h.startsAt)) >= now()
           ORDER BY to_ts(h.startsAt) LIMIT 1
         ) nx ON true
         WHERE cm.memberId = ? AND c.hidden = 0
         ORDER BY CASE cm.role WHEN 'dono' THEN 0 WHEN 'organizador' THEN 1 WHEN 'membro' THEN 2 ELSE 3 END, c.name`,
      )
      .all<Omit<MyCommunity, "online"> & { online: number }>(memberId)
  ).map((r) => ({ ...r, online: r.online === 1, members: Number(r.members) }));
}

export type CommunityNextStep = { text: string; label: string; href: string };

/** painel "suas comunidades": um próximo passo por comunidade */
export function communityNextStep(c: MyCommunity): CommunityNextStep {
  const manage = c.role === "dono" || c.role === "organizador";
  if (manage && c.draftId) {
    return { text: `${c.draftName} está em rascunho.`, label: "terminar e publicar", href: `/admin/h/${c.draftId}` };
  }
  if (manage && c.nextId) {
    return { text: `${c.nextName} está no ar.`, label: "abrir o painel da edição", href: `/admin/h/${c.nextId}` };
  }
  if (manage) {
    return { text: "Nenhum hackathon marcado.", label: "abrir um hackathon", href: `/comunidade/${c.slug}/hackathon/novo` };
  }
  if (c.nextId) {
    return { text: `Próximo: ${c.nextName}.`, label: "ver e se inscrever", href: `/h/${c.nextId}` };
  }
  return { text: "Nenhum hackathon marcado ainda.", label: "ver o mural", href: `/comunidade/${c.slug}#mural` };
}

// ---------- escrita ----------

/** cria a comunidade e quem criou vira dono, na mesma transação */
export async function createCommunity(memberId: number, input: CommunityInput): Promise<Community> {
  return db.transaction(async () => {
    const row = await db
      .prepare(
        `INSERT INTO communities (slug, name, description, city, online, website, instagram, linkedin, discord,
           groupUrl, logoUrl, coverUrl, createdBy)
         VALUES (@slug, @name, @description, @city, @online, @website, @instagram, @linkedin, @discord,
           @groupUrl, @logoUrl, @coverUrl, @createdBy)
         ON CONFLICT (slug) DO NOTHING
         RETURNING *`,
      )
      .get<Row>({
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        city: input.online ? (input.city ?? null) : input.city,
        online: input.online ? 1 : 0,
        website: input.website ?? null,
        instagram: input.instagram ?? null,
        linkedin: input.linkedin ?? null,
        discord: input.discord ?? null,
        groupUrl: input.groupUrl ?? null,
        logoUrl: input.logoUrl ?? null,
        coverUrl: input.coverUrl ?? null,
        createdBy: memberId,
      });
    if (!row) throw new CommunityError("slug_taken", `O endereço "${input.slug}" já é de outra comunidade. Escolha outro.`);
    await db
      .prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'dono')")
      .run(row.id, memberId);
    return toCommunity(row);
  })();
}

const UPDATABLE = ["name", "description", "city", "online", ...LINK_FIELDS, ...IMAGE_FIELDS] as const;

export async function updateCommunity(id: number, patch: CommunityInput): Promise<Community | null> {
  const sets: string[] = [];
  const bag: Record<string, unknown> = { id };
  for (const k of UPDATABLE) {
    if (!(k in patch)) continue;
    const v = patch[k as keyof CommunityInput];
    bag[k] = k === "online" ? (v ? 1 : 0) : (v ?? null);
    sets.push(`${k} = @${k}`);
  }
  if (sets.length === 0) return getCommunityById(id);
  const row = await db
    .prepare(`UPDATE communities SET ${sets.join(", ")}, updatedAt = sqlite_now() WHERE id = @id RETURNING *`)
    .get<Row>(bag);
  return row ? toCommunity(row) : null;
}

/** entra como membro. true = entrou agora (o dono recebe notificação) */
export async function joinCommunity(c: Pick<Community, "id" | "slug" | "name">, member: { id: number; username: string }): Promise<boolean> {
  const res = await db
    .prepare("INSERT OR IGNORE INTO community_members (communityId, memberId, role) VALUES (?, ?, 'membro')")
    .run(c.id, member.id);
  // membro já segue (migration 030): o "seguir" leve de antes deixa de existir
  await db.prepare("DELETE FROM community_follows WHERE communityId = ? AND memberId = ?").run(c.id, member.id);
  if (res.changes === 0) return false;
  const owners = await db
    .prepare("SELECT memberId FROM community_members WHERE communityId = ? AND role = 'dono'")
    .all<{ memberId: number }>(c.id);
  for (const o of owners) {
    await notify(o.memberId, {
      type: "community_join",
      actorUsername: member.username,
      text: `@${member.username} entrou na ${c.name}.`,
      href: `/comunidade/${c.slug}#membros`,
    });
  }
  return true;
}

/**
 * Sai da comunidade: apaga o vínculo (e o convite pendente do e-mail, se
 * houver). Único dono não sai — a comunidade ficaria sem ninguém pra cuidar.
 */
export async function leaveCommunity(communityId: number, memberId: number): Promise<boolean> {
  return db.transaction(async () => {
    const role = await getMembership(communityId, memberId);
    if (!role) return false;
    if (role === "dono") {
      const owners = await db
        .prepare("SELECT COUNT(*)::int AS n FROM community_members WHERE communityId = ? AND role = 'dono'")
        .get<{ n: number }>(communityId);
      if (Number(owners?.n ?? 0) <= 1) {
        throw new CommunityError(
          "last_owner",
          "Você é quem cuida desta comunidade. Pra sair, fale com o HackaHub pra passar a comunidade pra outra pessoa.",
        );
      }
    }
    await db.prepare("DELETE FROM community_members WHERE communityId = ? AND memberId = ?").run(communityId, memberId);
    // um "seguir" que corria junto com o entrar pode ter sobrado: quem sai
    // não segue sem ter escolhido seguir
    await db.prepare("DELETE FROM community_follows WHERE communityId = ? AND memberId = ?").run(communityId, memberId);
    return true;
  })();
}

/**
 * Convite de organizador por e-mail (padrão do inviteToEdition): quem já tem
 * conta vira organizador na hora (e entra na comunidade se não estava);
 * quem não tem fica pendente e é resgatado no primeiro login.
 */
export async function inviteOrganizer(
  c: Pick<Community, "id" | "slug" | "name">,
  email: string,
  invitedBy: number,
): Promise<"granted" | "pending" | "already"> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 200) {
    throw new CommunityError("invalid", "e-mail inválido");
  }
  const member = await db
    .prepare("SELECT id FROM members WHERE lower(email) = ? AND clerkId NOT LIKE 'deleted:%'")
    .get<{ id: number }>(normalized);
  if (member) return grantOrganizer(c, member.id, invitedBy);
  await db
    .prepare(
      `INSERT INTO community_invites (communityId, email, role, invitedBy) VALUES (?, ?, 'organizador', ?)
       ON CONFLICT (communityId, email) DO NOTHING`,
    )
    .run(c.id, normalized, invitedBy);
  await sendInviteEmail(c, normalized);
  return "pending";
}

async function grantOrganizer(
  c: Pick<Community, "id" | "slug" | "name">,
  memberId: number,
  by: number | null,
): Promise<"granted" | "already"> {
  const role = await getMembership(c.id, memberId);
  if (role === "dono" || role === "organizador") return "already";
  await db
    .prepare(
      `INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'organizador')
       ON CONFLICT (communityId, memberId) DO UPDATE SET role = 'organizador'`,
    )
    .run(c.id, memberId);
  if (memberId !== by) {
    await notify(memberId, {
      type: "community_role",
      text: `Você agora organiza a ${c.name} no HackaHub.`,
      href: `/comunidade/${c.slug}`,
    });
  }
  return "granted";
}

async function sendInviteEmail(c: Pick<Community, "slug" | "name">, email: string) {
  const driver = emailDriver();
  if (driver.name === "log") return;
  const url = absoluteUrl(`/comunidade/${c.slug}`);
  const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const outcome = await driver
    .send({
      to: email,
      subject: `Convite pra organizar a ${c.name}`,
      text: `Você foi convidado pra organizar a ${c.name} no HackaHub.\n\nEntre com este e-mail pra ativar o convite: ${url}`,
      html: `<p>Você foi convidado pra organizar a <strong>${esc(c.name)}</strong> no HackaHub.</p><p><a href="${esc(url)}">Entre com este e-mail pra ativar o convite</a>.</p>`,
      idempotencyKey: `community-invite:${c.slug}:${email}`,
    })
    .catch((e: unknown) => ({ status: "failed" as const, error: String(e) }));
  if (outcome.status !== "sent") console.warn(`[comunidades] convite por e-mail não saiu: ${outcome.status}`);
}

export async function listCommunityInvites(communityId: number) {
  return db
    .prepare("SELECT email, createdAt FROM community_invites WHERE communityId = ? ORDER BY createdAt")
    .all<{ email: string; createdAt: string }>(communityId);
}

export async function cancelCommunityInvite(communityId: number, email: string) {
  await db
    .prepare("DELETE FROM community_invites WHERE communityId = ? AND email = ?")
    .run(communityId, email.trim().toLowerCase());
}

/** tira o papel de organizador (a pessoa continua membro). Dono não é rebaixado aqui. */
export async function removeOrganizer(communityId: number, memberId: number): Promise<boolean> {
  const res = await db
    .prepare("UPDATE community_members SET role = 'membro' WHERE communityId = ? AND memberId = ? AND role = 'organizador'")
    .run(communityId, memberId);
  return res.changes > 0;
}

/** primeiro login: convites pendentes do e-mail viram papel de organizador */
export async function claimCommunityInvites(memberId: number, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const invites = await db
    .prepare(
      `SELECT i.invitedBy, c.id, c.slug, c.name FROM community_invites i JOIN communities c ON c.id = i.communityId
       WHERE i.email = ?`,
    )
    .all<{ invitedBy: number | null; id: number; slug: string; name: string }>(normalized);
  for (const inv of invites) await grantOrganizer(inv, memberId, inv.invitedBy);
  if (invites.length) await db.prepare("DELETE FROM community_invites WHERE email = ?").run(normalized);
}

// ---------- avisos ----------

export type CommunityNotice = { id: number; title: string; body: string; createdAt: string; username: string | null };

export async function listNotices(communityId: number, limit = 10): Promise<CommunityNotice[]> {
  return db
    .prepare(
      `SELECT n.id, n.title, n.body, n.createdAt, m.username
       FROM community_notices n LEFT JOIN members m ON m.id = n.createdBy
       WHERE n.communityId = ? ORDER BY n.id DESC LIMIT ?`,
    )
    .all<CommunityNotice>(communityId, limit);
}

/** aviso da organização: grava e notifica cada membro dentro da plataforma */
export async function createNotice(
  c: Pick<Community, "id" | "slug" | "name">,
  by: number,
  title: string,
  body: string,
): Promise<{ id: number; notified: number }> {
  return db.transaction(async () => {
    const row = await db
      .prepare("INSERT INTO community_notices (communityId, title, body, createdBy) VALUES (?, ?, ?, ?) RETURNING id")
      .get<{ id: number }>(c.id, title, body, by);
    const res = await db
      .prepare(
        `INSERT INTO notifications (memberId, type, text, href)
         SELECT cm.memberId, 'community_notice', ?, ? FROM community_members cm JOIN members m ON m.id = cm.memberId
         WHERE cm.communityId = ? AND cm.memberId <> ? AND m.clerkId NOT LIKE 'deleted:%'`,
      )
      .run(`${c.name}: ${title}`, `/comunidade/${c.slug}#avisos`, c.id, by);
    return { id: row!.id, notified: res.changes };
  })();
}

// ---------- moderação ----------

// denúncia contra a comunidade inteira: vai pra fila única (lib/reports, 032),
// roteada pro admin. Repetir com uma ainda aberta não abre outra.
export async function reportCommunity(communityId: number, memberId: number, reason: string) {
  try {
    await createReport({ targetType: "community", targetId: String(communityId), reporterId: memberId, reason });
  } catch (e) {
    if (e instanceof ReportError && e.status === 409) return;
    throw e;
  }
}

export async function setModeration(communityId: number, patch: { hidden?: boolean; verified?: boolean }) {
  const sets: string[] = [];
  const bag: Record<string, unknown> = { id: communityId };
  if (patch.hidden !== undefined) {
    sets.push("hidden = @hidden");
    bag.hidden = patch.hidden ? 1 : 0;
  }
  if (patch.verified !== undefined) {
    sets.push("verified = @verified");
    bag.verified = patch.verified ? 1 : 0;
  }
  if (sets.length === 0) return getCommunityById(communityId);
  // esconder resolve as denúncias abertas (o admin decidiu)
  if (patch.hidden) {
    await resolveCommunityTargetReports(communityId);
  }
  const row = await db.prepare(`UPDATE communities SET ${sets.join(", ")} WHERE id = @id RETURNING *`).get<Row>(bag);
  return row ? toCommunity(row) : null;
}

/** denúncias abertas contra comunidades (formato antigo; a fila nova é lib/reports) */
export async function listOpenReports() {
  return db
    .prepare(
      `SELECT r.id, r.reason, r.createdAt, c.slug, c.name
       FROM reports r JOIN communities c ON r.targetType = 'community' AND c.id::text = r.targetId
       WHERE r.resolvedAt IS NULL ORDER BY r.id DESC LIMIT 50`,
    )
    .all<{ id: number; reason: string; createdAt: string; slug: string; name: string }>();
}

// ---------- pódio ----------

export type PodiumEntry = { hackathonId: string; placement: number; teamName: string; title: string | null; teamId: number };

/** pódio (1º a 3º) das edições encerradas da comunidade */
export async function podiumFor(hackathonIds: string[]): Promise<PodiumEntry[]> {
  if (hackathonIds.length === 0) return [];
  return db
    .prepare(
      `SELECT t.hackathonId AS "hackathonId", t.placement, t.name AS "teamName", p.title, t.id AS "teamId"
       FROM teams t LEFT JOIN team_projects p ON p.teamId = t.id
       WHERE t.placement BETWEEN 1 AND 3 AND t.hackathonId = ANY(?::text[])
       ORDER BY t.hackathonId, t.placement`,
    )
    .all<PodiumEntry>(`{${hackathonIds.map((id) => `"${id.replace(/"/g, "")}"`).join(",")}}`);
}

/** moderação: hackathons de comunidade criados nos últimos 30 dias */
export async function listRecentCommunityHackathons() {
  return db
    .prepare(
      `SELECT h.id, h.name, h.active, h.createdAt, c.slug, c.name AS "communityName"
       FROM hackathons h JOIN communities c ON c.id = h.communityId
       WHERE h.createdAt IS NOT NULL AND to_ts(h.createdAt) > now() - interval '30 days'
       ORDER BY h.createdAt DESC LIMIT 30`,
    )
    .all<{ id: string; name: string; active: number; createdAt: string; slug: string; communityName: string }>();
}
