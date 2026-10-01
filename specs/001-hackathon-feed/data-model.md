# Data Model — Feed de Hackathons

## Hackathon

Fonte: `data/hackathons.ts` (seed tipado). Migração futura pra tabela
`hackathons` no Postgres mantém os mesmos campos.

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string (slug) | único, estável |
| `name` | string | obrigatório |
| `organizer` | string | obrigatório |
| `startsAt` | string ISO 8601 | obrigatório; define ordenação e se aparece |
| `endsAt` | string ISO 8601 \| null | opcional |
| `format` | `"online" \| "presencial" \| "hibrido"` | obrigatório |
| `location` | string \| null | obrigatório se presencial/híbrido; null se online |
| `registrationUrl` | string URL | obrigatório; abre em nova aba |
| `registrationDeadline` | string ISO 8601 \| null | null = "inscrições abertas" |
| `tags` | string[] | lowercase, ex.: `["ia", "saude", "web3"]` |
| `active` | boolean | false = cancelado, nunca renderiza |

## Regras derivadas

- **Aparece no feed**: `active && new Date(startsAt) > now`
- **Inscrições encerradas**: `registrationDeadline && new Date(registrationDeadline) < now`
- **Ordenação**: `startsAt` crescente
- **Filtro formato**: `format === selected` (ou todos se nenhum selecionado)
- **Filtro tag**: `tags.includes(selectedTag)`

## Membro

Sem campos novos — gate via Clerk `auth()` existente.
