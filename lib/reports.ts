import db from "@/lib/db";
import { block } from "@/lib/blocks";
import { logCommunityAction } from "@/lib/communityModeration";
import { editionPhase } from "@/lib/arena";
import { getHackathon } from "@/lib/hackathons";
import { canHandleIncidents, createIncident } from "@/lib/incidents";
import { notify } from "@/lib/notifications";

// Denúncia numa fila só (migration 032). Toda denúncia, de qualquer tipo de
// conteúdo, vira uma linha em `reports` e vai pra quem modera aquele espaço:
//   - post ou comentário do mural de uma comunidade → dono e organizadores dela;
//   - post ou comentário do mural de uma edição → quem trata incidentes da
//     edição (organizador e responsável de conduta). Com a edição rolando,
//     vira também um incidente, porque é lá que a organização está olhando;
//   - perfil, comunidade inteira e o resto → admin global.
// O admin global vê todas. Denunciar pessoa ou conteúdo de alguém também
// bloqueia esse alguém pra quem denunciou.
//
// Desafio aberto e entrega (053) vão pra comunidade do desafio.
// Tipo novo (depoimento, dm, encontro) entra com um `case` em resolveTarget:
// Depoimento: quem trata a denúncia também tira do ar pela fila
// (takeDownTestimonial em lib/testimonials.ts, POST /api/reports/[id]/takedown).
//
// Tipo novo (dm, encontro) entra com um `case` em resolveTarget:
// devolva o autor, o texto pro snapshot e o espaço (communityId/hackathonId).
// Enquanto o tipo não tem case, a denúncia dá 404.
//
// Ninguém modera denúncia contra si: quando o autor do conteúdo é dono ou
// organizador da comunidade, ou trata incidentes da edição, a denúncia vai
// direto pro admin (sem aviso pro autor nem incidente). E quem é o autor
// (targetMemberId) nunca lê nem resolve a denúncia, nem se virar moderador depois.

