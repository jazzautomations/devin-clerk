import { createHmac, timingSafeEqual } from "node:crypto";
import db from "@/lib/db";
import { ticketSecret } from "@/lib/checkins";
import { parseEventTime, spParts } from "@/lib/eventTime";
import { getPrefs, setPref, unreadCount } from "@/lib/notifications";
import { emailDriver } from "@/lib/notify/email";
import type { Driver, EmailMessage, SendOutcome } from "@/lib/notify/types";
import { absoluteUrl } from "@/lib/seo";

// Resumo semanal por e-mail (spec 046, notificacoes-boas; migration 040).
//
// buildDigest monta o resumo de uma pessoa com dados reais dos 7 dias
// anteriores a `now`. Seção sem nada some; tudo vazio não envia. runDigest é
// o cron de segunda: pega quem usou o HackaHub nos últimos 180 dias
// (members.lastSeenAt, migration 031), em lotes de 100, e grava uma linha
// por pessoa por semana em digest_sends — a PK é a trava, então rodar duas
// vezes na semana manda uma vez. Sem RESEND_API_KEY o driver devolve
// "skipped" e a linha fica 'pulado'.

const DAY = 24 * 60 * 60 * 1000;
export const DIGEST_WINDOW_DAYS = 7;
export const DIGEST_ACTIVE_DAYS = 180;
export const DIGEST_BATCH = 100;

export type DigestItem = { title: string; detail: string | null; href: string };
export type DigestSectionKey = "fecha" | "entregou" | "comunidades" | "naoLidas";
export type DigestSection = { key: DigestSectionKey; title: string; items: DigestItem[]; href: string | null };
export type Digest = { sections: DigestSection[]; empty: boolean };

async function tableExists(name: string): Promise<boolean> {
  const row = await db.prepare("SELECT to_regclass(?::text) IS NOT NULL AS ok").get<{ ok: boolean }>(name);
  return Boolean(row?.ok);
}

const shortDate = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
});

/** "fecha 31 de out." a partir do texto da coluna (horário de Brasília quando sem fuso) */
function closesLabel(deadline: string): string | null {
  const d = parseEventTime(deadline);
  return d ? `inscrição fecha ${shortDate.format(d)}` : null;
}

