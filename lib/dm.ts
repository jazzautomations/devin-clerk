import db from "@/lib/db";
import { isBlockedEither, lockPair } from "@/lib/blocks";
import { sameTeam } from "@/lib/evidence";
import { canNetwork } from "@/lib/network";
import { notify } from "@/lib/notifications";
import { rateLimit, RATE_LIMITS } from "@/lib/ratelimit";
import {
  DM_BODY_MAX,
  DM_PAGE_SIZE,
  DM_REQUEST_MAX,
  type DmEntry,
  type DmLock,
  type DmMessage,
  type DmPeer,
  type ThreadListItem,
  type ThreadStatus,
} from "@/lib/dmText";

export {
  DM_BODY_MAX,
  DM_DECLINE_COOLDOWN_DAYS,
  DM_PAGE_SIZE,
  DM_REQUEST_MAX,
  type DmEntry,
  type DmLock,
  type DmLockState,
  type DmMessage,
  type DmPeer,
  type ThreadListItem,
  type ThreadStatus,
} from "@/lib/dmText";

// Mensagem direta com trava (spec 046, onda 6 — migration 056).
//
// Conversa privada 1 a 1. A trava (canMessage) só libera quem já tem laço:
// seguir mútuo, mesmo time (sameTeam), encontro confirmado (migration 050)
// ou candidatura aceita na vaga do time da outra pessoa (migration 045).
// Sem laço, a pessoa manda UM pedido de até REQUEST_MAX caracteres; o outro
// aceita (a thread abre) ou recusa (30 dias sem pedir de novo). Aberta pra
// todo mundo vira spam — por isso a trava fica aqui e não na tela.
//
// - dm_threads guarda o par em ordem crescente (memberId < peerId): uma
//   thread por par, pra sempre. Nasce 'aberta' com laço ou 'pedido' sem;
//   'recusada' guarda declinedAt pra regra dos 30 dias.
// - O laço pode chegar depois do pedido (as pessoas se seguem, fazem time):
//   canMessage 'livre' converte pedido e até recusa antiga em 'aberta'.
//   Dentro de uma thread aberta a conversa continua mesmo se o laço some —
//   bloqueio (member_blocks) é a única coisa que fecha.
// - Bloqueio vale nos dois sentidos: bloqueado não é "sem laço", é 404.
//   Denúncia é reports (targetType 'dm', case em lib/reports.ts): a fila
//   vê só o snapshot da mensagem denunciada — admin e organizador NÃO leem
//   DM (naoFazer).
// - Notificação type 'dm' (grupo social): um aviso quando a thread fica
//   não lida pra pessoa — mensagem nova com a thread já não lida não repete.
// - LGPD: memberId/peerId seguem PEER_COLUMNS — qualquer lado saindo apaga
//   a thread inteira. Pedido também entra no export como linha própria.

export class DmError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

// Rate limit por resultado, não por rota: a mesma chamada vira mensagem
// (balde 'dm', 120/h) ou pedido (balde 'dm-requests', 5/dia) conforme o
// laço — e pedido duplicado/erro não gasta o dia.
function limitOrThrow(bucket: "dm" | "dm-requests", meId: number): void {
  const r = rateLimit(`${bucket}:${meId}`, RATE_LIMITS[bucket]);
  if (!r.ok) {
    throw new DmError(
      bucket === "dm-requests" ? "Muitos pedidos hoje. Tente amanhã." : "Muitas mensagens. Tente mais tarde.",
      429,
      r.retryAfterSec,
    );
  }
}

export type ThreadRow = {
  id: number;
  memberId: number;
  peerId: number;
  status: ThreadStatus;
  requestedBy: number | null;
  declinedAt: string | null;
  createdAt: string;
  lastMessageAt: string | null;
};

const lowHigh = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

/**
 * A trava: quem pode conversar com quem, e por quê (o motivo vai pra tela
 * como texto acessível do botão). 'bloqueado' = bloqueio em qualquer
 * sentido ou canNetwork falso de um dos lados — pra quem olha de fora é
 * indistinguível de "não existe" (404 nas rotas, sem botão no /u).
 */