export const REPORT_TARGETS = ["post", "comment", "member", "community", "depoimento", "dm", "encontro", "desafio", "desafio_entrega", "topic", "topic_reply"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_TARGET_LABEL: Record<ReportTarget, string> = {
  post: "post",
  comment: "comentário",
  member: "perfil",
  community: "comunidade",
  depoimento: "depoimento",
  dm: "mensagem",
  encontro: "encontro",
  desafio: "desafio",
  desafio_entrega: "entrega de desafio",
  topic: "tópico",
  topic_reply: "resposta de tópico",
};

export const REPORT_LIMITS = { reasonMin: 5, reason: 500, snapshot: 2000, resolution: 300 } as const;

export class ReportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Actor = { id: number; role: string };

type Target = {
  authorId: number | null;
  authorUsername: string | null;
  authorRole: string | null;
  snapshot: string;
  communityId: number | null;
  hackathonId: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// post ou comentário de comunidade escondida não existe pra quem não é admin
// (GET /api/posts?c= dá 404): denunciar também dá 404, sem confirmar o autor.
async function resolveTarget(
  type: ReportTarget,
  id: string,
  viewerRole: string | null,
  reporterId: number,
): Promise<Target | null> {
  const num = /^\d{1,12}$/.test(id) ? Number(id) : null;
  const seesHidden = viewerRole === "admin";
  switch (type) {
    case "post": {
      if (num === null) return null;
      const r = await db
        .prepare(
          `SELECT p.memberId, m.username, m.role, p.body, p.link, p.communityId, p.hackathonId, COALESCE(co.hidden, 0) AS hidden
           FROM posts p JOIN members m ON m.id = p.memberId LEFT JOIN communities co ON co.id = p.communityId
           WHERE p.id = ?`,
        )
        .get<{ memberId: number; username: string; role: string; body: string; link: string | null; communityId: number | null; hackathonId: string | null; hidden: number }>(num);
      if (!r || (Number(r.hidden) && !seesHidden)) return null;
      return {
        authorId: r.memberId,
        authorUsername: r.username,
        authorRole: r.role,
        snapshot: `@${r.username}: ${r.body}${r.link ? `\n${r.link}` : ""}`,
        communityId: r.communityId,
        hackathonId: r.hackathonId,
      };
    }
    case "comment": {
      if (num === null) return null;
      const r = await db
        .prepare(
          `SELECT c.memberId, m.username, m.role, c.body, p.communityId, p.hackathonId, COALESCE(co.hidden, 0) AS hidden
           FROM post_comments c JOIN posts p ON p.id = c.postId JOIN members m ON m.id = c.memberId
           LEFT JOIN communities co ON co.id = p.communityId
           WHERE c.id = ?`,
        )
        .get<{ memberId: number; username: string; role: string; body: string; communityId: number | null; hackathonId: string | null; hidden: number }>(num);
      if (!r || (Number(r.hidden) && !seesHidden)) return null;
      return {
        authorId: r.memberId,
        authorUsername: r.username,
        authorRole: r.role,
        snapshot: `@${r.username}: ${r.body}`,
        communityId: r.communityId,
        hackathonId: r.hackathonId,
      };
    }
    case "member": {
      if (num === null) return null;
      const r = await db
        .prepare(
          `SELECT id, username, role, name, headline, bio FROM members
           WHERE id = ? AND clerkId NOT LIKE 'deleted:%'`,
        )
        .get<{ id: number; username: string; role: string; name: string | null; headline: string | null; bio: string | null }>(num);
      if (!r) return null;
      return {
        authorId: r.id,
        authorUsername: r.username,
        authorRole: r.role,
        snapshot: [`@${r.username}`, r.name, r.headline, r.bio].filter(Boolean).join("\n"),
        communityId: null,
        hackathonId: null,
      };
    }
    case "community": {
      if (num === null) return null;
      const r = await db
        .prepare("SELECT name, description FROM communities WHERE id = ?")
        .get<{ name: string; description: string | null }>(num);
      if (!r) return null;
      // contra a comunidade inteira: só o admin (o dono não modera a si mesmo)
      return { authorId: null, authorUsername: null, authorRole: null, snapshot: [r.name, r.description].filter(Boolean).join("\n"), communityId: null, hackathonId: null };
    }
    case "desafio": {
      // desafio aberto (053): rascunho e desafio fora do ar não existem pra denúncia
      if (num === null) return null;
      const r = await db
        .prepare(
          `SELECT oc.createdBy, m.username, m.role, oc.title, oc.brief, oc.prize, oc.sponsorName, oc.communityId, oc.status,
                  oc.removedAt, co.hidden
           FROM open_challenges oc JOIN communities co ON co.id = oc.communityId LEFT JOIN members m ON m.id = oc.createdBy
           WHERE oc.id = ?`,
        )
        .get<{ createdBy: number; username: string | null; role: string | null; title: string; brief: string; prize: string | null; sponsorName: string | null; communityId: number; status: string; removedAt: string | null; hidden: number }>(num);
      if (!r || r.status === "rascunho" || r.removedAt || (Number(r.hidden) && !seesHidden)) return null;
      return {
        authorId: r.createdBy,
        authorUsername: r.username,
        authorRole: r.role,
        snapshot: [`Desafio "${r.title}" de @${r.username}`, r.sponsorName && `patrocinado por ${r.sponsorName}`, r.prize && `prêmio: ${r.prize}`, r.brief]
          .filter(Boolean)
          .join("\n"),
        communityId: r.communityId,
        hackathonId: null,
      };
    }
    case "desafio_entrega": {
      // entrega só é pública depois do prazo: antes disso, denúncia dá 404
      if (num === null) return null;
      const r = await db
        .prepare(
          `SELECT e.memberId, m.username, m.role, e.summary, e.repoUrl, e.demoUrl, e.removedAt, oc.title, oc.communityId,
                  oc.removedAt AS challengeRemovedAt, co.hidden,
                  (oc.status = 'resultado' OR (oc.status = 'aberto' AND to_ts(oc.deadline) <= now())) AS closed
           FROM open_challenge_entries e JOIN open_challenges oc ON oc.id = e.challengeId
           JOIN communities co ON co.id = oc.communityId JOIN members m ON m.id = e.memberId
           WHERE e.id = ?`,
        )
        .get<{ memberId: number; username: string; role: string; summary: string; repoUrl: string | null; demoUrl: string | null; removedAt: string | null; title: string; communityId: number; challengeRemovedAt: string | null; hidden: number; closed: boolean }>(num);
      if (!r || r.removedAt || r.challengeRemovedAt || !r.closed || (Number(r.hidden) && !seesHidden)) return null;
      return {
        authorId: r.memberId,
        authorUsername: r.username,
        authorRole: r.role,
        snapshot: [`@${r.username} no desafio "${r.title}": ${r.summary}`, r.repoUrl, r.demoUrl].filter(Boolean).join("\n"),
        communityId: r.communityId,
        hackathonId: null,
      };
    }
    // tópicos da comunidade (migration 058): vão pra quem modera a comunidade
    case "topic":
    case "topic_reply": {
      if (num === null) return null;
      const sql =
        type === "topic"
          ? `SELECT t.memberId, m.username, m.role, t.title || E'\\n' || t.body AS text, t.communityId, co.hidden
             FROM community_topics t JOIN communities co ON co.id = t.communityId LEFT JOIN members m ON m.id = t.memberId
             WHERE t.id = ? AND t.deletedAt IS NULL`
          : `SELECT r.memberId, m.username, m.role, r.body AS text, t.communityId, co.hidden
             FROM topic_replies r JOIN community_topics t ON t.id = r.topicId JOIN communities co ON co.id = t.communityId
             LEFT JOIN members m ON m.id = r.memberId
             WHERE r.id = ? AND r.deletedAt IS NULL`;
      const r = await db
        .prepare(sql)
        .get<{ memberId: number | null; username: string | null; role: string | null; text: string; communityId: number; hidden: number }>(num);
      if (!r || (Number(r.hidden) && !seesHidden)) return null;
      return {
        authorId: r.memberId === null ? null : Number(r.memberId),
        authorUsername: r.username,
        authorRole: r.role,
        snapshot: `${r.username ? `@${r.username}: ` : ""}${r.text}`,
        communityId: Number(r.communityId),
        hackathonId: null,
      };
    }
    case "depoimento": {
      // depoimento de time (migration 037): só o aceito é público. Vai pra
      // quem trata incidentes da edição em que o time existiu.
      if (num === null) return null;
      const r = await db
        .prepare(
          `SELECT t.authorId, a.username, a.role, m.username AS "memberUsername", t.body, t.hackathonId
           FROM team_testimonials t JOIN members a ON a.id = t.authorId JOIN members m ON m.id = t.memberId
           WHERE t.id = ? AND t.status = 'aceito'`,
        )
        .get<{ authorId: number; username: string; role: string; memberUsername: string; body: string; hackathonId: string }>(num);
      if (!r) return null;
      return {
        authorId: r.authorId,
        authorUsername: r.username,
        authorRole: r.role,
        snapshot: `@${r.username} sobre @${r.memberUsername}: ${r.body}`,
        communityId: null,
        hackathonId: r.hackathonId,
      };
    }
    case "encontro": {
      // encontro na edição (migration 050): a denúncia é sobre a OUTRA pessoa
      // do encontro e vai pra quem trata incidentes daquela edição. Sem
      // encontro não existe denúncia de encontro (404), e o texto livre que a
      // pessoa escreveu no próprio lado (nota privada) não entra no snapshot.
      if (num === null) return null;
      const r = await db
        .prepare(
          `SELECT e."hackathonId", e.status, h.name AS "hackathonName",
                  e."lowId", e."highId", e."initiatorId",
                  m.id AS "peerId", m.username, m.role
           FROM encounters e
           JOIN hackathons h ON h.id = e."hackathonId"
           JOIN members m ON m.id = CASE WHEN e."lowId" = @reporter THEN e."highId" ELSE e."lowId" END
           WHERE e.id = @id AND (e."lowId" = @reporter OR e."highId" = @reporter)`,
        )
        .get<{
          hackathonId: string;
          status: string;
          hackathonName: string;
          lowId: number;
          highId: number;
          initiatorId: number;
          peerId: number;
          username: string;
          role: string;
        }>({ id: num, reporter: reporterId });
      if (!r) return null;
      return {
        authorId: r.peerId,
        authorUsername: r.username,
        authorRole: r.role,
        snapshot: `Encontro registrado no ${r.hackathonName} (@${r.username} e você), situação: ${r.status}.`,
        communityId: null,
        hackathonId: r.hackathonId,
      };
    }
    default:
      return null;
  }
}

async function adminIds(): Promise<number[]> {
  return (await db.prepare("SELECT id FROM members WHERE role = 'admin'").all<{ id: number }>()).map((r) => r.id);
}

async function communityModerators(communityId: number): Promise<number[]> {
  const rows = await db
    .prepare("SELECT memberId FROM community_members WHERE communityId = ? AND role IN ('dono', 'organizador')")
    .all<{ memberId: number }>(communityId);
  return rows.length ? rows.map((r) => r.memberId) : adminIds();
}

async function editionModerators(hackathonId: string): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT memberId FROM edition_roles WHERE hackathonId = ? AND role = 'organizador'
       UNION SELECT memberId FROM edition_conduct_handlers WHERE hackathonId = ?`,
    )
    .all<{ memberId: number }>(hackathonId, hackathonId);
  return rows.length ? rows.map((r) => r.memberId) : adminIds();
}

/** o autor modera o espaço onde postou? aí a denúncia não pode ir pra ele */
async function authorModerates(t: Target): Promise<boolean> {
  if (t.authorId === null) return false;
  if (t.communityId !== null) {
    const r = await db
      .prepare("SELECT role FROM community_members WHERE communityId = ? AND memberId = ?")
      .get<{ role: string }>(t.communityId, t.authorId);
    if (r?.role === "dono" || r?.role === "organizador") return true;
  }
  if (t.hackathonId !== null) return canHandleIncidents({ id: t.authorId, role: t.authorRole ?? "member" }, t.hackathonId);
  return false;
}

/** onde a fila daquela denúncia mora */
export function queueHref(r: { communitySlug: string | null; hackathonId: string | null }): string {
  if (r.communitySlug) return `/comunidade/${r.communitySlug}/denuncias`;
  if (r.hackathonId) return `/admin/h/${r.hackathonId}/denuncias`;
  return "/admin#denuncias";
}

export type CreateReportInput = {
  targetType: unknown;
  targetId: unknown;
  reporterId: number;
  /** papel de quem denuncia: só o admin alcança conteúdo de comunidade escondida */
  reporterRole?: string | null;
  reason: unknown;
};
export type CreateReportResult = { id: number; blocked: string | null; incidentId: number | null };

/**
 * Registra a denúncia e roteia. Erros saem como ReportError com o status
 * HTTP: 400 (entrada ou alvo próprio), 404 (alvo não existe), 409 (já tem
 * denúncia aberta sua desse alvo).
 */
export async function createReport(input: CreateReportInput): Promise<CreateReportResult> {
  const type = typeof input.targetType === "string" ? input.targetType : "";
  if (!(REPORT_TARGETS as readonly string[]).includes(type)) throw new ReportError("Tipo de denúncia inválido.", 400);
  const targetId = typeof input.targetId === "number" ? String(input.targetId) : typeof input.targetId === "string" ? input.targetId.trim() : "";
  if (!targetId || targetId.length > 100) throw new ReportError("Alvo inválido.", 400);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < REPORT_LIMITS.reasonMin) throw new ReportError("Conte em poucas palavras o que está errado.", 400);
  if (reason.length > REPORT_LIMITS.reason) throw new ReportError(`Até ${REPORT_LIMITS.reason} caracteres.`, 400);

  const target = await resolveTarget(type as ReportTarget, targetId, input.reporterRole ?? null, input.reporterId);
  if (!target) throw new ReportError("Não encontrado.", 404);
  if (target.authorId === input.reporterId) throw new ReportError("Isso é seu. Se quiser, apague.", 400);
  if (await authorModerates(target)) {
    // quem modera o espaço é o denunciado: vai pro admin
    target.communityId = null;
    target.hackathonId = null;
  }

  const row = await db
    .prepare(
      `INSERT OR IGNORE INTO reports (targetType, targetId, reporterId, targetMemberId, reason, snapshot, communityId, hackathonId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(
      type,
      targetId,
      input.reporterId,
      target.authorId,
      reason,
      clip(target.snapshot, REPORT_LIMITS.snapshot),
      target.communityId,
      target.hackathonId,
    );
  if (!row) throw new ReportError("Você já denunciou isso. A moderação ainda está olhando.", 409);

  // "denunciar já bloqueia": quem denunciou para de ver a pessoa
  if (target.authorId !== null) await block(input.reporterId, target.authorId);

  let incidentId: number | null = null;
  // o denunciado nunca recebe o aviso da própria denúncia
  const notifyAll = (ids: number[], n: { text: string; href: string }) =>
    notifyMany(ids.filter((id) => id !== target.authorId), n);
  const label = REPORT_TARGET_LABEL[type as ReportTarget];
  if (target.hackathonId) {
    const h = await getHackathon(target.hackathonId);
    if (h && editionPhase(h, new Date()) === "ongoing") {
      const inc = await createIncident(
        target.hackathonId,
        {
          kind: "outro",
          description: `Denúncia de ${label}${type === "depoimento" ? " de time" : type === "encontro" ? " na edição" : " no mural da edição"}.\nMotivo: ${reason}\n\nTexto denunciado:\n${clip(target.snapshot, 1500)}\n\nFila: /admin/h/${target.hackathonId}/denuncias`,
          location: null,
          occurredAt: null,
          contact: null,
          // a fila de denúncia não mostra quem denunciou; o incidente também não
          anonymous: true,
        },
        null,
      );
      incidentId = inc.id;
    } else {
      await notifyAll(await editionModerators(target.hackathonId), {
        text: `Nova denúncia de ${label} em ${h?.name ?? target.hackathonId}`,
        href: `/admin/h/${target.hackathonId}/denuncias`,
      });
    }
  } else if (target.communityId) {
    const c = await db.prepare("SELECT slug, name FROM communities WHERE id = ?").get<{ slug: string; name: string }>(target.communityId);
    await notifyAll(await communityModerators(target.communityId), {
      text: `Nova denúncia de ${label} em ${c?.name ?? "sua comunidade"}`,
      href: `/comunidade/${c?.slug}/denuncias`,
    });
  } else {
    await notifyAll(await adminIds(), { text: `Nova denúncia de ${label} na fila do admin`, href: "/admin#denuncias" });
  }

  return { id: row.id, blocked: target.authorId !== null ? target.authorUsername : null, incidentId };
}

async function notifyMany(ids: number[], n: { text: string; href: string }) {
  await Promise.all([...new Set(ids)].map((id) => notify(id, { type: "report", text: n.text, href: n.href })));
}

export type Report = {
  id: number;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  snapshot: string | null;
  communityId: number | null;
  /** autor do conteúdo denunciado (a pessoa, no caso de perfil) */
  targetMemberId: number | null;
  communityName: string | null;
  communitySlug: string | null;
  hackathonId: string | null;
  hackathonName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByUsername: string | null;
  resolution: string | null;
  /** link pro conteúdo (null quando o tipo não tem página) */
  href: string | null;
  /** pra onde a denúncia foi: "comunidade X", "edição Y" ou "admin" */
  routedTo: string;
};

type ReportRow = Omit<Report, "href" | "routedTo"> & {
  reporterId: number | null;
  resolvedBy: number | null;
  targetUsername: string | null;
  targetCommunitySlug: string | null;
  targetChallengeId: number | null;
  targetTopicId: number | null;
  targetReplyId: number | null;
  targetTopicSlug: string | null;
  /** depoimento: @ de quem recebeu (o texto mora no perfil dela) */
  testimonialOwner: string | null;
};

const SELECT = `SELECT r.id, r.targetType, r.targetId, r.reporterId, r.targetMemberId, r.reason, r.snapshot,
    r.communityId, co.name AS communityName, co.slug AS communitySlug,
    r.hackathonId, h.name AS hackathonName,
    r.createdAt, r.resolvedAt, r.resolvedBy, rb.username AS resolvedByUsername, r.resolution,
    tm.username AS targetUsername, tc.slug AS targetCommunitySlug, te.challengeId AS targetChallengeId, tdm.username AS "testimonialOwner",
    ct.id AS targetTopicId, tr.id AS targetReplyId, ctc.slug AS targetTopicSlug
  FROM reports r
  LEFT JOIN communities co ON co.id = r.communityId
  LEFT JOIN hackathons h ON h.id = r.hackathonId
  LEFT JOIN members rb ON rb.id = r.resolvedBy
  LEFT JOIN members tm ON r.targetType = 'member' AND tm.id::text = r.targetId
  LEFT JOIN communities tc ON r.targetType = 'community' AND tc.id::text = r.targetId
  LEFT JOIN open_challenge_entries te ON r.targetType = 'desafio_entrega' AND te.id::text = r.targetId
  LEFT JOIN team_testimonials tt ON r.targetType = 'depoimento' AND tt.id::text = r.targetId
  LEFT JOIN members tdm ON tdm.id = tt.memberId
  LEFT JOIN topic_replies tr ON r.targetType = 'topic_reply' AND tr.id::text = r.targetId
  LEFT JOIN community_topics ct ON (r.targetType = 'topic' AND ct.id::text = r.targetId) OR ct.id = tr.topicId
  LEFT JOIN communities ctc ON ctc.id = ct.communityId`;

function toReport(r: ReportRow): Report {
  let href: string | null = null;
  if (r.targetType === "post" || r.targetType === "comment") {
    href = r.communitySlug ? `/comunidade/${r.communitySlug}` : r.hackathonId ? `/h/${r.hackathonId}` : "/feed";
  } else if (r.targetType === "member" && r.targetUsername) {
    href = `/u/${r.targetUsername}`;
  } else if (r.targetType === "community" && r.targetCommunitySlug) {
    href = `/comunidade/${r.targetCommunitySlug}`;
  } else if (r.targetType === "desafio") {
    href = `/desafios/${r.targetId}`;
  } else if (r.targetType === "desafio_entrega" && r.targetChallengeId) {
    href = `/desafios/${r.targetChallengeId}#entrega-${r.targetId}`;
  } else if (r.targetType === "depoimento" && r.testimonialOwner) {
    href = `/u/${r.testimonialOwner}`;
  } else if (r.targetType === "encontro" && r.hackathonId) {
    // encontro não tem página pública: a fila leva pra tela de encontros da edição
    href = `/h/${r.hackathonId}/encontros`;
  } else if ((r.targetType === "topic" || r.targetType === "topic_reply") && r.targetTopicSlug && r.targetTopicId) {
    href = `/comunidade/${r.targetTopicSlug}/t/${r.targetTopicId}${r.targetReplyId ? `#r-${r.targetReplyId}` : ""}`;
  }
  const routedTo = r.communityName
    ? `comunidade ${r.communityName}`
    : r.hackathonId
      ? `edição ${r.hackathonName ?? r.hackathonId}`
      : "admin";
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    snapshot: r.snapshot,
    communityId: r.communityId,
    targetMemberId: r.targetMemberId,
    communityName: r.communityName,
    communitySlug: r.communitySlug,
    hackathonId: r.hackathonId,
    hackathonName: r.hackathonName,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolvedByUsername: r.resolvedByUsername,
    resolution: r.resolution,
    href,
    routedTo,
  };
}

/**
 * viewerId (fila de comunidade ou edição): quem está olhando. Denúncia contra
 * essa pessoa não aparece pra ela, nem na lista nem na contagem.
 */
export type ReportScope = { communityId: number; viewerId?: number } | { hackathonId: string; viewerId?: number } | { global: true };

function notAgainstViewer(scope: ReportScope, bag: Record<string, unknown>, col = "targetMemberId"): string[] {
  if ("global" in scope || scope.viewerId === undefined) return [];
  bag.v = scope.viewerId;
  return [`(${col} IS NULL OR ${col} <> @v)`];
}

/**
 * Fila de um espaço. {global} é a do admin: todas, de qualquer espaço.
 * status "open" (padrão) lista as abertas, mais antiga primeiro; "resolved"
 * as resolvidas, mais recente primeiro.
 */
export async function listReports(
  scope: ReportScope,
  opts: { status?: "open" | "resolved"; type?: ReportTarget | null; limit?: number } = {},
): Promise<Report[]> {
  const where: string[] = [];
  const bag: Record<string, unknown> = { limit: Math.min(Math.max(opts.limit ?? 100, 1), 200) };
  if ("communityId" in scope) {
    where.push("r.communityId = @c");
    bag.c = scope.communityId;
  } else if ("hackathonId" in scope) {
    where.push("r.hackathonId = @h");
    bag.h = scope.hackathonId;
  }
  where.push(...notAgainstViewer(scope, bag, "r.targetMemberId"));
  const resolved = opts.status === "resolved";
  where.push(resolved ? "r.resolvedAt IS NOT NULL" : "r.resolvedAt IS NULL");
  if (opts.type) {
    where.push("r.targetType = @t");
    bag.t = opts.type;
  }
  const order = resolved ? "to_ts(r.resolvedAt) DESC, r.id DESC" : "r.id ASC";
  const rows = await db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT @limit`).all<ReportRow>(bag);
  return rows.map(toReport);
}

/** abertas por tipo (filtro da fila) */
export async function countOpenByType(scope: ReportScope): Promise<Partial<Record<ReportTarget, number>>> {
  const bag: Record<string, unknown> = {};
  let where = "resolvedAt IS NULL";
  if ("communityId" in scope) {
    where += " AND communityId = @c";
    bag.c = scope.communityId;
  } else if ("hackathonId" in scope) {
    where += " AND hackathonId = @h";
    bag.h = scope.hackathonId;
  }
  for (const w of notAgainstViewer(scope, bag)) where += ` AND ${w}`;
  const rows = await db
    .prepare(`SELECT targetType, COUNT(*)::int AS n FROM reports WHERE ${where} GROUP BY targetType`)
    .all<{ targetType: ReportTarget; n: number }>(bag);
  return Object.fromEntries(rows.map((r) => [r.targetType, Number(r.n)]));
}

export async function getReport(id: number): Promise<Report | null> {
  const row = await db.prepare(`${SELECT} WHERE r.id = ?`).get<ReportRow>(id);
  return row ? toReport(row) : null;
}

/**
 * Quem pode ler e resolver: admin global sempre; dono e organizador da
 * comunidade pro communityId; quem trata incidentes da edição pro hackathonId.
 * Nunca o autor do conteúdo denunciado (targetMemberId), salvo o admin
 * global: ele é a última instância e a fila dele mostra tudo.
 */
export async function canHandleReport(
  actor: Actor | null,
  report: Pick<Report, "communityId" | "hackathonId"> & { targetMemberId?: number | null },
): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  if (report.targetMemberId != null && report.targetMemberId === actor.id) return false;
  if (report.communityId !== null) {
    const r = await db
      .prepare("SELECT role FROM community_members WHERE communityId = ? AND memberId = ?")
      .get<{ role: string }>(report.communityId, actor.id);
    return r?.role === "dono" || r?.role === "organizador";
  }
  if (report.hackathonId !== null) return canHandleIncidents(actor, report.hackathonId);
  return false;
}

export type ResolveResult = { ok: true; report: Report } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export async function resolveReport(id: number, actor: Actor, resolution: unknown): Promise<ResolveResult> {
  const text = typeof resolution === "string" ? resolution.trim() : "";
  const report = await getReport(id);
  if (!report) return { ok: false, status: 404, error: "Denúncia não encontrada." };
  if (!(await canHandleReport(actor, report))) return { ok: false, status: 403, error: "Forbidden" };
  if (text.length < 3) return { ok: false, status: 400, error: "Diga o que foi feito." };
  if (text.length > REPORT_LIMITS.resolution) return { ok: false, status: 400, error: `Até ${REPORT_LIMITS.resolution} caracteres.` };
  const res = await db
    .prepare("UPDATE reports SET resolvedAt = sqlite_now(), resolvedBy = ?, resolution = ? WHERE id = ? AND resolvedAt IS NULL")
    .run(actor.id, text, id);
  if (res.changes === 0) return { ok: false, status: 409, error: "Essa denúncia já foi resolvida." };
  // fila da comunidade (046): a resolução entra no log de moderação dela
  if (report.communityId !== null) await logCommunityAction(report.communityId, actor.id, "report.resolve", `#${id}`);
  return { ok: true, report: (await getReport(id))! };
}

/** comunidade escondida pelo admin: as denúncias abertas contra ela ficam resolvidas */
export async function resolveCommunityTargetReports(communityId: number, resolution = "comunidade escondida"): Promise<void> {
  await db
    .prepare(
      `UPDATE reports SET resolvedAt = sqlite_now(), resolution = ?
       WHERE targetType = 'community' AND targetId = ? AND resolvedAt IS NULL`,
    )
    .run(resolution, String(communityId));
}

