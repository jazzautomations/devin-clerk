import { getStageSnapshot, snapshotKey, type StageSnapshot } from "@/lib/stage";

// Repartidor do SSE do palco. Com 300 celulares abertos em /votar, cada
// conexão consultando o banco a cada segundo seriam 300 queries/s; aqui é
// UMA consulta por segundo por edição, repartida entre quem está ouvindo.
// Não é estado do palco (esse está todo no banco): é só a lista de quem
// está conectado neste processo. Restart derruba as conexões, o
// EventSource reconecta sozinho e recebe o snapshot atual do banco.
//
// Auditoria 041 (pacote D):
// - quem conecta num canal que já tem snapshot recebe esse, sem ir ao banco
//   (reconexão em massa depois de um deploy não vira 300 consultas);
// - o primeiro snapshot enviado na conexão já marca a chave do canal, então
//   o primeiro tick não reenvia o mesmo snapshot;
// - voto e ação do controle pedem leitura com `nudgeStage`, mas as leituras
//   são agrupadas: no máximo uma a cada STAGE_COALESCE_MS por edição;
// - conexões abertas têm teto por IP e no total (429 acima disso).

type Listener = (snap: StageSnapshot) => void;

type Channel = {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  lastKey: string | null;
  last: StageSnapshot | null;
  /** quando `last` foi lido (ms, relógio do processo) */
  lastAt: number;
  busy: boolean;
  /** leitura pedida por nudge, esperando a janela de agrupamento */
  nudge: ReturnType<typeof setTimeout> | null;
  lastRun: number;
};

export const STAGE_POLL_MS = 1000;
export const STAGE_COALESCE_MS = 750;

/**
 * Teto de conexões SSE abertas neste processo. O por IP é alto de propósito:
 * no evento, a plateia inteira pode estar no wi-fi do local, atrás de um IP
 * só. O total protege o processo (file descriptors e memória).
 * Sem proxy na frente (dev/e2e) o IP vira "anon" e só o total vale.
 */
export const stageLimits = { perIp: 200, total: 2000 };

const channels = new Map<string, Channel>();
const openByIp = new Map<string, number>();
let openTotal = 0;

/**
 * Reserva uma vaga de conexão. Devolve a função que libera (idempotente) ou
 * null quando passou do teto.
 */
export function acquireStageSlot(ip: string): (() => void) | null {
  const mine = openByIp.get(ip) ?? 0;
  if (openTotal >= stageLimits.total) return null;
  if (ip !== "anon" && mine >= stageLimits.perIp) return null;
  openByIp.set(ip, mine + 1);
  openTotal++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openTotal--;
    const n = (openByIp.get(ip) ?? 1) - 1;
    if (n <= 0) openByIp.delete(ip);
    else openByIp.set(ip, n);
  };
}

async function tick(hackathonId: string, ch: Channel) {
  if (ch.busy) return; // consulta anterior ainda não voltou: pula, não empilha
  ch.busy = true;
  ch.lastRun = Date.now();
  try {
    const snap = await getStageSnapshot(hackathonId);
    const key = snapshotKey(snap);
    ch.last = snap;
    ch.lastAt = Date.now();
    if (key !== ch.lastKey) {
      ch.lastKey = key;
      for (const l of ch.listeners) l(snap);
    }
  } catch (e) {
    console.error("[stage-stream] falha ao ler o palco", hackathonId, e);
  } finally {
    ch.busy = false;
  }
}

/** assina as mudanças do palco; devolve a função de cancelar */
export function subscribeStage(hackathonId: string, listener: Listener): () => void {
  let ch = channels.get(hackathonId);
  if (!ch) {
    ch = {
      listeners: new Set(),
      timer: null,
      lastKey: null,
      last: null,
      lastAt: 0,
      busy: false,
      nudge: null,
      lastRun: 0,
    };
    channels.set(hackathonId, ch);
  }
  const channel = ch;
  channel.listeners.add(listener);
  if (!channel.timer) {
    channel.timer = setInterval(() => void tick(hackathonId, channel), STAGE_POLL_MS);
  }
  return () => {
    channel.listeners.delete(listener);
    if (channel.listeners.size === 0) {
      if (channel.timer) clearInterval(channel.timer);
      if (channel.nudge) clearTimeout(channel.nudge);
      channels.delete(hackathonId);
    }
  };
}

/**
 * Snapshot pra mandar a quem acabou de conectar: o último do canal, com o
 * cronômetro avançado até agora; sem nenhum ainda, lê do banco e já marca a
 * chave do canal (o primeiro tick não repete o mesmo snapshot).
 */
export async function initialStage(hackathonId: string, now = Date.now()): Promise<StageSnapshot> {
  const ch = channels.get(hackathonId);
  if (ch?.last) {
    const snap = ch.last;
    const drift = Math.max(0, now - ch.lastAt);
    return {
      ...snap,
      serverNow: new Date(now).toISOString(),
      timer: snap.timer.running
        ? { ...snap.timer, elapsedMs: snap.timer.elapsedMs + drift, remainingMs: snap.timer.remainingMs - drift }
        : snap.timer,
    };
  }
  const snap = await getStageSnapshot(hackathonId);
  const live = channels.get(hackathonId);
  if (live && live.lastKey === null) {
    live.last = snap;
    live.lastAt = Date.now();
    live.lastKey = snapshotKey(snap);
  }
  return snap;
}

/**
 * Pede uma leitura (depois de um voto ou ação do controle). Leituras pedidas
 * em sequência viram uma só, no máximo uma a cada STAGE_COALESCE_MS.
 */
export function nudgeStage(hackathonId: string): void {
  const ch = channels.get(hackathonId);
  if (!ch || ch.nudge) return;
  const wait = Math.max(0, ch.lastRun + STAGE_COALESCE_MS - Date.now());
  ch.nudge = setTimeout(() => {
    ch.nudge = null;
    void tick(hackathonId, ch);
  }, wait);
}

// ——— só testes ———
export function stageChannelCount(): number {
  return channels.size;
}

export function stageOpenConnections(): number {
  return openTotal;
}