export async function canMessage(a: number, b: number): Promise<DmLock> {
  if (a === b) return { estado: "bloqueado", motivo: "não dá pra conversar consigo mesmo" };
  const [netA, netB, blocked] = await Promise.all([canNetwork(a), canNetwork(b), isBlockedEither(a, b)]);
  if (!netA || !netB) return { estado: "bloqueado", motivo: "mensagem indisponível" };
  if (blocked) return { estado: "bloqueado", motivo: "mensagem indisponível" };

  const [low, high] = lowHigh(a, b);
  const [mutual, teams, encounter, accepted] = await Promise.all([
    db
      .prepare(
        `SELECT EXISTS (
           SELECT 1 FROM member_follows f1
           JOIN member_follows f2 ON f2."memberId" = f1."followedId" AND f2."followedId" = f1."memberId"
           WHERE f1."memberId" = ? AND f1."followedId" = ?) AS x`,
      )
      .get<{ x: boolean }>(a, b),
    sameTeam(a, b),
    db
      .prepare(
        `SELECT h.name FROM encounters e JOIN hackathons h ON h.id = e."hackathonId"
         WHERE e."lowId" = ? AND e."highId" = ? AND e.status = 'confirmed'
         ORDER BY e.id DESC LIMIT 1`,
      )
      .get<{ name: string }>(low, high),
    // vaga aceita (045): um dos dois foi aceito numa vaga do time do outro
    db
      .prepare(
        `SELECT h.name FROM opening_applications ap
         JOIN team_openings o ON o.id = ap."openingId"
         JOIN hackathons h ON h.id = o."hackathonId"
         JOIN team_members tm ON tm."teamId" = o."teamId"
         JOIN members m ON m.username = tm.username
         WHERE ap.status = 'aceita'
           AND ((ap."memberId" = @a AND m.id = @b) OR (ap."memberId" = @b AND m.id = @a))
         ORDER BY ap.id DESC LIMIT 1`,
      )
      .get<{ name: string }>({ a, b }),
  ]);
  if (mutual?.x) return { estado: "livre", motivo: "vocês se seguem" };
  if (teams.length) return { estado: "livre", motivo: `vocês fizeram time no ${teams[0].hackathonName}` };
  if (encounter) return { estado: "livre", motivo: `vocês se encontraram no ${encounter.name}` };
  if (accepted) return { estado: "livre", motivo: `vaga aceita no ${accepted.name}` };
  return { estado: "pedido", motivo: "vocês ainda não têm laço — a pessoa aceita seu pedido pra conversar" };
}

/** a thread do par (qualquer status), se existe */
export async function threadBetween(a: number, b: number): Promise<ThreadRow | null> {
  const [low, high] = lowHigh(a, b);
  const row = await db
    .prepare(`SELECT * FROM dm_threads WHERE "memberId" = ? AND "peerId" = ?`)
    .get<ThreadRow>(low, high);
  return row ?? null;
}

export function cleanDmBody(raw: unknown, max = DM_BODY_MAX): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) throw new DmError("Escreva a mensagem.", 400);
  if ([...body].length > max) throw new DmError(`Até ${max} caracteres.`, 400);
  return body;
}

async function insertMessage(threadId: number, authorId: number, body: string): Promise<DmMessage> {
  const row = await db
    .prepare(
      `INSERT INTO dm_messages ("threadId", "memberId", "body") VALUES (?, ?, ?)
       RETURNING id, "createdAt"`,
    )
    .get<{ id: number; createdAt: string }>(threadId, authorId, body);
  await db.prepare(`UPDATE dm_threads SET "lastMessageAt" = ? WHERE id = ?`).run(row!.createdAt, threadId);
  return { id: Number(row!.id), body, createdAt: row!.createdAt, mine: true, authorUsername: "" };
}

/**
 * Marca a thread como lida pela pessoa até a última mensagem. Rodada na
 * abertura da conversa e a cada poll do DmThread (GET /api/dm/[id]).
 */
