import db from "@/lib/db";
import { claimEditionInvites } from "@/lib/roles";
import { claimSponsorInvites } from "@/lib/editionSponsors";
import { claimCommunityInvites } from "@/lib/communities";
import { toLikePattern } from "@/lib/search";
import { RETIRED_BADGE_IDS } from "@/lib/game";
import { areasFromJson, type AreaKey } from "@/lib/areas";
import { isRecadosFrom, type RecadosFrom } from "@/lib/recados";
import { bichoDoMembro, regravarAvatar, type AvatarKind } from "@/lib/mascote/evolucao";
import { normalizarItens, type ItemId } from "@/lib/mascote/itens";

// badge aposentado (criador, influente) não entra no contador "N badges".
// ids são constantes do código, sem entrada de usuário.
const RETIRED_BADGES_SQL = RETIRED_BADGE_IDS.map((id) => `'${id}'`).join(", ");

// spec 032 — "campanhas" públicas contam só inscrições aprovadas (pedido
// pendente não é campanha)
export type Member = {
  id: number;
  clerkId: string;
  username: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  // spec 046, onda 4 (migration 047): avatar é a foto do Clerk ('foto') ou o
  // bicho ('bicho'); clerkImageUrl guarda a foto pra voltar com um clique
  avatarKind: AvatarKind;
  clerkImageUrl: string | null;
  /** até 3 itens do bicho escolhidos em /perfil (vazio = os mais recentes) */
  mascoteItens: ItemId[];
  bio: string | null;
  skills: string[];
  github: string | null;
  linkedin: string | null;
  twitter: string | null;
  website: string | null;
  headline: string | null;
  persona: string | null;
  personas: string[];
  role: "member" | "admin";
  xp: number;
  badges?: number;
  campaigns?: number;
  cards?: number;
  createdAt: string;
  usernameChangedAt?: string | null;
  // spec 039 — onboarding
  onboardedAt?: string | null;
  intents?: string[];
  city?: string | null;
  institution?: string | null;
  course?: string | null;
  // perfil rico (migration 041): áreas de ajuda, perfil aberto e quem deixa recado
  helpOffer?: AreaKey[];
  helpWant?: AreaKey[];
  publicProfile?: number;
  recadosFrom?: RecadosFrom;
};

type MemberRow = Omit<
  Member,
  "skills" | "personas" | "intents" | "helpOffer" | "helpWant" | "recadosFrom" | "mascoteItens"
> & {
  skills: string;
  personas: string;
  intents?: string;
  helpOffer?: string;
  helpWant?: string;
  recadosFrom?: string;
  mascoteItens?: string | null;
};

/** JSON de itens salvos; lixo no banco vira lista vazia */
function itensFromJson(raw: string | null | undefined): ItemId[] {
  if (!raw) return [];
  try {
    return normalizarItens(JSON.parse(raw));
  } catch {
    return [];
  }
}

function toMember(row: MemberRow): Member {
  return {
    ...row,
    avatarKind: row.avatarKind === "bicho" ? "bicho" : "foto",
    mascoteItens: itensFromJson(row.mascoteItens),
    skills: JSON.parse(row.skills),
    personas: JSON.parse(row.personas ?? "[]"),
    intents: JSON.parse(row.intents ?? "[]"),
    helpOffer: areasFromJson(row.helpOffer),
    helpWant: areasFromJson(row.helpWant),
    publicProfile: Number(row.publicProfile ?? 0),
    recadosFrom: isRecadosFrom(row.recadosFrom) ? row.recadosFrom : "conexoes",
  };
}

