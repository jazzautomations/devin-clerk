# Implementation Plan: Empresas — porta comercial, leads e legal

**Branch**: `022-empresas-leads` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

`/empresas` vira a porta comercial pública: hero "sua marca na frente de quem
constrói", oferta em 3 itens (desafio patrocinado com exemplos reais — Oracle
na PUC, prêmio R$5k na Unifacens — presença no radar/arquivo, talento), stats
reais do banco e formulário de lead. `lib/leads.ts` cria a tabela `leads` com
schema idempotente no próprio módulo (pattern `lib/deploys.ts`, sem tocar
`lib/db.ts`), validando empresa/e-mail/interesse-whitelist e deduplicando por
(empresa, e-mail) numa janela de 10 min. `POST /api/leads` é público com
honeypot `website` (201 silencioso) e dedupe (200 idempotente). `/admin` ganha
seção "// leads". `/legal/termos` + `/legal/privacidade` cobrem a LGPD básica.
Sitemap ganha as 3 rotas; a linha comercial da landing passa a apontar pra
`/empresas`. TDD: testes falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — intacto; schema próprio no import de
  `lib/leads.ts` (pattern 008-deploys / 019-sponsors)
- **Testing**: Vitest (unit+API, `HACKAHUB_DB=:memory:`) + Playwright
  (BDD público; `/api/leads` é público então POST vai direto via request)
- **Padrão de dados**: `lib/leads.ts` novo; `createdAt` ISO via
  `new Date().toISOString()` pra janela de dedupe comparável lexicograficamente

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: participante nunca paga; a porta é pra marca, leitura
  pública, nada muda pra membro ✅
- III. Auth: `/api/leads` é público por desenho (é a porta de vendas);
  leitura de leads só no `/admin` já protegido por middleware + role ✅
- IV. One-session scope: uma lib + uma rota + três páginas + seção admin ✅
- V. No slop UI: mesma linguagem visual (mono `//`, border-line, acento,
  lendário só na ênfase de prêmio) ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Schema | `lib/leads.ts` com `CREATE TABLE IF NOT EXISTS leads` | Pattern 008/019; `lib/db.ts` não é tocado |
| Interest | Whitelist `desafio`/`edicao`/`talento`/`outro` | Select fechado; "outro" + `message` cobre o resto |
| Dedupe | `(lower(email), lower(company))` com `createdAt > now-10min` → retorna existente | Retry/duplo clique não duplica; janela curta não bloqueia contato legítimo futuro |
| Honeypot | Campo `website` hidden; preenchido → 201 sem gravar | Mesmo trap do `/api/subscribe` — resposta indistinguível |
| `createdAt` | `new Date().toISOString()` na inserção | Comparação lexicográfica correta com cutoff ISO (datetime('now') usa espaço e quebraria o `>`) |
| Auth | Nenhuma no POST — porta pública | A venda não pode depender de login; a lista vive atrás do `/admin` |
| Legal | Páginas estáticas `/legal/termos` + `/legal/privacidade`, linkadas no fim de `/empresas` | Não existe footer global; Header não muda |
| Metadata | `generateMetadata` em `/empresas` (canonical); `metadata` estático nas legais | Spec pede generateMetadata na página comercial |

## Phase 1 — Design

### data-model.md

```sql
leads: id INTEGER PK AUTOINCREMENT, company TEXT NOT NULL,
  email TEXT NOT NULL, interest TEXT NOT NULL
    CHECK (interest IN ('desafio','edicao','talento','outro')),
  message TEXT, createdAt TEXT NOT NULL
-- + INDEX idx_leads_recent ON leads(email, company, createdAt)
```

`createLead(input)` → `{ lead, created }`: valida → dedupe (SELECT recent)
→ INSERT. `listLeads()` → desc por `createdAt`/`id`, LIMIT 200.

### API

- `POST /api/leads` — `{company, email, interest, message?, website?}`:
  `website` truthy → **201 `{ok:true}` sem gravar**; inválido → 400;
  dedupe → 200 `{lead, deduped:true}`; criado → 201 `{lead}`

### Render

- `/empresas`: `// para empresas` + hero + stats grid (mesmo `dl` da landing)
  + 3 cards de oferta (grid `gap-px border-line` como os pilares) + exemplos
  reais com prêmio em `text-lendario` + `LeadForm` (client) + links legais
- `LeadForm`: client component estilo `NewsletterForm` — empresa, e-mail,
  select de interesse, textarea opcional, honeypot `website` hidden,
  POST fetch → estado done/error
- `/admin`: seção `// leads` após o grid newsletter/membros — lista desc
- `/legal/*`: `section` max-w-3xl com `// legal` + heading + parágrafos

### Rotas públicas

`/empresas`, `/legal/*` e `/api/leads` não entram no matcher de
`proxy.ts` (só dashboard/perfil/admin são protegidos) — nada a mudar lá.
