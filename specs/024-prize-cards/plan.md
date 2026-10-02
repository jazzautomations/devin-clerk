# Implementation Plan: Prêmio nos Cards do Radar

**Branch**: `024-prize-cards` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

`hackathons` ganha `prize TEXT` (display string, verbatim). O scraper
extrai de Devpost (`prize_amount`, strip HTML, zero→None) e TAIKAI
(`prize` + `prizeCurrency.name` → `"€20,000"`/`"$3,500"`); merge e upsert
carregam o campo. `HackathonCard` renderiza "prêmio" em `text-lendario`
no `<dl>` do card; `opengraph-image` anexa o valor à linha de detalhe.
Seed curado: Unifacens `"R$ 5 mil"` (real, spec 022) + TJPA `"R$ 15 mil"`
na curadoria do scraper. Admin PATCH/POST aceitam `prize`.
TDD: testes unit/python/e2e falhando antes do código.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router + Python (scraper)
- **Storage**: SQLite — `ALTER TABLE` idempotente via `PRAGMA table_info`
  em `lib/db.ts` e espelhado no `ensure_schema` do `scrape_radar.py`
- **Testing**: Vitest (`HACKAHUB_DB=:memory:`) + asserts puros no runner
  `scripts/test_scrape_radar.py` + Playwright (card no radar, OG 200)
- **Padrão de dados**: `prize` é string de display — a UI nunca parseia;
  a fonte formata ("$138,000", "€20,000", "R$ 15 mil")

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: prêmio vende o clique — discovery mais honesto ✅
- III. Auth: leitura pública inalterada; escrita só via admin/scraper ✅
- IV. One-session scope: coluna + scraper + chip + OG em uma sessão ✅
- V. No slop UI: linha "prêmio" só existe quando há dado — sem placeholder ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Tipo da coluna | `TEXT` nullable livre | "R$5k + créditos" e "€20,000" não cabem em número — display string é o que a UI precisa (pattern `challenges.prize` da spec 006) |
| Devpost | `prize_amount` com strip de tags; dígitos todos zero → `None` | campo já raspado p/ tag `premio-*`; `prizes` é sempre `null` na listagem (verificado na API) |
| TAIKAI | `prize` int + `prizeCurrency { name }` → `{símbolo}{n:,.0f}` | moeda varia por challenge (EUR/USD confirmado na API); mapa EUR→€ USD→$ GBP→£ BRL→R$, fallback `"20,000 BRL"` |
| Merge | `prize` entra no `metadata_score` e no fill de vazios | "richest record" já é a regra — prêmio é metadado como `endsAt` |
| Upsert | `prize=excluded.prize` no ON CONFLICT | linhas `source IS NOT NULL` são propriedade do scraper — overwrite consistente com os outros campos |
| Tag `premio-*` | mantida | chip é display, tag é faceta de busca/filtro — remover perderia `?q=premio` |
| Card | linha `col-span-2` no `<dl>`, acima de "inscrições", `text-lendario` | mesmo grid do card, zero reestruturação; lendário = cor de valor na identidade |
| Seeds | só Unifacens `"R$ 5 mil"` (real, divulgado — 022) | PUC/Anhembi citam prêmios de *desafio* (Oracle), não da edição — não confundir `challenges.prize` com `hackathons.prize` |
| Backfill seed | `UPDATE … SET prize WHERE id AND prize IS NULL` | `INSERT OR IGNORE` não alcança bancos existentes; guarda preserva valor posto à mão |

## Phase 1 — Design

### data-model.md

```
hackathons += prize TEXT NULL   -- display: "$138,000", "R$ 5 mil"
```

Sem tabela nova. `Row`/`toHackathon` já propagam via `SELECT *` + spread.

### contracts

- `Hackathon.prize: string | null` — serializado pro client card
- `PATCH /api/admin/hackathons/[id]` — `prize` no whitelist de campos
  (string→define, null/""→limpa, outro tipo→400); POST aceita opcional
- Scraper row dict ganha chave `prize` (None default em fontes sem dado)

### quickstart.md

1. `npm run test` + `npm run test:scrape` + `test:e2e` verdes
2. `npm run scrape` → eventos devpost/taikai ganham `prize` no banco
3. `/radar` mostra chip lendário; `/h/hack-inova-unifacens-2026` OG cita
   "R$ 5 mil" na linha de detalhe