export async function markThreadRead(threadId: number, memberId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dm_reads ("threadId", "memberId", "lastReadId")
       SELECT ?, ?, COALESCE((SELECT MAX(id) FROM dm_messages WHERE "threadId" = ?), 0)
       ON CONFLICT ("threadId", "memberId")
       DO UPDATE SET "lastReadId" = EXCLUDED."lastReadId"`,
    )
    .run(threadId, memberId, threadId);
  // abrir a conversa consome os avisos 'dm' dela no sino — a próxima
  // mensagem nova pode avisar de novo ("primeiro aviso da thread não lida")
  await db
    .prepare(`UPDATE notifications SET read = 1 WHERE memberId = ? AND type = 'dm' AND href = ? AND read = 0`)
    .run(memberId, `/mensagens/${threadId}`);
}

/**
 * Avisa o destinatário da mensagem nova — mas só o PRIMEIRO aviso de cada
 * thread não lida: já existe notificação 'dm' não lida apontando pra
 * conversa (o pedido, o aceite ou uma mensagem anterior), a nova mensagem
 * não repete. Abrir a thread consome o aviso (markThreadRead), então a
 * próxima mensagem depois da leitura avisa de novo. A trava por
 * (pessoa, thread) impede insert duplo na corrida.
 */
async function notifyFirstUnread(
  thread: ThreadRow,
  author: { id: number; username: string },
  peerId: number,
): Promise<void> {
  const href = `/mensagens/${thread.id}`;
  await db.transaction(async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?::text)) AS ok").get(`dm-notify:${peerId}:${href}`);
    const pending = await db
      .prepare(`SELECT EXISTS (SELECT 1 FROM notifications WHERE memberId = ? AND type = 'dm' AND href = ? AND read = 0) AS x`)
      .get<{ x: boolean }>(peerId, href);
    if (pending?.x) return;
    await notify(peerId, {
      type: "dm",
      actorId: author.id,
      actorUsername: author.username,
      text: `@${author.username} mandou uma mensagem pra você`,
      href,
    });
  })();
}

/**
 * Grava a mensagem numa thread 'aberta' da qual a pessoa faz parte.
 * Devolve a mensagem (já marca a leitura do autor). Erros: 404 thread
 * alheia ou bloqueio, 400 conversa não aberta, 400 texto inválido.
 */
export async function sendMessage(
  me: { id: number; username: string },
  thread: ThreadRow,
  rawBody: unknown,
): Promise<DmMessage> {
  if (thread.status !== "aberta") throw new DmError("A conversa ainda não abriu.", 400);
  const peerId = thread.memberId === me.id ? thread.peerId : thread.memberId;
  const [netPeer, blocked] = await Promise.all([canNetwork(peerId), isBlockedEither(me.id, peerId)]);
  if (!netPeer || blocked) throw new DmError("Não encontrado.", 404);
  const body = cleanDmBody(rawBody);
  limitOrThrow("dm", me.id);
  const msg = await db.transaction(async () => {
    await lockPair(me.id, peerId);
    const m = await insertMessage(thread.id, me.id, body);
    await markThreadRead(thread.id, me.id);
    return m;
  })();
  await notifyFirstUnread(thread, me, peerId);
  return msg;
}

/**
 * POST /api/dm {username, body}: o ponto de entrada — mensagem direta pra
 * quem tem laço, pedido de conversa pra quem não tem. Tudo dentro da trava
 * do par pra não nascer duas threads nem pedido depois de bloqueio.
 *
 * Devolve {thread, status}: 'aberta' (mensagem enviada) ou 'pedido'
 * (pedido enviado). Erros: 404 pessoa não encontrada ou bloqueio, 400
 * texto fora do limite ou recusa em menos de 30 dias, 409 pedido pendente.
 */
export async function startConversation(
  me: { id: number; username: string },
  other: { id: number; username: string },
  rawBody: unknown,
): Promise<{ thread: ThreadRow; status: "aberta" | "pedido"; isRequest: boolean }> {
  if (me.id === other.id) throw new DmError("Pessoa não encontrada.", 404);
  const lock = await canMessage(me.id, other.id);
  if (lock.estado === "bloqueado") throw new DmError("Pessoa não encontrada.", 404);
  const livre = lock.estado === "livre";
  const body = cleanDmBody(rawBody, livre ? DM_BODY_MAX : DM_REQUEST_MAX);
  const [low, high] = lowHigh(me.id, other.id);

  const out = await db.transaction(async () => {
    await lockPair(me.id, other.id);
    let thread = await threadBetween(me.id, other.id);

    if (thread) {
      if (livre && thread.status !== "aberta") {
        // o laço chegou depois do pedido (ou da recusa): a conversa abre
        await db.prepare(`UPDATE dm_threads SET status = 'aberta', "declinedAt" = NULL WHERE id = ?`).run(thread.id);
        thread = { ...thread, status: "aberta", declinedAt: null };
      }
      if (thread.status === "aberta") {
        limitOrThrow("dm", me.id);
        const m = await insertMessage(thread.id, me.id, body);
        await markThreadRead(thread.id, me.id);
        return { thread, status: "aberta" as const, isRequest: false, message: m };
      }
      // sem laço: a thread é 'pedido' ou 'recusada'
      if (thread.status === "pedido") {
        if (thread.requestedBy === me.id) throw new DmError("Você já pediu. Espera a resposta.", 409);
        throw new DmError(`@${other.username} já pediu pra conversar com você. Aceite o pedido em mensagens.`, 409);
      }
      // recusada: quem foi recusado espera 30 dias; o outro lado pede livre
      if (thread.requestedBy === me.id && thread.declinedAt) {
        const stillCooling = await db
          .prepare(`SELECT (to_ts(?) > now() - interval '30 days') AS x`)
          .get<{ x: boolean }>(thread.declinedAt);
        if (stillCooling?.x) throw new DmError("Espere um tempo antes de pedir de novo.", 400);
      }
      await db
        .prepare(`UPDATE dm_threads SET status = 'pedido', "requestedBy" = ?, "declinedAt" = NULL WHERE id = ?`)
        .run(me.id, thread.id);
      thread = { ...thread, status: "pedido", requestedBy: me.id, declinedAt: null };
    } else {
      const status = livre ? "aberta" : "pedido";
      const row = await db
        .prepare(
          `INSERT INTO dm_threads ("memberId", "peerId", status, "requestedBy")
           VALUES (?, ?, ?, ?) RETURNING *`,
        )
        .get<ThreadRow>(low, high, status, livre ? null : me.id);
      thread = row!;
    }

    if (thread.status === "pedido") limitOrThrow("dm-requests", me.id);
    else limitOrThrow("dm", me.id);
    const m = await insertMessage(thread.id, me.id, body);
    await markThreadRead(thread.id, me.id);
    return { thread, status: thread.status as "aberta" | "pedido", isRequest: thread.status === "pedido", message: m };
  })();

  if (out.isRequest) {
    await notify(other.id, {
      type: "dm",
      actorId: me.id,
      actorUsername: me.username,
      text: `@${me.username} pediu pra conversar com você`,
      href: `/mensagens/${out.thread.id}`,
    });
  } else {
    await notifyFirstUnread(out.thread, me, other.id);
  }
  return { thread: out.thread, status: out.status, isRequest: out.isRequest };
}

/** thread do participante + o outro lado. Thread alheia: null (404 na rota) */
export async function getThreadFor(meId: number, threadId: number): Promise<{ thread: ThreadRow; peer: DmPeer } | null> {
  const row = await db
    .prepare(
      `SELECT t.*, m.id AS "pId", m.username, m.name, m.avatarUrl
       FROM dm_threads t
       JOIN members m ON m.id = CASE WHEN t."memberId" = @me THEN t."peerId" ELSE t."memberId" END
       WHERE t.id = @id AND (t."memberId" = @me OR t."peerId" = @me)`,
    )
    .get<ThreadRow & { pId: number; username: string; name: string | null; avatarUrl: string | null }>({ me: meId, id: threadId });
  if (!row) return null;
  const { pId, username, name, avatarUrl, ...thread } = row;
  return { thread: thread as ThreadRow, peer: { id: Number(pId), username, name, avatarUrl } };
}

/**
 * Mensagens da thread em ordem crescente (mais antiga primeiro), com cursor
 * `antes` = id da mais antiga da página anterior. Também marca a leitura —
 * abrir a conversa é ler. `mais` = id pra próxima página de antigas.
 */
export async function listMessages(
  meId: number,
  threadId: number,
  antes: number | null,
): Promise<{ messages: DmMessage[]; mais: number | null } | null> {
  const found = await getThreadFor(meId, threadId);
  if (!found) return null;
  const rows = await db
    .prepare(
      `SELECT dm.id, dm.body, dm."createdAt", dm."memberId", m.username
       FROM dm_messages dm JOIN members m ON m.id = dm."memberId"
       WHERE dm."threadId" = @t AND (@antes::int IS NULL OR dm.id < @antes::int)
       ORDER BY dm.id DESC LIMIT @lim`,
    )
    .all<{ id: number; body: string; createdAt: string; memberId: number; username: string }>({
      t: threadId,
      antes,
      lim: DM_PAGE_SIZE + 1,
    });
  const desc = rows.slice(0, DM_PAGE_SIZE);
  await markThreadRead(threadId, meId);
  // cursor pras antigas = id da mais velha DESTA página — antes do reverse
  // (desc ainda está DESC aqui, então o último elemento é a mais antiga)
  const mais = rows.length > DM_PAGE_SIZE ? Number(desc[desc.length - 1].id) : null;
  const messages = desc.reverse().map((r) => ({
    id: Number(r.id),
    body: r.body,
    createdAt: r.createdAt,
    mine: Number(r.memberId) === meId,
    authorUsername: r.username,
  }));
  return { messages, mais };
}

/** minhas conversas, pedidos recebidos e pedidos que eu mandei */
export async function listThreads(meId: number): Promise<{
  conversas: ThreadListItem[];
  pedidos: ThreadListItem[];
  enviados: ThreadListItem[];
  unread: number;
}> {
  const rows = await db
    .prepare(
      `SELECT t.id, t.status, t."requestedBy", t."lastMessageAt",
              m.id AS "pId", m.username, m.name, m.avatarUrl,
              (SELECT dm.body FROM dm_messages dm WHERE dm."threadId" = t.id ORDER BY dm.id DESC LIMIT 1) AS "lastBody",
              (SELECT dm."memberId" FROM dm_messages dm WHERE dm."threadId" = t.id ORDER BY dm.id DESC LIMIT 1) AS "lastAuthor",
              (SELECT COUNT(*)::int FROM dm_messages dm WHERE dm."threadId" = t.id AND dm."memberId" <> @me
                 AND dm.id > COALESCE((SELECT r."lastReadId" FROM dm_reads r WHERE r."threadId" = t.id AND r."memberId" = @me), 0)) AS unread
       FROM dm_threads t
       JOIN members m ON m.id = CASE WHEN t."memberId" = @me THEN t."peerId" ELSE t."memberId" END
       WHERE t."memberId" = @me OR t."peerId" = @me
       ORDER BY t."lastMessageAt" DESC NULLS LAST, t.id DESC`,
    )
    .all<{
      id: number;
      status: "aberta" | "pedido" | "recusada";
      requestedBy: number | null;
      lastMessageAt: string | null;
      pId: number;
      username: string;
      name: string | null;
      avatarUrl: string | null;
      lastBody: string | null;
      lastAuthor: number | null;
      unread: number;
    }>({ me: meId });

  const toItem = (r: (typeof rows)[number]): ThreadListItem => ({
    id: Number(r.id),
    status: r.status,
    iRequested: r.requestedBy === meId,
    peer: { id: Number(r.pId), username: r.username, name: r.name, avatarUrl: r.avatarUrl },
    lastBody: r.lastBody,
    lastMine: r.lastAuthor !== null && Number(r.lastAuthor) === meId,
    lastMessageAt: r.lastMessageAt,
    unread: Number(r.unread),
  });
  const conversas = rows.filter((r) => r.status === "aberta").map(toItem);
  const pedidos = rows.filter((r) => r.status === "pedido" && r.requestedBy !== meId).map(toItem);
  const enviados = rows.filter((r) => r.status !== "aberta" && r.requestedBy === meId).map(toItem);
  const unread = rows.reduce((acc, r) => acc + Number(r.unread), 0);
  return { conversas, pedidos, enviados, unread };
}

/** só o número, pro sino do header (GET /api/dm?resumo=1) */
export async function unreadDmCount(meId: number): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM dm_messages dm
       JOIN dm_threads t ON t.id = dm."threadId"
       WHERE (t."memberId" = @me OR t."peerId" = @me) AND dm."memberId" <> @me
         AND dm.id > COALESCE((SELECT rd."lastReadId" FROM dm_reads rd WHERE rd."threadId" = t.id AND rd."memberId" = @me), 0)`,
    )
    .get<{ n: number }>({ me: meId });
  return Number(r?.n ?? 0);
}

