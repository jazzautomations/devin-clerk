# Implementation Plan: Indicação de Hackathon pela Comunidade

**Branch**: `026-event-submission` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

## Summary

O radar ganha o terceiro canal: indicação pública → fila de curadoria →
publicação. `lib/submissions.ts` cria `event_submissions` com schema
idempotente no próprio módulo (pattern `lib/leads.ts`, sem tocar
`lib/db.ts`), valida `name`/`url` http(s)/whitelist de `format` e
deduplica por `url` em 24h. `POST /api/submissions` é público com
honeypot `company` (201 silencioso); `GET` é admin-only. A curadoria
roda em `POST /api/admin/submissions/[id]` com `action=approve|reject`
— approve insere em `hackathons` com id slugificado de nome+ano
(sufixo numérico em conflito), `source='comunidade'`, `organizer` da
nota ou 'comunidade'. UI: `<details>` "// indica um hackathon" no fim
do `/radar` (SubmitEventForm client) e seção "// indicações" apensa no
fim do `/admin` (SubmissionActions client). TDD: testes falhando antes.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — intacto; schema próprio no
  import de `lib/submissions.ts` (pattern 008/019/022)
- **Testing**: Vitest (unit+API, `HACKAHUB_DB=:memory:`, Clerk mockado
  por arquivo — um arquivo por papel: admin / member / público) +
  Playwright (radar público + guards anon)
- **Dedupe**: `createdAt` ISO (`new Date().toISOString()`) pra cutoff
  lexicográfico (datetime('now') usa espaço e quebraria `>`)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: a comunidade alimenta o radar; participante
  nunca paga ✅
- III. Auth: escrita pública por desenho (a porta não exige login);
  leitura/curadoria atrás de auth + role admin ✅
- IV. One-session scope: uma lib + duas rotas + dois client components +
  dois pontos de encaixe (radar/admin) ✅
- V. No slop UI: mesma linguagem (mono `//`, border-line, details
  discreto no fim da página, nada de dashboard novo) ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Schema | `event_submissions` em `lib/submissions.ts` | Pattern leads/deploys; `lib/db.ts` é trabalho paralelo |
| Honeypot | campo `company` (o form nunca pergunta empresa) | Trap de bot análogo ao `website` do /api/leads |
| Dedupe | `lower(url)` + `createdAt > now-24h`, qualquer status | Retry/duplo clique não duplica; janela curta não bloqueia re-indicação futura |
| `format` | default `online`, whitelist = CHECK do hackathons | Select fecha a entrada; default cobre quem não sabe |
| `startsAt` | nullable na submissão; parseável quando presente; sentinela `2099-12-31` no approve | Quem indica pode não saber a data; hackathons.startsAt é NOT NULL |
| organizer | `org: <nome>` na nota, senão 'comunidade' | Convenção leve e testável; admin edita depois |
| slug | `slugify(name)` + `-YYYY` (se houver data) + `-2…` em conflito | Mesma forma dos ids semeados (`hack-inova-…-2026`); port do slugify do scraper (60 chars) |
| revisão | terminal e idempotente — já revisada → 200 no-op | Re-aprovar não duplica hackathon |
| fila | `listPendingSubmissions` ASC (FIFO) | Curadoria atende primeiro o que espera mais |
| UI pública | `<details>` no fim do `/radar`, não rota `/indicar` | Uma página só, zero navegação; server component preservado |
| Admin | seção "// indicações" apensa no fim do `/admin` | Diff mínimo — arquivo em trabalho paralelo |

## Phase 1 — Design

### data-model.md

```sql
event_submissions: id INTEGER PK AUTOINCREMENT,
  name TEXT NOT NULL, url TEXT NOT NULL,
  startsAt TEXT, location TEXT,
  format TEXT NOT NULL DEFAULT 'online'
    CHECK (format IN ('online','presencial','hibrido')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  createdAt TEXT NOT NULL, reviewedAt TEXT
-- + INDEX idx_event_submissions_url_recent ON event_submissions(url, createdAt)
```

`createSubmission(input)` → `{submission, created}`: valida → dedupe
24h → INSERT `pending`. `listPendingSubmissions()` → ASC. 
`reviewSubmission(id, action)` → `null` (404) | `{submission,
hackathon?}`: `pending` + approve → transaction (INSERT hackathons +
UPDATE reviewed); reject → UPDATE só. Já revisada → retorna como está.

`uniqueHackathonId(name, startsAt)`: `slugify` (NFD sem diacrítico,
`[^a-z0-9]+`→`-`, 60) + ano se `startsAt`; conflito → `-2`, `-3`…

### contracts/api.md

- `POST /api/submissions` — público. `company` truthy → 201 `{ok:true}`;
  `{name, url, startsAt?, location?, format?, note?}` → 201
  `{submission}` | 200 `{submission, deduped:true}` | 400 `{error}`.
- `GET /api/submissions` — 401 anon → 403 member → 200 `{submissions}`.
- `POST /api/admin/submissions/[id]` — 401/403 → 404 id →
  `{action:'approve'|'reject'}` → 200 `{submission, hackathon?}`;
  action inválida → 400.

### Render

- `/radar`: `<details>` com summary `// indica um hackathon` + nota de
  curadoria + `<SubmitEventForm/>` (client: name, url, date, location,
  select format, note, honeypot `company` hidden) — sucesso exibe
  "// recebido — vai pra curadoria antes de entrar no radar."
- `/admin`: seção `// indicações (n)` no fim — linha por pendente com
  nome/url/data/local/formato/nota + `<SubmissionActions id>` (client:
  aprovar/recusar → POST → reload), empty state honesto.

### quickstart.md

1. `npm run test` + `npm run test:e2e` verdes
2. `POST /api/submissions {name,url}` deslogado → 201; `/admin` mostra
   na fila; aprovar → evento no topo da curadoria vira radar
3. Bot: `POST` com `company` → 201 e `event_submissions` intacta