/** Semana ISO no horário de Brasília: "2026-W44". Segunda 00:00 BRT vira a semana. */
export function isoWeekBrt(now: Date): string {
  const p = spParts(now);
  // a data de parede em Brasília, tratada como UTC só pra contar dias
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const dow = date.getUTCDay() || 7; // segunda = 1, domingo = 7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // quinta da mesma semana decide o ano
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * O resumo de uma pessoa. Janela: [now - 7 dias, now) pro que aconteceu e
 * (now, now + 7 dias] pro prazo de inscrição.
 */
export async function buildDigest(memberId: number, now: Date = new Date()): Promise<Digest> {
  const from = new Date(now.getTime() - DIGEST_WINDOW_DAYS * DAY).toISOString();
  const to = now.toISOString();
  const until = new Date(now.getTime() + DIGEST_WINDOW_DAYS * DAY).toISOString();
  const sections: DigestSection[] = [];

  // 1. inscrições do radar que fecham nos próximos 7 dias
  const closing = await db
    .prepare(
      `SELECT h.id, h.name, h.registrationDeadline
       FROM hackathons h LEFT JOIN communities c ON c.id = h.communityId
       WHERE h.active = 1 AND COALESCE(c.hidden, 0) = 0
         AND to_ts(h.registrationDeadline) > @to::timestamptz
         AND to_ts(h.registrationDeadline) <= @until::timestamptz
       ORDER BY to_ts(h.registrationDeadline), h.id
       LIMIT 5`,
    )
    .all<{ id: string; name: string; registrationDeadline: string }>({ to, until });
  sections.push({
    key: "fecha",
    title: "Fecha nesta semana",
    href: "/radar",
    items: closing.map((h) => ({ title: h.name, detail: closesLabel(h.registrationDeadline), href: `/h/${h.id}` })),
  });

  // 2. times de quem você segue que entregaram na semana (seguir pessoa é
  //    da onda 1: sem a tabela, a seção só fica vazia)
  let delivered: { teamId: number; title: string; edition: string; username: string }[] = [];
  if (await tableExists("member_follows")) {
    delivered = await db
      .prepare(
        `SELECT * FROM (
         SELECT DISTINCT ON (t.id) t.id AS "teamId", COALESCE(tp.title, t.name) AS title, h.name AS edition,
                m.username, to_ts(ps.submittedAt) AS at
         FROM member_follows f
         JOIN members m ON m.id = f.followedId AND m.clerkId NOT LIKE 'deleted:%'
         JOIN team_members tm ON tm.username = m.username
         JOIN teams t ON t.id = tm.teamId
         JOIN hackathons h ON h.id = t.hackathonId
         LEFT JOIN communities c ON c.id = h.communityId
         LEFT JOIN team_projects tp ON tp.teamId = t.id
         JOIN project_submissions ps ON ps.teamId = t.id
         WHERE f.memberId = @me AND COALESCE(c.hidden, 0) = 0
           AND to_ts(ps.submittedAt) >= @from::timestamptz AND to_ts(ps.submittedAt) < @to::timestamptz
           AND NOT EXISTS (SELECT 1 FROM member_blocks b
             WHERE (b.memberId = @me AND b.blockedId = m.id) OR (b.memberId = m.id AND b.blockedId = @me))
           AND NOT EXISTS (SELECT 1 FROM member_mutes x WHERE x.memberId = @me AND x.mutedId = m.id)
         ORDER BY t.id, to_ts(ps.submittedAt) DESC
         ) x ORDER BY x.at DESC, x."teamId" DESC LIMIT 5`,
      )
      .all<{ teamId: number; title: string; edition: string; username: string }>({ me: memberId, from, to });
  }
  sections.push({
    key: "entregou",
    title: "Quem você segue entregou",
    href: null,
    items: delivered.map((d) => ({ title: d.title, detail: `@${d.username} · ${d.edition}`, href: `/p/${d.teamId}` })),
  });

  // 3. projetos novos (primeira entrega na semana) nas edições das
  //    comunidades que você faz parte ou segue
  const shown = new Set(delivered.map((d) => Number(d.teamId)));
  const fresh = await db
    .prepare(
      `SELECT t.id AS "teamId", COALESCE(tp.title, t.name) AS title, c.name AS community, MIN(ps.submittedAt) AS first
       FROM teams t
       JOIN hackathons h ON h.id = t.hackathonId
       JOIN communities c ON c.id = h.communityId AND c.hidden = 0
       LEFT JOIN team_projects tp ON tp.teamId = t.id
       JOIN project_submissions ps ON ps.teamId = t.id
       WHERE h.communityId IN (
           SELECT communityId FROM community_members WHERE memberId = @me
           UNION SELECT communityId FROM community_follows WHERE memberId = @me)
       GROUP BY t.id, tp.title, t.name, c.name
       HAVING to_ts(MIN(ps.submittedAt)) >= @from::timestamptz AND to_ts(MIN(ps.submittedAt)) < @to::timestamptz
       ORDER BY to_ts(MIN(ps.submittedAt)) DESC, t.id DESC
       LIMIT 8`,
    )
    .all<{ teamId: number; title: string; community: string }>({ me: memberId, from, to });
  sections.push({
    key: "comunidades",
    title: "Novos projetos das suas comunidades",
    href: "/projetos",
    items: fresh
      .filter((p) => !shown.has(Number(p.teamId)))
      .slice(0, 3)
      .map((p) => ({ title: p.title, detail: p.community, href: `/p/${p.teamId}` })),
  });

  // 4. o que está esperando no sino
  const unread = await unreadCount(memberId);
  sections.push({
    key: "naoLidas",
    title: unread === 1 ? "Você tem 1 notificação não lida" : `Você tem ${unread} notificações não lidas`,
    href: "/notificacoes",
    items: [],
  });

  const visible = sections.filter((s) => (s.key === "naoLidas" ? unread > 0 : s.items.length > 0));
  return { sections: visible, empty: visible.length === 0 };
}

// ---------- link "parar de receber" ----------

// HMAC de memberId + 'digest' com o segredo do ingresso (lib/checkins.ts),
// no mesmo formato base64url de 43 caracteres. O id vai no token porque o
// link precisa achar a pessoa sem login; o MAC impede trocar o id.
const TOKEN_RE = /^D1\.(\d{1,10})\.([A-Za-z0-9_-]{43})$/;

const digestMac = (memberId: number) =>
  createHmac("sha256", ticketSecret()).update(`${memberId}:digest`).digest("base64url");

export function digestToken(memberId: number): string {
  return `D1.${memberId}.${digestMac(memberId)}`;
}

/** id do membro dono do token, ou null (formato errado, MAC errado) */
export function verifyDigestToken(token: unknown): number | null {
  if (typeof token !== "string") return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const given = Buffer.from(m[2]);
  const expected = Buffer.from(digestMac(id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export const digestStopUrl = (memberId: number) =>
  absoluteUrl(`/api/notifications/digest/sair/${digestToken(memberId)}`);

/** desliga o resumo por e-mail; false se a conta não existe mais */
export async function stopDigest(memberId: number): Promise<boolean> {
  const m = await db
    .prepare("SELECT id FROM members WHERE id = ? AND clerkId NOT LIKE 'deleted:%'")
    .get<{ id: number }>(memberId);
  if (!m) return false;
  await setPref(memberId, "digest", { email: false });
  return true;
}

// ---------- e-mail ----------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderDigestEmail(
  digest: Digest,
  opts: { name: string | null; stopUrl: string },
): { subject: string; html: string; text: string } {
  const subject = "Sua semana no HackaHub";
  const prefs = absoluteUrl("/notificacoes/preferencias");
  const hello = opts.name ? `Oi, ${opts.name.split(" ")[0]}.` : "Oi.";
  const mono = "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace";
  const sans = "Archivo,'Helvetica Neue',Arial,sans-serif";

  const htmlSections = digest.sections
    .map((s) => {
      const head = s.href
        ? `<a href="${esc(absoluteUrl(s.href))}" style="color:#0c0c0c;text-decoration:none;">${esc(s.title)}</a>`
        : esc(s.title);
      const items = s.items
        .map(
          (i) =>
            `<tr><td style="padding:10px 0;border-top:1px solid #0c0c0c;font-family:${sans};">` +
            `<a href="${esc(absoluteUrl(i.href))}" style="font-size:16px;font-weight:700;color:#047a43;text-decoration:none;">${esc(i.title)}</a>` +
            (i.detail ? `<br><span style="font-family:${mono};font-size:12px;color:#474747;">${esc(i.detail)}</span>` : "") +
            `</td></tr>`,
        )
        .join("");
      return (
        `<tr><td style="padding:20px 24px 4px;">` +
        `<h2 style="margin:0 0 8px;font-family:${sans};font-size:20px;line-height:1.2;font-weight:800;letter-spacing:-.01em;color:#0c0c0c;">${head}</h2>` +
        (items ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>` : "") +
        `</td></tr>`
      );
    })
    .join("");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#fefefe;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fefefe;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:2px solid #0c0c0c;background:#fefefe;">
<tr><td style="background:#0c0c0c;padding:8px 16px;font-family:${mono};font-size:13px;letter-spacing:.06em;color:#3ecf8e;text-transform:uppercase;">HackaHub · sua semana</td></tr>
<tr><td style="padding:24px 24px 0;font-family:${sans};font-size:16px;line-height:1.5;color:#0c0c0c;">${esc(hello)} O que rolou nos últimos 7 dias.</td></tr>
${htmlSections}
<tr><td style="padding:16px 24px 24px;"></td></tr>
<tr><td style="border-top:1.5px solid #0c0c0c;background:#d8f4e5;padding:16px 24px;font-family:${mono};font-size:12px;line-height:1.6;color:#474747;">
Chega toda segunda pra quem usou o HackaHub nos últimos meses.<br>
<a href="${esc(opts.stopUrl)}" style="color:#047a43;">Parar de receber</a> · <a href="${esc(prefs)}" style="color:#047a43;">preferências de notificação</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const lines = [hello, "O que rolou nos últimos 7 dias.", ""];
  for (const s of digest.sections) {
    lines.push(s.title);
    for (const i of s.items) {
      lines.push(`- ${i.title}${i.detail ? ` (${i.detail})` : ""}`, `  ${absoluteUrl(i.href)}`);
    }
    if (s.items.length === 0 && s.href) lines.push(absoluteUrl(s.href));
    lines.push("");
  }
  lines.push("--", `Parar de receber: ${opts.stopUrl}`, `Preferências de notificação: ${prefs}`);
  return { subject, html, text: lines.join("\n") };
}

// ---------- cron ----------

export type DigestRun = {
  week: string;
  candidates: number;
  enviado: number;
  pulado: number;
  vazio: number;
  falhou: number;
};

type Candidate = { id: number; email: string; name: string | null; emailBouncedAt: string | null };

/**
 * Reserva a pessoa pra esta semana. Nova linha, ou uma 'falhou' de execução
 * anterior (ou 'enviando' esquecida há mais de 1h), vira 'enviando'. Duas
 * execuções em paralelo: só uma ganha a reserva.
 */
async function claim(memberId: number, week: string, runStart: string): Promise<boolean> {
  const ins = await db
    .prepare(
      `INSERT INTO digest_sends (memberId, week, status) VALUES (?, ?, 'enviando')
       ON CONFLICT (memberId, week) DO NOTHING RETURNING memberId`,
    )
    .get(memberId, week);
  if (ins) return true;
  const retry = await db
    .prepare(
      `UPDATE digest_sends SET status = 'enviando', reason = NULL, createdAt = sqlite_now()
       WHERE memberId = @me AND week = @week
         AND ((status = 'falhou' AND to_ts(createdAt) < @runStart::timestamptz)
           OR (status = 'enviando' AND to_ts(createdAt) < now() - interval '1 hour'))
       RETURNING memberId`,
    )
    .get({ me: memberId, week, runStart });
  return !!retry;
}

async function finish(memberId: number, week: string, status: Exclude<keyof DigestRun, "week" | "candidates">, reason: string | null) {
  await db
    .prepare(`UPDATE digest_sends SET status = ?, reason = ?, createdAt = sqlite_now() WHERE memberId = ? AND week = ?`)
    .run(status, reason ? reason.slice(0, 300) : null, memberId, week);
}

/**
 * Manda o resumo da semana. Idempotente por (pessoa, semana). Quem entra:
 * conta ativa, lastSeenAt nos últimos 180 dias, resumo por e-mail ligado.
 */
export async function runDigest(
  now: Date = new Date(),
  driver: Driver<EmailMessage> = emailDriver(),
): Promise<DigestRun> {
  const week = isoWeekBrt(now);
  // segundo cheio: createdAt é texto com precisão de segundo, e uma 'falhou'
  // gravada neste mesmo segundo não pode ser tentada de novo nesta execução
  const runStart = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString();
  const activeSince = new Date(now.getTime() - DIGEST_ACTIVE_DAYS * DAY).toISOString();
  const out: DigestRun = { week, candidates: 0, enviado: 0, pulado: 0, vazio: 0, falhou: 0 };
  let after = 0;

  for (;;) {
    const batch = await db
      .prepare(
        `SELECT m.id, m.email, m.name, m.emailBouncedAt FROM members m
         WHERE m.id > @after AND m.clerkId NOT LIKE 'deleted:%'
           AND to_ts(m.lastSeenAt) >= @activeSince::timestamptz
           AND NOT EXISTS (SELECT 1 FROM notification_prefs np
             WHERE np.memberId = m.id AND np."group" = 'digest' AND np.email = 0)
           AND NOT EXISTS (SELECT 1 FROM digest_sends d
             WHERE d.memberId = m.id AND d.week = @week
               AND NOT ((d.status = 'falhou' AND to_ts(d.createdAt) < @runStart::timestamptz)
                 OR (d.status = 'enviando' AND to_ts(d.createdAt) < now() - interval '1 hour')))
         ORDER BY m.id LIMIT @batch`,
      )
      .all<Candidate>({ after, activeSince, week, runStart, batch: DIGEST_BATCH });
    if (batch.length === 0) break;
    after = Number(batch[batch.length - 1].id);
    out.candidates += batch.length;

    for (const m of batch) {
      if (!(await claim(m.id, week, runStart))) continue;
      try {
        const digest = await buildDigest(m.id, now);
        if (digest.empty) {
          await finish(m.id, week, "vazio", null);
          out.vazio++;
          continue;
        }
        // desligou entre a seleção e o envio
        if (!(await getPrefs(m.id)).digest.email) {
          await finish(m.id, week, "pulado", "resumo desligado");
          out.pulado++;
          continue;
        }
        if (m.emailBouncedAt) {
          await finish(m.id, week, "pulado", `e-mail com bounce desde ${m.emailBouncedAt}`);
          out.pulado++;
          continue;
        }
        const stopUrl = digestStopUrl(m.id);
        const mail = renderDigestEmail(digest, { name: m.name, stopUrl });
        const res: SendOutcome = await driver.send({
          to: m.email,
          ...mail,
          idempotencyKey: `digest:${m.id}:${week}`,
          unsubscribeUrl: stopUrl,
        });
        if (res.status === "sent") {
          await finish(m.id, week, "enviado", null);
          out.enviado++;
        } else if (res.status === "skipped") {
          await finish(m.id, week, "pulado", res.reason);
          out.pulado++;
        } else {
          await finish(m.id, week, "falhou", res.error);
          out.falhou++;
        }
      } catch (e) {
        await finish(m.id, week, "falhou", e instanceof Error ? e.message : String(e));
        out.falhou++;
      }
    }
    if (batch.length < DIGEST_BATCH) break;
  }
  return out;
}
