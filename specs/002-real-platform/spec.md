# Feature Specification: Plataforma Real (DB + perfis + inscrições)

**Feature Branch**: `002-real-platform`

**Created**: 2026-10-01

**Status**: Shipped

**Input**: User feedback: "esses features tão de brinquedo, não de verdade" —
transformar o demo em produto real: banco de dados, perfil de hacker e
inscrição em 1 clique funcionais.

## Summary

Persistência real via SQLite embarcado (`data/hackahub.db`, WAL). Tabelas:
`hackathons`, `members`, `registrations`. Fluxo: sign-in Clerk → membro
criado no primeiro acesso ao `/dashboard` → eventos parceiros (organizer
contém "Hack Inova") têm botão "inscrever-se em 1 clique" que grava
registration real → `/u/[username]` é o perfil público com histórico →
`/perfil` edita nome/bio/skills/github via `PATCH /api/members/me`.

## Mudanças vs spec 001

- Feed deixou de ser seed-only: `lib/hackathons.ts` lê do SQLite (seed é
  apenas bootstrap quando a tabela está vazia).
- "Inscrição em 1 clique" e "Perfil público do hacker" saíram de
  `upcomingFeatures` — implementados de verdade.
- `partner` derivado de `organizer` — eventos Hack Inova registram in-app,
  externos seguem link oficial.
- `/perfil` protegido por `proxy.ts`; `/u/[username]` é público de propósito
  (é o link compartilhável do hacker).

## Validação

- `POST /api/hackathons/[id]/register` → `{"registered":true}` logado,
  401 deslogado
- `DELETE` no mesmo endpoint cancela
- `/api/members/me` PATCH atualiza perfil; `/u/[username]` mostra
  histórico de campanhas