export function adminEmails(): string[] {
  return (process.env.HACKAHUB_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * E-mail entrou na lista de admins depois do cadastro → promove. A lista só
 * promove: tirar alguém de HACKAHUB_ADMIN_EMAILS NÃO rebaixa, porque admin
 * também é dado por SQL (runbook) e um rebaixamento automático derrubaria
 * esses. Revogar é manual: `UPDATE members SET role = 'member' WHERE
 * email = '...'` (docs/runbook.md, "Admins").
 */
export async function promoteListedAdmin(member: Member): Promise<Member> {
  if (member.role === "admin" || !adminEmails().includes(member.email.toLowerCase())) return member;
  await db.prepare("UPDATE members SET role = 'admin' WHERE id = ?").run(member.id);
  return { ...member, role: "admin" };
}

export async function getOrCreateMember(clerkUser: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  imageUrl?: string | null;
  /** Clerk user.hasImage: false = não tem foto de verdade (vira bicho) */
  hasImage?: boolean;
}): Promise<Member> {
  // convidado importado (Luma, planilha) entrando pela primeira vez: o membro
  // stub criado pelo import (clerkId com prefixo import:) e adotado — vira a
  // conta de verdade mantendo inscricao, cartao, selos e historico.
  await db
    .prepare(
      `UPDATE members SET "clerkId" = @id
       WHERE id = (SELECT id FROM members
                   WHERE "clerkId" LIKE 'import:%' AND LOWER(email) = LOWER(@email)
                   ORDER BY id LIMIT 1)`,
    )
    .run({ id: clerkUser.id, email: clerkUser.email });

  const existing = await db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkUser.id) as MemberRow | undefined;
  if (existing) {
    // avatar é dado do Clerk: sync na materialização — truthy e diferente
    // atualiza; nulo preserva (leitura nunca apaga o que já foi gravado).
    // Desde a 047 o Clerk manda sempre em clerkImageUrl e só manda no
    // avatarUrl de quem usa a foto: quem escolheu o bicho não é sobrescrito
    // pelo login seguinte.
    const foto = clerkUser.imageUrl ?? null;
    const usaFoto = existing.avatarKind !== "bicho";
    if (foto && (foto !== existing.clerkImageUrl || (usaFoto && foto !== existing.avatarUrl))) {
      const avatarUrl = usaFoto ? foto : existing.avatarUrl;
      await db
        .prepare(`UPDATE members SET clerkImageUrl = ?, avatarUrl = ? WHERE id = ?`)
        .run(foto, avatarUrl, existing.id);
      existing.clerkImageUrl = foto;
      existing.avatarUrl = avatarUrl;
    }
    return promoteListedAdmin(toMember(existing));
  }

  const username = await generateUsername(clerkUser.firstName, clerkUser.lastName, clerkUser.email);

  // admin global vem de lista explícita (e-mail verificado no Clerk) — o
  // antigo "primeiro cadastro vira admin" entregava o painel a quem chegasse
  // primeiro num site público
  const isAdmin = adminEmails().includes(clerkUser.email.toLowerCase());

  // quem entra sem foto real no Clerk já nasce com o bicho como avatar (o
  // avatarUrl do bicho é gravado logo abaixo, quando o id existe)
  const semFoto = clerkUser.hasImage === false;
  const avatarKind: AvatarKind = semFoto ? "bicho" : "foto";

  await db.prepare(
    `INSERT INTO members (clerkId, username, name, email, role, avatarUrl, clerkImageUrl, avatarKind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    clerkUser.id,
    username,
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
    clerkUser.email,
    isAdmin ? "admin" : "member",
    semFoto ? null : (clerkUser.imageUrl ?? null),
    clerkUser.imageUrl ?? null,
    avatarKind,
  );
  const created = await db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkUser.id) as MemberRow;
  if (semFoto) {
    const { avatarUrl } = await regravarAvatar(created.id);
    created.avatarUrl = avatarUrl;
  }
  await claimEditionInvites(created.id, created.email);
  await claimSponsorInvites(created.id, created.email);
  await claimCommunityInvites(created.id, created.email);
  return toMember(created);
}

// ---------- username (frente N #8) ----------
// O automático antigo era o e-mail sem pontuação ("joaosilva92", "hacker3")
// e, no pior caso, nada legível. Agora nasce do nome (ou do e-mail): slug
// pt-BR sem acento, sem partícula (da/de/dos…), sem número; sufixo curto
// (2, 3…) só quando colide. Quem quiser troca UMA vez no perfil — o antigo
// fica reservado e /u/antigo redireciona (308) pro novo.

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const USERNAME_MAX = 20;
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e", "di", "du", "del", "van", "von"]);
const RESERVED = new Set([
  "admin", "administrador", "api", "hackahub", "hackinova", "hack_inova", "suporte", "staff",
  "organizacao", "organizador", "root", "null", "undefined", "me", "eu", "perfil", "sistema",
]);

/** "João" → "joao"; só [a-z0-9] */
export function slugPart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isReservedUsername(u: string): boolean {
  return RESERVED.has(u) || u.startsWith("removido") || u.startsWith("deleted");
}

/** candidatos em ordem de preferência: nome+sobrenome, nome, e-mail */
export function usernameCandidates(first: string | null, last: string | null, email: string): string[] {
  const words = `${first ?? ""} ${last ?? ""}`
    .split(/\s+/)
    .map(slugPart)
    .map((w) => w.replace(/[0-9]/g, ""))
    .filter((w) => w && !PARTICLES.has(w));
  const local = email.split("@")[0].split("+")[0];
  const fromEmail = local
    .split(/[._\-]+/)
    .map(slugPart)
    .map((w) => w.replace(/[0-9]/g, ""))
    .filter(Boolean)
    .join("");
  const out: string[] = [];
  const push = (c: string) => {
    const v = c.slice(0, USERNAME_MAX);
    if (v.length >= 3 && !isReservedUsername(v) && !out.includes(v)) out.push(v);
  };
  if (words.length >= 2) push(words[0] + words[words.length - 1]);
  if (words.length >= 1) push(words[0]);
  push(fromEmail);
  if (out.length === 0) out.push("hacker");
  return out;
}

async function usernameTaken(u: string, exceptMemberId: number | null = null): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM members WHERE username = ? AND (?::int IS NULL OR id <> ?::int)
       UNION ALL
       SELECT 1 FROM username_redirects WHERE oldUsername = ? AND (?::int IS NULL OR memberId <> ?::int)
       LIMIT 1`,
    )
    .get(u, exceptMemberId, exceptMemberId, u, exceptMemberId, exceptMemberId);
  return Boolean(row);
}