/**
 * Quem recebeu o pedido aceita: a conversa abre e quem pediu é avisado.
 * Erros: 404 alheia, 400 não é pedido ou eu mesmo pedi.
 */
export async function acceptRequest(me: { id: number; username: string }, thread: ThreadRow): Promise<void> {
  if (thread.status !== "pedido") throw new DmError("Essa conversa já está aberta.", 400);
  if (thread.requestedBy === me.id) throw new DmError("Quem pediu espera a resposta.", 400);
  await db.prepare(`UPDATE dm_threads SET status = 'aberta' WHERE id = ?`).run(thread.id);
  if (thread.requestedBy !== null) {
    await notify(thread.requestedBy, {
      type: "dm",
      actorId: me.id,
      actorUsername: me.username,
      text: `@${me.username} aceitou conversar com você`,
      href: `/mensagens/${thread.id}`,
    });
  }
}

/** recusa silenciosa: quem pediu não é avisado e espera 30 dias pra repetir */
export async function declineRequest(meId: number, thread: ThreadRow): Promise<void> {
  if (thread.status !== "pedido") throw new DmError("Essa conversa já está aberta.", 400);
  if (thread.requestedBy === meId) throw new DmError("Quem pediu espera a resposta.", 400);
  await db
    .prepare(`UPDATE dm_threads SET status = 'recusada', "declinedAt" = sqlite_now() WHERE id = ?`)
    .run(thread.id);
}

