# Feature Specification: Avatares

**Feature**: `020-avatars`
**Created**: 2026-11-14
**Status**: Draft
**Input**: A plataforma é toda texto — nenhum lugar mostra a cara de quem constrói. Clerk já fornece `imageUrl` por usuário; falta persistir e renderizar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante vê a cara de quem posta (Priority: P1)

Quem abre o `/feed`, `/membros`, `/talento` ou a lista de inscritos de `/h/[id]` vê um avatar ao lado de cada membro: a foto do Clerk quando existe, ou um bloco de iniciais com borda de acento quando não existe. O feed deixa de ser parede de texto anônimo.

**Why this priority**: Identidade visual é o mínimo de rede social — sem cara, `@username` é abstrato e o feed parece log de servidor. É o que torna "comunidade" visível.

**Independent Test**: Abrir `/feed` com um post de membro que tem foto no Clerk e ver a imagem; post de membro sem foto mostra iniciais — sem login, sem outra feature.

**Acceptance Scenarios**:

1. **Given** membro com `avatarUrl` sincronizado, **When** visitante abre `/feed`, **Then** o post mostra a imagem (quadrado arredondado com borda) ao lado do nome
2. **Given** membro sem `avatarUrl`, **When** visitante abre `/feed`, **Then** o post mostra bloco de iniciais (mono, borda de acento) — nunca imagem quebrada
3. **Given** posts e comentários no feed, **When** renderizam, **Then** autores de comentário também mostram avatar
4. **Given** visitante em `/membros`, `/talento` e na lista de inscritos de `/h/[id]`, **When** as linhas renderizam, **Then** cada uma leva avatar pequeno consistente

---

### User Story 2 - Avatar aparece no perfil e no dashboard (Priority: P2)

O perfil público `/u/[username]` mostra o avatar grande no cabeçalho, e o `/dashboard` cumprimenta o membro com o próprio avatar — a pessoa se reconhece na plataforma.

**Why this priority**: Perfil é onde a identidade se consolida; valor incremental sobre P1 mas esperado em qualquer rede.

**Independent Test**: Abrir `/u/[username]` de membro com foto mostra a imagem em destaque no cabeçalho.

**Acceptance Scenarios**:

1. **Given** membro com foto, **When** abre `/u/[username]` ou `/dashboard`, **Then** avatar grande/médio aparece no cabeçalho/saudação
2. **Given** membro sem foto, **When** abre `/u/[username]`, **Then** bloco de iniciais grande ocupa o lugar — layout não quebra

---

### User Story 3 - Avatar sincroniza sozinho do Clerk (Priority: P1 — faz parte do P1)

A cada leitura que materializa o membro (`getOrCreateMember` com o usuário Clerk em mãos), o `avatarUrl` gravado é atualizado quando `user.imageUrl` mudou. O membro nunca edita avatar no hackahub — a fonte de verdade é o perfil Clerk.

**Why this priority**: Sem sync, o avatar gruda na primeira versão pra sempre. Sync na materialização custa um UPDATE condicional e dispensa webhook.

**Independent Test**: Mudar `imageUrl` no usuário Clerk, recarregar uma página que materializa o membro, e ver a foto nova em qualquer lista.

**Acceptance Scenarios**:

1. **Given** membro existente sem foto, **When** Clerk passa a ter `imageUrl` e o membro abre página autenticada, **Then** `avatarUrl` é gravado e aparece nas listas
2. **Given** membro com foto A, **When** Clerk muda pra foto B, **Then** próxima materialização grava B
3. **Given** `imageUrl` nulo no Clerk, **When** o membro materializa, **Then** `avatarUrl` gravado é preservado (nunca apagado por leitura)

---

### Edge Cases

- `imageUrl` nulo/ausente no Clerk: preserva o gravado (leitura nunca destrói dado)
- `avatarUrl` nulo no banco: fallback de iniciais — derivadas do `name` (duas palavras) ou dos 2 primeiros chars do `username`
- URLs não-http(s) ou quebradas: o `<img>` falha em silêncio do navegador; fallback é responsabilidade do dado (Clerk só emite https)
- Membro criado via API sem `currentUser`: entra com `avatarUrl` nulo e sincroniza na primeira leitura autenticada de página

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `members` DEVE ter coluna `avatarUrl TEXT` (migração idempotente no topo de `lib/members.ts`, mesmo pattern `memberCols` de `lib/db.ts` — aquele arquivo está congelado nesta feature)
- **FR-002**: `getOrCreateMember` DEVE aceitar `imageUrl` no usuário Clerk, gravar no INSERT e atualizar por UPDATE quando presente e diferente; ausente/nulo preserva
- **FR-003**: Todas as chamadas de `getOrCreateMember` (dashboard, feed, radar, perfil, admin, POST /api/posts) DEVEM repassar `user.imageUrl`
- **FR-004**: `listPosts` e `listComments` DEVEM retornar `avatarUrl` via JOIN em `members`; `getRegistrationsByHackathon` e `listTalent` idem; `listLeaderboard`/`listMembers`/`getMemberBy*` já cobrem via `m.*`/`SELECT *`
- **FR-005**: Componente `Avatar` (sm=24px, md=32px, lg=64px): `<img>` quadrado arredondado com borda quando `avatarUrl`, senão bloco mono de iniciais com borda de acento; fallback sempre renderiza, nunca imagem quebrada
- **FR-006**: Avatar DEVE aparecer em: linhas de post e comentário do feed, header de `/u/[username]` (lg), linhas de `/membros` e `/talento` (md), saudação do `/dashboard` (md), lista de inscritos de `/h/[id]` (sm)
- **FR-007**: `PATCH /api/members/me` NÃO aceita `avatarUrl` — avatar é dado do Clerk, não campo editável do hackahub

### Key Entities

- **Member.avatarUrl**: URL https da imagem de perfil Clerk, `null` quando o usuário não tem foto — sincronizada na materialização, nunca editada pela plataforma

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das listagens de membro (feed, comentários, membros, talento, inscritos) exibem avatar ou fallback — zero texto-só
- **SC-002**: Troca de foto no Clerk reflete na plataforma em no máximo 1 pageview autenticado
- **SC-003**: Nenhum `<img>` renderizado com `src` nulo/vazio (fallback garantido por construção)
- **SC-004**: Zero config nova de host remoto — `<img>` simples, sem `remotePatterns` no `next.config.ts`

## Assumptions

- Clerk hospeda as imagens (`img.clerk.com`) e só emite URLs https — sem validação extra de host
- Avatar não é editável no hackahub: quem quiser trocar troca no perfil Clerk (mesma conta, `UserButton` já leva lá)
- A migração mora em `lib/members.ts` porque `lib/db.ts` tem trabalho paralelo nesta fase — mesmo pattern idempotente (PRAGMA + ALTER)