export async function generateUsername(first: string | null, last: string | null, email: string): Promise<string> {
  const candidates = usernameCandidates(first, last, email);
  for (const c of candidates) if (!(await usernameTaken(c))) return c;
  const base = candidates[0].slice(0, USERNAME_MAX - 2);
  for (let i = 2; i < 100; i++) {
    const c = `${base}${i}`;
    if (!(await usernameTaken(c))) return c;
  }
  // 98 homônimos: sufixo aleatório curto
  for (;;) {
    const c = `${candidates[0].slice(0, USERNAME_MAX - 4)}${Math.random().toString(36).slice(2, 6)}`;
    if (!(await usernameTaken(c))) return c;
  }
}

export class UsernameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Troca única do username. team_members guarda o username como texto
 * (vínculo do time) e muda junto; o antigo vai pra username_redirects
 * (reservado + redirect de /u/antigo). Certificados usam código próprio e
 * memberId — não mudam. Voltar pro próprio @ antigo não é permitido
 * (é a segunda troca).
 */
export async function changeUsername(memberId: number, raw: unknown): Promise<{ username: string; old: string }> {
  const next = String(raw ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(next)) {
    throw new UsernameError("username: 3 a 20 caracteres, só letras sem acento, números e _");
  }
  if (isReservedUsername(next)) throw new UsernameError("esse username é reservado");
  return db.transaction(async () => {
    const m = await db
      .prepare(`SELECT username, usernameChangedAt FROM members WHERE id = ? FOR UPDATE`)
      .get<{ username: string; usernameChangedAt: string | null }>(memberId);
    if (!m) throw new UsernameError("membro não encontrado", 404);
    if (m.usernameChangedAt) throw new UsernameError("o username só pode ser trocado uma vez", 409);
    if (m.username === next) throw new UsernameError("esse já é o seu username");
    if (await usernameTaken(next)) throw new UsernameError("username em uso", 409);
    await db
      .prepare(`UPDATE members SET username = ?, usernameChangedAt = datetime('now') WHERE id = ?`)
      .run(next, memberId);
    await db.prepare("UPDATE team_members SET username = ? WHERE username = ?").run(next, m.username);
    await db
      .prepare("INSERT INTO username_redirects (oldUsername, memberId) VALUES (?, ?)")
      .run(m.username, memberId);
    return { username: next, old: m.username };
  })();
}

/** /u/antigo → username atual (null se não há redirect) */
export async function resolveUsernameRedirect(old: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT m.username FROM username_redirects r JOIN members m ON m.id = r.memberId
       WHERE r.oldUsername = ?`,
    )
    .get<{ username: string }>(old.toLowerCase());
  return row?.username ?? null;
}

export async function getMemberByUsername(username: string): Promise<Member | null> {
  const row = await db
    .prepare("SELECT * FROM members WHERE username = ?")
    .get(username) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export async function listMembers(limit = 60): Promise<Member[]> {
  const rows = await db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM registrations r WHERE r.memberId = m.id AND r.status = 'approved') AS campaigns,
              (SELECT COUNT(*) FROM member_cards mc WHERE mc.memberId = m.id) AS cards
       FROM members m ORDER BY m.id DESC LIMIT ?`,
    )
    .all(limit) as MemberRow[];
  return rows.map(toMember);
}