/**
 * O que o botão do /u mostra (a página é server-side; o clique é client).
 * null = escondido (bloqueio, próprio perfil, canNetwork falso).
 */
export async function dmEntryPoint(meId: number, other: { id: number; username: string }): Promise<DmEntry | null> {
  const lock = await canMessage(meId, other.id);
  if (lock.estado === "bloqueado") return null;
  const thread = await threadBetween(meId, other.id);
  if (thread?.status === "aberta") return { mode: "aberta", threadId: thread.id, motivo: lock.motivo };
  if (thread?.status === "pedido") {
    return thread.requestedBy === meId
      ? { mode: "pedido-enviado", threadId: thread.id, motivo: "pedido enviado — espera a resposta" }
      : { mode: "pedido-recebido", threadId: thread.id, motivo: `@${other.username} pediu pra conversar com você` };
  }
  if (lock.estado === "livre") return { mode: "nova-livre", threadId: null, motivo: lock.motivo };
  if (thread?.status === "recusada" && thread.requestedBy === meId && thread.declinedAt) {
    const stillCooling = await db
      .prepare(`SELECT (to_ts(?) > now() - interval '30 days') AS x`)
      .get<{ x: boolean }>(thread.declinedAt);
    if (stillCooling?.x) {
      return { mode: "recusada", threadId: null, motivo: "pedido recusado — espere um tempo antes de pedir de novo" };
    }
  }
  return { mode: "pedido-novo", threadId: thread?.id ?? null, motivo: lock.motivo };
}
