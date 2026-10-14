import { getStageSnapshot, snapshotKey, type StageSnapshot } from "@/lib/stage";

// Repartidor do SSE do palco. Com 300 celulares abertos em /votar, cada
// conexão consultando o banco a cada segundo seriam 300 queries/s; aqui é
// UMA consulta por segundo por edição, repartida entre quem está ouvindo.
// Não é estado do palco (esse está todo no banco): é só a lista de quem
// está conectado neste processo. Restart derruba as conexões, o
// EventSource reconecta sozinho e recebe o snapshot atual do banco.

type Listener = (snap: StageSnapshot) => void;

type Channel = {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  lastKey: string | null;
  last: StageSnapshot | null;
  busy: boolean;
};

export const STAGE_POLL_MS = 1000;

const channels = new Map<string, Channel>();

async function tick(hackathonId: string, ch: Channel) {
  if (ch.busy) return; // consulta anterior ainda não voltou: pula, não empilha
  ch.busy = true;
  try {
    const snap = await getStageSnapshot(hackathonId);
    const key = snapshotKey(snap);
    ch.last = snap;
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
    ch = { listeners: new Set(), timer: null, lastKey: null, last: null, busy: false };
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
      channels.delete(hackathonId);
    }
  };
}

/** força uma leitura já (depois de uma ação do controle), sem esperar o próximo tick */
export function nudgeStage(hackathonId: string): void {
  const ch = channels.get(hackathonId);
  if (ch) void tick(hackathonId, ch);
}

// ——— só testes ———
export function stageChannelCount(): number {
  return channels.size;
}