export type LeaderboardSort = "xp" | "recent";

// ranking público: xp desc com desempate determinístico por username;
// "recent" ordena por entrada — ordem cronológica não é mérito
export type MemberFilter = {
  /** área de "posso ajudar com" (lib/areas.ts) */
  oferece?: string | null;
  /** área de "quero ajuda com" */
  quer?: string | null;
  cidade?: string | null;
  /** instituição de ensino (a UI chama de faculdade) */
  faculdade?: string | null;
};

// filtro de área: a chave mora num JSON de strings ('["dev","design"]'), então
// o casamento é pelo literal entre aspas. A chave é validada antes (lib/areas).

export async function listLeaderboard(
  sort: LeaderboardSort = "xp",
  limit = 100,
  q?: string,
  filter: MemberFilter = {},
): Promise<Member[]> {
  const orderBy =
    sort === "recent"
      ? "m.createdAt DESC, m.id DESC"
      : "m.xp DESC, m.username ASC";
  // ?q= (spec 023): username/name/headline/skills — LIKE com curinga escapado
  // (toLikePattern); lib/db traduz LIKE → ILIKE (case-insensitive)
  const rows = await db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM member_badges mb
                WHERE mb.memberId = m.id AND mb.badgeId NOT IN (${RETIRED_BADGES_SQL})) AS badges,
              (SELECT COUNT(*) FROM registrations r WHERE r.memberId = m.id AND r.status = 'approved') AS campaigns,
              (SELECT COUNT(*) FROM member_cards mc WHERE mc.memberId = m.id) AS cards
       FROM members m
       WHERE (@q::text IS NULL
              OR m.username LIKE @q ESCAPE '\\'
              OR m.name LIKE @q ESCAPE '\\'
              OR m.headline LIKE @q ESCAPE '\\'
              OR m.skills LIKE @q ESCAPE '\\')
         AND (@oferece::text IS NULL OR m.helpOffer LIKE @oferece)
         AND (@quer::text IS NULL OR m.helpWant LIKE @quer)
         AND (@cidade::text IS NULL OR m.city LIKE @cidade ESCAPE '\\')
         AND (@faculdade::text IS NULL OR m.institution LIKE @faculdade ESCAPE '\\')
       ORDER BY ${orderBy} LIMIT @limit`,
    )
    .all({
      q: toLikePattern(q),
      oferece: areaKeyPattern(filter.oferece),
      quer: areaKeyPattern(filter.quer),
      cidade: toLikePattern(filter.cidade),
      faculdade: toLikePattern(filter.faculdade),
      limit,
    }) as MemberRow[];
  return rows.map(toMember);
}

/** `design` → `%"design"%` (chave exata dentro do JSON); inválida vira null */
function areaKeyPattern(key: string | null | undefined): string | null {
  const clean = typeof key === "string" ? key.trim() : "";
  return clean ? `%"${clean.replace(/[^a-z_]/g, "")}"%` : null;
}

export async function getMemberByClerkId(clerkId: string): Promise<Member | null> {
  const row = await db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkId) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export async function updateMemberProfile(
  clerkId: string,
  patch: {
    name?: string;
    bio?: string;
    skills?: string[];
    github?: string;
    linkedin?: string;
    twitter?: string;
    website?: string;
    headline?: string;
    persona?: string;
    personas?: string[];
    // perfil rico (migration 041)
    helpOffer?: AreaKey[];
    helpWant?: AreaKey[];
    publicProfile?: boolean;
    recadosFrom?: RecadosFrom;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE members SET
       name = COALESCE(@name, name),
       bio = COALESCE(@bio, bio),
       skills = COALESCE(@skills, skills),
       github = COALESCE(@github, github),
       linkedin = COALESCE(@linkedin, linkedin),
       twitter = COALESCE(@twitter, twitter),
       website = COALESCE(@website, website),
       headline = COALESCE(@headline, headline),
       persona = CASE WHEN @personasSet::int = 1 THEN @primary ELSE COALESCE(@persona, persona) END,
       personas = COALESCE(@personas, personas),
       helpOffer = COALESCE(@helpOffer, helpOffer),
       helpWant = COALESCE(@helpWant, helpWant),
       publicProfile = COALESCE(@publicProfile::int, publicProfile),
       recadosFrom = COALESCE(@recadosFrom, recadosFrom)
     WHERE clerkId = @clerkId`,
  ).run({
    clerkId,
    name: patch.name ?? null,
    bio: patch.bio ?? null,
    skills: patch.skills ? JSON.stringify(patch.skills) : null,
    github: patch.github ?? null,
    linkedin: patch.linkedin ?? null,
    twitter: patch.twitter ?? null,
    website: patch.website ?? null,
    headline: patch.headline ?? null,
    persona: patch.persona ?? null,
    personasSet: patch.personas ? 1 : 0,
    primary: patch.personas?.[0] ?? null,
    personas: patch.personas ? JSON.stringify(patch.personas) : null,
    helpOffer: patch.helpOffer ? JSON.stringify(patch.helpOffer) : null,
    helpWant: patch.helpWant ? JSON.stringify(patch.helpWant) : null,
    publicProfile: patch.publicProfile === undefined ? null : patch.publicProfile ? 1 : 0,
    recadosFrom: patch.recadosFrom ?? null,
  });
}

