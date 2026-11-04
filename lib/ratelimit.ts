// Rate limiting (spec 031) — sliding window em MEMÓRIA.
//
// Escopo honesto: o estado vive num Map por processo. Vale pro deploy
// single-process de hoje (dev/VPS): zera a cada restart e não é
// compartilhado entre instâncias — quando houver multi-instância, isso
// aqui vira Redis (Upstash etc.), não um Map maior.

export type RateLimitOpts = { limit: number; windowMs: number };
export type RateLimitResult = { ok: boolean; retryAfterSec: number };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1000;

// Tabela única de limites (requisições por janela de 1h). Rotas públicas
// são chaveadas por IP; autenticadas por member.id (a rota passa a key).
export const RATE_LIMITS: Record<string, RateLimitOpts> = {
  leads: { limit: 5, windowMs: HOUR }, // POST /api/leads — ip
  subscribe: { limit: 5, windowMs: HOUR }, // POST /api/subscribe — ip
  submissions: { limit: 5, windowMs: HOUR }, // POST /api/submissions — ip
  posts: { limit: 20, windowMs: HOUR }, // POST /api/posts — membro
  comments: { limit: 30, windowMs: HOUR }, // POST /api/posts/[id]/comments
  votes: { limit: 60, windowMs: HOUR }, // POST /api/projects/[teamId]/vote
  likes: { limit: 60, windowMs: HOUR }, // POST /api/posts/[id]/like
  "post-edit": { limit: 30, windowMs: HOUR }, // PATCH post e comentário (migration 034)
  // repost (migration 049): compartilhar e desfazer dividem o balde. 30/h
  // cobre quem compartilha bastante e freia script repostando tudo
  reposts: { limit: 30, windowMs: HOUR }, // POST/DELETE /api/posts/[id]/repost
  register: { limit: 10, windowMs: HOUR }, // POST /api/hackathons/[id]/register
  team: { limit: 10, windowMs: HOUR }, // POST /api/hackathons/[id]/team
  "team-board": { limit: 10, windowMs: HOUR }, // POST …/[id]/team-board
  applications: { limit: 10, windowMs: HOUR }, // POST/DELETE …/[id]/applications/[kind]
  "application-review": { limit: 300, windowMs: HOUR }, // organizador decide/abre tipos
  // voto ao vivo é editável (nota muda até fechar): folga pra ~10 pitches
  // com troca de nota, mas freia script martelando o endpoint
  "stage-vote": { limit: 120, windowMs: HOUR }, // POST …/[id]/stage/vote
  // denúncia de conduta logada: 3/h por membro
  incidents: { limit: 3, windowMs: HOUR }, // POST …/[id]/incidents
  // denúncia anônima: chave = IP + edição (só em memória, nunca gravada).
  // No evento todo mundo sai pelo mesmo wifi; 3/h por IP barrava a 4ª vítima
  "incidents-anon": { limit: 20, windowMs: HOUR }, // POST …/[id]/incidents
  "image-consent": { limit: 20, windowMs: HOUR }, // POST …/[id]/image-consent
  // comunidades (migration 027): criar é forte (3 por dia por membro), abrir
  // hackathon também (5 por dia); entrar/sair, aviso, convite e denúncia por hora
  communities: { limit: 3, windowMs: DAY }, // POST /api/communities — membro
  "community-hackathons": { limit: 5, windowMs: DAY }, // POST …/communities/[slug]/hackathons
  "community-join": { limit: 30, windowMs: HOUR }, // POST/DELETE …/[slug]/members
  "community-follow": { limit: 30, windowMs: HOUR }, // POST/DELETE …/[slug]/follow
  "community-notices": { limit: 10, windowMs: HOUR }, // POST …/[slug]/notices
  "community-invites": { limit: 20, windowMs: HOUR }, // POST …/[slug]/organizers
  "community-report": { limit: 5, windowMs: HOUR }, // POST …/[slug]/report
  // moderação da própria comunidade (046): aviso, membro, ban, excluir e
  // transferir dividem o balde; 120/h cobre uma faxina e freia script
  "community-moderation": { limit: 120, windowMs: HOUR }, // PATCH/DELETE …/[slug]/notices/[noticeId], DELETE …/[slug]/members/[username], DELETE …/[slug], POST …/[slug]/transfer
  // apoiadores (028): cadastrar, ordenar e remover contam no mesmo balde
  "community-supporters": { limit: 60, windowMs: HOUR }, // POST/PATCH/DELETE …/[slug]/supporters
  // entrega do projeto (spec 034): autosave dispara 1,2 s depois de cada pausa
  // na digitação. 3600/h = um save por segundo a hora inteira, acima do que
  // uma pessoa digitando gera; só segura script. Enviar versão é raro, puxa o
  // GitHub (dossiê) e grava o rascunho pendente no próprio bucket, então
  // estourar o autosave não impede o envio
  "entry-draft": { limit: 3600, windowMs: HOUR }, // PATCH …/[id]/entry — membro
  "entry-submit": { limit: 20, windowMs: HOUR }, // POST …/[id]/entry — membro
  // bloqueio e denúncia (migration 032): bloquear e silenciar (e desfazer)
  // dividem o balde; denúncia segue o padrão de community-report
  blocks: { limit: 30, windowMs: HOUR }, // POST/DELETE /api/members/[username]/block e /mute
  reports: { limit: 5, windowMs: HOUR }, // POST /api/reports — membro
  // seguir pessoa (migration 033): seguir e deixar de seguir no mesmo balde
  "member-follows": { limit: 60, windowMs: HOUR }, // POST/DELETE /api/members/[username]/follow
  // busca global (migration 042): /api/search e a página /busca dividem o balde
  search: { limit: 120, windowMs: HOUR }, // GET /api/search — membro
  // timeline (migration 038): leitura barata, mas o TimelineList pede a cada
  // 60s pra checar post novo — 600/h cobre uma aba aberta o dia inteiro
  feed: { limit: 600, windowMs: HOUR }, // GET /api/feed — membro
  // autocomplete de @ (migration 039): uma consulta a cada 200ms de pausa na
  // digitação; 120/h cobre quem escreve bastante e freia script
  suggest: { limit: 120, windowMs: HOUR }, // GET /api/members/suggest — membro
  // depoimento de time (migration 037): escrever é forte (5 por dia por
  // membro); editar, apagar, aceitar, recusar e esconder dividem um balde por hora
  testimonials: { limit: 5, windowMs: DAY }, // POST /api/testimonials — membro
  // liga do semestre (migration 054): o toggle do opt-in é um clique, não um
  // botão de refresh; 30/h cobre indecisão e freia script
  liga: { limit: 30, windowMs: HOUR }, // PATCH /api/me/liga — membro
  "testimonial-actions": { limit: 60, windowMs: HOUR }, // PATCH/DELETE …/[id] e accept/decline/hide
  // bicho (migration 043): salvar o config do criador
  mascote: { limit: 30, windowMs: HOUR }, // PUT /api/members/me/mascote — membro
  // dossiê (migration 029): botão "atualizar" do organizador consulta o GitHub
  "dossie-refresh": { limit: 30, windowMs: HOUR }, // POST …/admin/…/dossie/[teamId]
  // preferências de notificação (migration 040): cada toggle é um PATCH
  "notification-prefs": { limit: 60, windowMs: HOUR }, // PATCH /api/notifications/preferencias
  // agenda da comunidade (migration 051): criar e editar evento, por membro
  meetups: { limit: 10, windowMs: DAY }, // POST /api/meetups, PATCH /api/meetups/[id]
  // desafio aberto (migration 053): criar é forte como criar comunidade
  "open-challenges": { limit: 3, windowMs: DAY }, // POST /api/open-challenges — membro
  // tópicos da comunidade (migration 058): abrir, responder e votar (voto em
  // tópico, em resposta e em enquete dividem o balde); editar e apagar o
  // próprio ou moderar caem em topic-edit
  "topic-create": { limit: 10, windowMs: HOUR }, // POST …/communities/[slug]/topics
  "topic-reply": { limit: 60, windowMs: HOUR }, // POST /api/topics/[id]/replies
  "topic-vote": { limit: 300, windowMs: HOUR }, // POST /api/topics/[id]/vote, …/replies/[replyId]/vote, …/poll
  "topic-edit": { limit: 60, windowMs: HOUR }, // PATCH/DELETE tópico e resposta, aceitar resposta
  // recado no perfil (migration 041): 10 por hora e 1 por minuto pra mesma
  // pessoa (a chave do segundo é autor:perfil). O mesmo texto pra mais de 5
  // perfis em 1 h é barrado em lib/recados.ts, que olha o banco.
  recados: { limit: 10, windowMs: HOUR }, // POST /api/members/[username]/recados
  "recado-target": { limit: 1, windowMs: MINUTE }, // idem, mesma pessoa
  // diário do projeto (migration 044): atualização é mais rara que post do
  // feed (o time conta o que mudou, não conversa). Seguir projeto divide o
  // balde do seguir pessoa (member-follows)
  "project-updates": { limit: 10, windowMs: DAY }, // POST …/projects/[teamId]/updates
  // vagas de time (migration 045): abrir vaga, candidatar, aceitar/recusar e
  // o "bora fazer junto" dividem o balde. 20/h cobre um time fechando o time
  // no meio do evento e freia script martelando convite
  openings: { limit: 20, windowMs: HOUR }, // POST /api/openings, …/[id]/applications, /api/team-up
  // encontros na edição (migration 050): ler código, confirmar, recusar,
  // responder "como foi" e apresentar dividem o balde. 30/h cobre um dia de
  // evento inteiro e freia script varrendo códigos
  encounters: { limit: 30, windowMs: HOUR }, // POST …/[id]/encounters e …/encounters/**
  // 4 semanas depois (migration 052): abrir, entrar e encerrar dividem o
  // balde. 30/h cobre o organizador e os times do mesmo escritório
  "follow-through": { limit: 30, windowMs: HOUR }, // POST …/hackathons/[id]/quatro-semanas[/teams|/close]
  // DM com trava (migration 056): mensagem em conversa aberta é fluida
  // (120/h cobre um papo de evento inteiro); pedido de conversa é forte —
  // 5/dia segura spam frio sem estrangular quem conheceu gente no dia
  dm: { limit: 120, windowMs: HOUR }, // POST /api/dm e …/[id]/messages — membro
  "dm-requests": { limit: 5, windowMs: DAY }, // pedido de conversa — membro
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
    { error: `muitas requisições. Tente de novo em ${r.retryAfterSec}s.` },
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
