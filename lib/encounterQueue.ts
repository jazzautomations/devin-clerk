// Fila offline do encontro — a parte que roda NO APARELHO (e nos testes).
// Sem banco, sem Node: só um array em localStorage, no mesmo padrão do
// offlineCheckin (lib/offlineCheckin.ts).
//
// Ler o código de alguém sem rede guarda a leitura aqui; quando a rede volta,
// a fila sobe em lote pro servidor, que revalida tudo (código, pausa,
// bloqueio, pendentes, janela do evento) e responde item por item. O horário
// do aparelho não decide nada: o que vale é quando o servidor recebeu.

export type QueuedRead = {
  /** código já normalizado (5 caracteres, maiúsculo) */
  code: string;
  /** quando a pessoa leu, ISO — só pra mostrar na tela */
  at: string;
};

export const MAX_QUEUE = 20;

export function isQueuedReads(v: unknown): v is QueuedRead[] {
  return (
    Array.isArray(v) &&
    v.every((x) => !!x && typeof (x as QueuedRead).code === "string" && typeof (x as QueuedRead).at === "string")
  );
}

/** coloca na fila sem duplicar o mesmo código (a leitura repetida não empilha) */
export function enqueueRead(queue: QueuedRead[], item: QueuedRead): QueuedRead[] {
  if (queue.some((q) => q.code === item.code)) return queue;
  return [...queue, item].slice(-MAX_QUEUE);
}

/** tira da fila o que o servidor respondeu (aceito ou recusado: já tem resposta) */
export function applySyncResults(queue: QueuedRead[], answeredCodes: string[]): QueuedRead[] {
  const done = new Set(answeredCodes);
  return queue.filter((q) => !done.has(q.code));
}
