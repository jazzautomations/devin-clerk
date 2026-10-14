<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# HackaHub

A plataforma onde a **Hack Inova** organiza as edições dela (inscrição, avisos,
check-in, júri, certificado) e a
rede/vitrine dos hackathons no Brasil. Produto e escopo: `specs/000-prd.md` e
`specs/033-hackinova-ops/spec.md` (a spec vigente). Copy e UI em PT-BR, tom
direto, sem emoji na UI. Copy fala do que o HackaHub faz, nunca contra
ferramenta ou pessoa (nada de "sem Forms"/"sem grupo de zap").

Stack: Next.js 16 (App Router, `proxy.ts` no lugar de middleware), React 19,
Tailwind v4, Clerk, Postgres.

## Comandos

- `npm run lint` · `npm run typecheck` · `npm run build`
- `npm test` — Vitest (unit + API). Sem `DATABASE_URL` usa PGlite em memória
  (Postgres real em WASM, banco limpo por arquivo de teste).
- `npm run test:e2e` — Playwright contra `next start` buildado. Precisa de
  `E2E_DATABASE_URL` (banco cujo nome contém `e2e`; o `pretest:e2e` zera ele)
  e aceita `E2E_PORT` (default 3100).
- `npm run seed:demo` — comunidade de mentira pra dev (nunca em produção).

Gate de merge: lint, typecheck, build, vitest e e2e verdes; 390px sem scroll
horizontal nas rotas novas.

## Dados (`lib/db.ts`)

- `db.prepare(sql).get/all/run(...)`, `db.exec`, `db.transaction(fn)` — tudo
  **async** (`await`). `get<T>()`/`all<T>()` aceitam o tipo da linha.
- SQL no estilo do código existente: `?` posicional ou `@nome` com objeto;
  identificadores camelCase sem aspas (a camada cita); `INSERT OR IGNORE` e
  `datetime('now')` são traduzidos. Postgres de verdade por baixo: `GROUP BY`
  estrito, `EXISTS(...)` devolve boolean, parâmetro em contexto sem tipo
  (`? IS NULL`) precisa de cast (`?::text IS NULL`).
- Schema **só** em `migrations/NNN_*.sql` (aplicadas no boot, em ordem, com
  lock). Nunca `CREATE`/`ALTER` em módulo de lib nem em teste. Identificadores
  camelCase entre aspas na migration. Datas são TEXT `YYYY-MM-DD HH:MM:SS`
  UTC (`DEFAULT sqlite_now()`); `to_ts(text)` compara datas.
- `lib/seed.ts` = dados de base idempotentes (edições Hack Inova).
- Nada de `.map(async …)` solto: `await Promise.all(...)`. Nada de busca de
  dado dentro do JSX: calcule antes do `return`.

## Auth e papéis

- `proxy.ts` protege `/dashboard`, `/perfil`, `/admin`. API de membro devolve
  `401 {"error":"Unauthorized"}` deslogado (nunca redirect).
- `lib/session.ts` → `currentMember()`. `auth()` sempre com `await`;
  `firstName` pode ser `null`.
- Admin global: `members.role = 'admin'`, vem de `HACKAHUB_ADMIN_EMAILS`.
- Papéis por edição (`lib/roles.ts`): organizador, staff, mentor, jurado.
  `hasEditionRole(member, hackathonId, role)` — admin e organizador valem
  por todos. Convite por e-mail (`inviteToEdition`).
- Painel da edição: `/admin/h/[id]` (layout com abas por papel). Feature de
  operação de evento ganha aba própria em `/admin/h/[id]/<aba>`.

## UI

Sistema visual da Hack Inova (`app/globals.css`): papel `#fefefe`, tinta
`#0c0c0c`, verde de ação `#047a43`, menta `#d8f4e5`, laranja de foco/erro
`#ba3919`; Archivo nos títulos, JetBrains Mono em dados/labels, VT323 (`.pix`)
só como acento. Fios de 1–1.5px, raio 0 (6px em botão/campo), sem gradiente,
sem glow. Use os tokens (`bg-background`, `text-muted`, `border-line`,
`text-accent`) e as classes existentes (`.window`, `.tbar`, `.btn`, `.chip`,
`.tag`). Componente client só quando precisa de interação.

## Ambiente de desenvolvimento

O notebook do dono é lento; build e testes rodam na VPS
`ssh ubuntu@64.181.217.112`, cada um numa pasta própria (`~/hackahub-*`).
Na mesma máquina rodam outros produtos (asyn-settlement, cachorro, oneiro,
pocketful): **não toque** em serviços, containers, Caddy, systemd ou pastas
que não sejam a sua. Builds com `nice -n 10`. Segredos de dev ficam em
`~/hackahub-secrets` (nunca imprimir, nunca commitar `.env*`/`.clerk/`).

## Commits

Mensagem em PT-BR focada no porquê. Sem push.
