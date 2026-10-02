# Implementation Plan: Admin — UI do Arquivo de Edições

**Branch**: `015-admin-archive-ui` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

## Summary

Fecha o gap curl-only do spec 003: `components/ArchiveForms.tsx` (client)
com `TeamForm` (nome, colocação, membros por vírgula, "+ projeto" colapsável,
aviso de `ignoredUsernames`) e `AssetForm` (tipo/url/legenda) — mesmo pattern
de fetch+reload do `ChallengeForm`. `app/admin/page.tsx` ganha seção
"// arquivo" por edição com resumo server-rendered via `getArchive`.
Zero mudança em lib/API — contratos já existem e estão testados.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: nenhuma — reusa `lib/archive.ts` e schema do spec 003
- **Testing**: Vitest (API — complementa 400s não cobertos) + Playwright
  (401 nas rotas de arquivo, já que e2e não passa do sign-in); UI verificada
  por typecheck + verificação manual documentada no spec
- **Padrão de dados**: `components/ArchiveForms.tsx` novo — mesmo estilo de
  `components/ChallengeForm.tsx`

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: arquivo público só se preenche se o cadastro for fácil ✅
- III. Auth: forms chamam só `/api/admin/*` com role check já testado ✅
- IV. One-session scope: 1 componente client + 1 seção server + testes ✅
- V. No slop UI: formulário compacto (SC-001 <1min), sem campo decorativo ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Local dos forms | Dentro do `<details>` de cada edição | O arquivo é por edição — contexto já está na tela, sem página nova |
| Projeto | Checkbox "+ projeto" colapsa fieldset | Time sem projeto é caso comum; esconder mantém o form de 3 campos |
| ignoredUsernames | Aviso inline + reload com delay (~3s) | O admin precisa ler quem foi ignorado antes da página virar |
| Resumo | `getArchive(e.id)` server-side num `Map` | Mesmo pattern de `registrantsByEvent`/`challengesByEvent` |
| Edição/exclusão | Fora de escopo | Append-only como desafios e board no admin |

## Phase 1 — Design

### contracts/

Nenhum contrato novo — reusa:
- `POST /api/admin/hackathons/[id]/teams` → 201 `{team, ignoredUsernames}` | 400/401/403/404
- `POST /api/admin/hackathons/[id]/assets` → 201 `{asset}` | 400/401/403/404

### quickstart.md

1. `npm run test` + `npm run test:e2e` verdes
2. Verificação manual no spec.md ("Verificação manual") — login admin →
   `/admin` → expandir edição → cadastrar time e material
