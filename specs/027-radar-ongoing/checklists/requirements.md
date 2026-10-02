# Specification Quality Checklist: Radar mostra eventos em andamento

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-02
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable (27 → 70 cards no banco real)
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified (fronteira exata, COALESCE parcial, sentinel)
- [x] Scope is clearly bounded (listas do radar; `/h/[id]`, arena e admin fora)
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows (ongoing no radar, estado no card, momentum)
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- "Aberto = não encerrado" com `COALESCE(endsAt, registrationDeadline, startsAt)` registrado pra não reabrir em review — deadline como proxy de fim é decisão explícita.
- Momentum "+N · 30d" omitido onde não há timestamp real (arquivo) documentado em Assumptions.
