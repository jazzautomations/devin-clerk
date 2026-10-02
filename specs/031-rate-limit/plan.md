# Implementation Plan: Rate Limiting

**Branch**: `031-rate-limit` | **Date**: 2026-12-02 | **Spec**: [spec.md](./spec.md)

## Summary

Sliding window em memória (`lib/ratelimit.ts` novo) aplicado às 9 rotas
públicas/autenticadas de escrita. `rateLimit(key, {limit, windowMs})` puro
e testável com `now` injetável; `limitOrNull(req, bucket, key?, opts?)`
monta a chave (`member.id` quando autenticado, senão IP do
`x-forwarded-for`/`x-real-ip`/`anon`) e devolve `429` + `Retry-After`.
Inserção mínima nas rotas existentes. TDD: unit + API + e2e antes do
código.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: nenhum — `Map` em memória por processo (NÃO edita `lib/db.ts`)
- **Testing**: Vitest (unit puro com `now` injetável + API com auth mockado) + Playwright (spam real via `request`, IP único por run via header)
- **Padrão de dados**: sem tabela — estado processo-local, zera no restart
- **Escopo honesto**: por instância; multi-instância futura pede Redis (Upstash etc.) — documentado, não fingido

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: protege portas públicas e o feed contra spam ✅
- III. Auth: autenticadas limitam por memberId; públicas por IP; 401/404 não consomem quota ✅
- IV. One-session scope: uma lib + inserts mínimos nas rotas ✅
- V. No slop UI: zero UI — contrato de API só ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Algoritmo | sliding window por timestamps em `Map<key, number[]>` | fixed window deixa rajada dobrada na virada; token bucket esconde "quando posso de novo" — sliding dá `retryAfter` exato e é simples |
| Chave autenticada | `member.id` passado pela rota | conta segue o membro (NAT seguro); lib não conhece Clerk — testável puro |
| Chave pública | primeiro hop de `x-forwarded-for` → `x-real-ip` → `anon` | proxy/tunnel setam xff; dev cai no bucket `anon` compartilhado (aceitável, testável) |
| Cleanup | poda na leitura + varredura a cada 60s de atividade | sem `setInterval` (não pendura o processo); Map não cresce indefinido |
| Onde insere | públicas: topo do POST; autenticadas: logo após member existir | 401/403/404 não consomem quota; flood de body inválido conta (públicas) |
| Testabilidade | `now` injetável em `rateLimit`, `opts` por chamada em `limitOrNull`, `resetRateLimits()`/`rateLimitSize()` p/ testes | suíte determinística sem sleep; estado global é isolado por arquivo no vitest, mas beforeEach reseta onde um membro passa do teto |
| Resposta | `429` JSON pt-BR + `Retry-After` | formato único vindo do helper — nenhuma rota inventa o dela |

## Phase 1 — Design

### data-model.md

Sem schema novo — `Map<string, { windowMs, hits: number[] }>` em memória.
Invariantes: hits sempre ordenados (push no fim), pruning na leitura,
chave deletada quando a lista esvazia na varredura.

### contracts/api.md

Sem rota nova — comportamento transversal:

- Todas as 9 rotas ganham no fluxo: `limitOrNull(req, bucket, key?)` →
  se não-null, retorna `429 {error:"muitas requisições — tenta de novo em Ns"}`
  com `Retry-After: N`.
- Ordem garantida: `401/404` (auth, edição, post) e `403` anteriores ao
  member respondem ANTES do limiter — não consomem quota.

### quickstart.md

1. `npm run test` + `npm run test:e2e` verdes
2. `for i in 1..6: curl -X POST localhost:3000/api/leads -d '{...}'` →
   os 5 primeiros 201/200/400, o 6º `429` + `Retry-After`
3. IP diferente (`-H 'x-forwarded-for: 1.2.3.4'`) volta a passar