// ---------- onboarding (spec 039) ----------

export type OnboardingPatch = {
  personas?: string[];
  intents?: string[];
  name?: string | null;
  headline?: string | null;
  city?: string | null;
  institution?: string | null;
  course?: string | null;
  github?: string | null;
  linkedin?: string | null;
};

/**
 * Grava o que veio do passo do /bem-vindo (campo ausente preserva; null
 * limpa os opcionais) e, com finish, marca onboardedAt — uma vez só.
 */
export async function saveOnboarding(memberId: number, patch: OnboardingPatch, finish: boolean): Promise<void> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: memberId };
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = @${col}`);
    params[col] = v;
  };
  if (patch.personas) {
    put("personas", JSON.stringify(patch.personas));
    put("persona", patch.personas[0] ?? null);
  }
  if (patch.intents) put("intents", JSON.stringify(patch.intents));
  for (const k of ["name", "headline", "city", "institution", "course", "github", "linkedin"] as const) {
    if (patch[k] !== undefined) put(k, patch[k]);
  }
  if (finish) sets.push("onboardedAt = COALESCE(onboardedAt, datetime('now'))");
  if (sets.length === 0) return;
  await db.prepare(`UPDATE members SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

// ---------- avatar e itens do bicho (spec 046, onda 4, migration 047) ----------

/**
 * Troca o avatar entre a foto do Clerk e o bicho. Em "bicho" o avatarUrl vira
 * o SVG do bicho (com estágio, itens e hash); em "foto" volta a foto do Clerk
 * — ou null, que cai nas iniciais. As listas não precisam saber de nada:
 * continuam lendo members.avatarUrl.
 */
export async function setAvatarKind(
  memberId: number,
  kind: AvatarKind,
): Promise<{ avatarKind: AvatarKind; avatarUrl: string | null }> {
  if (kind === "bicho") {
    const bicho = await bichoDoMembro(memberId);
    await db.prepare("UPDATE members SET avatarKind = 'bicho', avatarUrl = ? WHERE id = ?").run(
      bicho.src,
      memberId,
    );
    return { avatarKind: "bicho", avatarUrl: bicho.src };
  }
  const row = await db
    .prepare("SELECT clerkImageUrl FROM members WHERE id = ?")
    .get<{ clerkImageUrl: string | null }>(memberId);
  const foto = row?.clerkImageUrl ?? null;
  await db.prepare("UPDATE members SET avatarKind = 'foto', avatarUrl = ? WHERE id = ?").run(
    foto,
    memberId,
  );
  return { avatarKind: "foto", avatarUrl: foto };
}

/** os itens que a pessoa quer vestir (até 3); quem chama já validou o destrave */
export async function setMascoteItens(memberId: number, itens: ItemId[]): Promise<ItemId[]> {
  const limpos = normalizarItens(itens);
  await db.prepare("UPDATE members SET mascoteItens = ? WHERE id = ?").run(
    limpos.length ? JSON.stringify(limpos) : null,
    memberId,
  );
  return limpos;
}
