// Check-in offline — a parte que roda NO APARELHO do staff (e nos testes).
// Sem banco, sem node:crypto: só Web Crypto (globalThis.crypto.subtle), que
// existe no navegador em contexto seguro (HTTPS/localhost) e no Node 20+.
//
// O pacote (lib/checkinPack.ts monta no servidor) traz, por inscrição da
// edição, o SHA-256 do token do QR — nunca o token, nunca o segredo HMAC,
// nunca e-mail. Ler o QR offline = calcular o SHA-256 do texto lido e achar
// no pacote. Check-in local vai pra uma fila (uma entrada por inscrição, o
// horário mais cedo vence) e sobe em lote quando a rede volta.

export type PackStatus = "approved" | "pending" | "rejected" | "waitlist";

export type PackEntry = {
  /** SHA-256 base64url do token do QR */
  h: string;
  rid: number;
  name: string;
  username: string;
  status: PackStatus;
  /** check-in já registrado no servidor quando o pacote foi gerado */
  at: string | null;
};

export type OfflinePack = {
  v: 1;
  hackathonId: string;
  issuedAt: string;
  /** janela da edição em ISO: o servidor limita o horário do check-in a ela */
  window: { start: string; end: string };
  entries: PackEntry[];
  /** HMAC do servidor sobre o resto do pacote (prova de origem; o aparelho não verifica) */
  sig: string;
};

export type QueuedCheckin = {
  rid: number;
  /** token lido do QR (o servidor revalida o HMAC); ausente na busca manual */
  token?: string;
  /** horário real da leitura, ISO */
  at: string;
};

const TOKEN_RE = /^HH1\.[A-Za-z0-9_-]{43}$/;

export function looksLikeTicket(text: string): boolean {
  return TOKEN_RE.test(text);
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64url(new Uint8Array(digest));
}

export function isOfflinePack(v: unknown): v is OfflinePack {
  const p = v as OfflinePack | null;
  return (
    !!p &&
    p.v === 1 &&
    typeof p.hackathonId === "string" &&
    typeof p.issuedAt === "string" &&
    typeof p.sig === "string" &&
    Array.isArray(p.entries) &&
    !!p.window &&
    typeof p.window.start === "string"
  );
}

export type LocalResult =
  | { kind: "ok"; entry: PackEntry; at: string }
  | { kind: "already"; entry: PackEntry; at: string }
  | { kind: "blocked"; entry: PackEntry }
  | { kind: "unknown" }
  | { kind: "invalid" };

/** quando a pessoa entrou, olhando servidor (pacote) e fila local — o mais cedo */
export function localCheckedInAt(entry: PackEntry, queue: QueuedCheckin[]): string | null {
  const q = queue.find((x) => x.rid === entry.rid)?.at ?? null;
  const s = entry.at ? new Date(entry.at.replace(" ", "T") + "Z").toISOString() : null;
  if (q && s) return q < s ? q : s;
  return q ?? s;
}

/** coloca na fila sem duplicar: mesma inscrição duas vezes fica com o horário mais cedo */
export function enqueue(queue: QueuedCheckin[], item: QueuedCheckin): QueuedCheckin[] {
  const i = queue.findIndex((x) => x.rid === item.rid);
  if (i === -1) return [...queue, item];
  const cur = queue[i];
  const next = item.at < cur.at ? { ...cur, ...item } : { ...cur, token: cur.token ?? item.token };
  return queue.map((x, j) => (j === i ? next : x));
}

/**
 * Check-in sem rede. by = texto lido do QR ou a inscrição escolhida na busca
 * manual. Devolve o resultado e a fila nova (igual à antiga quando nada muda).
 */
export async function checkInOffline(
  pack: OfflinePack,
  queue: QueuedCheckin[],
  by: { token: string } | { rid: number },
  now: Date = new Date(),
): Promise<{ result: LocalResult; queue: QueuedCheckin[] }> {
  let entry: PackEntry | undefined;
  let token: string | undefined;
  if ("token" in by) {
    token = by.token.trim();
    if (!looksLikeTicket(token)) return { result: { kind: "invalid" }, queue };
    const h = await hashToken(token);
    entry = pack.entries.find((e) => e.h === h);
  } else {
    entry = pack.entries.find((e) => e.rid === by.rid);
  }
  if (!entry) return { result: { kind: "unknown" }, queue };
  if (entry.status !== "approved") return { result: { kind: "blocked", entry }, queue };
  const already = localCheckedInAt(entry, queue);
  if (already) return { result: { kind: "already", entry, at: already }, queue };
  const at = now.toISOString();
  return {
    result: { kind: "ok", entry, at },
    queue: enqueue(queue, token ? { rid: entry.rid, token, at } : { rid: entry.rid, at }),
  };
}

export type SyncItemResult =
  | { rid: number; ok: true; outcome: "created" | "earlier" | "already"; at: string }
  | { rid: number | null; ok: false; reason: string };

/**
 * Resposta do sync → fila que sobra. Tudo que o servidor respondeu sai da
 * fila (sucesso ou recusa definitiva: inscrição recusada, ingresso de outra
 * edição); só fica o que não veio na resposta.
 */
export function applySyncResults(
  queue: QueuedCheckin[],
  sent: QueuedCheckin[],
  results: SyncItemResult[],
): QueuedCheckin[] {
  const answered = new Set<number>();
  results.forEach((r, i) => {
    const rid = r.rid ?? sent[i]?.rid;
    if (typeof rid === "number") answered.add(rid);
  });
  return queue.filter((q) => !answered.has(q.rid));
}

/** aplica no pacote local o que o servidor confirmou (horário final de cada um) */
export function mergeIntoPack(pack: OfflinePack, results: SyncItemResult[]): OfflinePack {
  const at = new Map<number, string>();
  for (const r of results) if (r.ok) at.set(r.rid, r.at);
  if (at.size === 0) return pack;
  return {
    ...pack,
    entries: pack.entries.map((e) => (at.has(e.rid) ? { ...e, at: at.get(e.rid)! } : e)),
  };
}
