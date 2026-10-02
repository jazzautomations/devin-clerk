// Rate limiting (spec 031) — sliding window em MEMÓRIA.
//
// Escopo honesto: o estado vive num Map por processo. Vale pro deploy
// single-process de hoje (dev/VPS): zera a cada restart e não é
// compartilhado entre instâncias — quando houver multi-instância, isso
// aqui vira Redis (Upstash etc.), não um Map maior.

export type RateLimitOpts = { limit: number; windowMs: number };
export type RateLimitResult = { ok: boolean; retryAfterSec: number };

const HOUR = 60 * 60 * 1000;

// Tabela única de limites (requisições por janela de 1h). Rotas públicas
// são chaveadas por IP; autenticadas por member.id (a rota passa a key).
export const RATE_LIMITS: Record<string, RateLimitOpts> = {
  leads: { limit: 5, windowMs: HOUR }, // POST /api/leads — ip
  submissions: { limit: 5, windowMs: HOUR }, // POST /api/submissions — ip
  posts: { limit: 20, windowMs: HOUR }, // POST /api/posts — membro
  comments: { limit: 30, windowMs: HOUR }, // POST /api/posts/[id]/comments
  votes: { limit: 60, windowMs: HOUR }, // POST /api/projects/[teamId]/vote
  likes: { limit: 60, windowMs: HOUR }, // POST /api/posts/[id]/like
  register: { limit: 10, windowMs: HOUR }, // POST /api/hackathons/[id]/register
  team: { limit: 10, windowMs: HOUR }, // POST /api/hackathons/[id]/team
  "team-board": { limit: 10, windowMs: HOUR }, // POST …/[id]/team-board
};

const FALLBACK: RateLimitOpts = { limit: 60, windowMs: HOUR };

type Entry = { windowMs: number; hits: number[] };
const store = new Map<string, Entry>();

// Varredura preguiçosa: poda na leitura já basta pra chave ativa; a cada
// ~60s de atividade uma passada remove chaves cujas janelas venceram —
// assim o Map não cresce com chaves mortas. Sem setInterval: nada fica
// pendurado segurando o processo.
const SWEEP_MS = 60_000;
let lastSweep = 0;

function sweep(now: number): void {
  lastSweep = now;
  for (const [key, e] of store) {
    const live = e.hits.filter((t) => now - t < e.windowMs);
    if (live.length) {
      e.hits = live;
    } else {
      store.delete(key);
    }
  }
}

// Sliding window: guarda um timestamp por hit admitido; hits fora da
// janela são descartados a cada chamada. Estourou → `retryAfterSec` é o
// tempo até o hit mais antigo sair da janela (mínimo 1s). Hits negados
// NÃO entram na lista — não estendem a própria punição.
export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOpts,
  now = Date.now(),
): RateLimitResult {
  if (now - lastSweep >= SWEEP_MS) {
    sweep(now);
  }
  const e = store.get(key) ?? { windowMs, hits: [] };
  e.windowMs = windowMs;
  const live = e.hits.filter((t) => now - t < windowMs);
  if (live.length >= limit) {
    store.set(key, { windowMs, hits: live });
    const retryAfterSec = Math.max(
      1,
      Math.ceil((live[0] + windowMs - now) / 1000),
    );
    return { ok: false, retryAfterSec };
  }
  live.push(now);
  store.set(key, { windowMs, hits: live });
  return { ok: true, retryAfterSec: 0 };
}

// Origem da chave em rota pública: primeiro hop do x-forwarded-for (o
// proxy/tunnel escreve ele), senão x-real-ip, senão 'anon' — dev sem
// proxy divide o bucket anon, aceitável e testável.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) {
    return xff;
  }
  return req.headers.get("x-real-ip")?.trim() || "anon";
}

// Uso nas rotas: `const limited = limitOrNull(req, "leads"); if (limited)
// return limited;` — null = passa, Response = 429 pronto. `key` é o
// member.id nas autenticadas; ausente cai pro IP.
export function limitOrNull(
  req: Request,
  bucket: string,
  key?: string | number | null,
  opts?: RateLimitOpts,
): Response | null {
  const k = key == null ? clientIp(req) : String(key);
  const o = opts ?? RATE_LIMITS[bucket] ?? FALLBACK;
  const r = rateLimit(`${bucket}:${k}`, o);
  if (r.ok) {
    return null;
  }
  return Response.json(
    { error: `muitas requisições — tenta de novo em ${r.retryAfterSec}s` },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}

// ——— só testes ———
// Estado global sobrevive entre casos dentro do mesmo arquivo; os testes
// chamam resetRateLimits no beforeEach. Não usar em código de produção.
export function resetRateLimits(): void {
  store.clear();
  lastSweep = 0;
}

export function rateLimitSize(): number {
  return store.size;
}
