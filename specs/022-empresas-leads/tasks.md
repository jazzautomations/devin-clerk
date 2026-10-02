# Tasks: Empresas — porta comercial, leads e legal

**Feature**: `022-empresas-leads` | TDD: testes antes da implementação.

## Fase 1 — lib leads (testes primeiro)

- [ ] T1.1 Testes falhando: `tests/unit/leads.test.ts` — createLead (defaults, company obrigatória, e-mail válido, interest whitelist, message opcional), dedupe 10min (mesmo par → existente; fora da janela/outro par → novo), listLeads desc
- [ ] T1.2 `lib/leads.ts`: schema idempotente (CREATE TABLE + INDEX) + createLead + listLeads

## Fase 2 — API pública

- [ ] T2.1 Testes falhando: `tests/api/leads.test.ts` — POST 201, 400 (sem company/e-mail inválido/interest inválido/sem body), honeypot 201 sem gravar, dedupe 200 idempotente
- [ ] T2.2 `app/api/leads/route.ts`: POST público com honeypot + validação + dedupe

## Fase 3 — Páginas públicas + admin + sitemap

- [ ] T3.1 Teste BDD falhando: `tests/e2e/empresas.spec.ts` — /empresas renderiza (hero, oferta, stats, form), POST via request 201/400/honeypot/dedupe, /legal/* 200 com headings, sitemap contém /empresas
- [ ] T3.2 `components/LeadForm.tsx` (client, honeypot hidden) + `app/empresas/page.tsx` (generateMetadata + canonical)
- [ ] T3.3 `app/legal/termos/page.tsx` + `app/legal/privacidade/page.tsx` (metadata própria, PT-BR real)
- [ ] T3.4 `lib/seo.ts` STATIC_ROUTES + `/admin` seção "// leads" + landing link → `/empresas`

## Fase 4 — Gate

- [ ] T4.1 lint + typecheck + build + test + test:e2e verdes
