# Research — Feed de Hackathons

## Decision: fonte de dados = módulo TS seedado

- **Decision**: `data/hackathons.ts` com array tipado + `lib/hackathons.ts`
  expondo `getUpcomingHackathons()`/`getTags()`.
- **Rationale**: zero infra nova, admin edita via git (PR = curadoria
  versionada), troca pra Postgres depois mudando só `lib/`. Constituição
  permite seed quando o spec diz — e o spec diz explicitamente "arquivo seed
  ou tabela".
- **Alternatives considered**: Postgres direto (sem DB provisionada ainda —
  Supabase é decisão futura); CMS/Notion (dependência externa desnecessária
  pro MVP); crawler Devpost/MLH (fora de escopo — curadoria manual).

## Decision: filtros client-side

- **Decision**: `HackathonFeed` é client component; recebe a lista completa
  do server component e filtra em memória por formato/tag.
- **Rationale**: ≤50 eventos → filtro instantâneo, sem round-trip, sem
  searchParams wiring. Server renderiza a lista completa (SEO não importa —
  é members-only).
- **Alternatives**: URL searchParams + server filter (overkill pro volume);
  nuqs (dep extra sem ganho aqui).

## Decision: datas como ISO strings no seed

- **Decision**: `startsAt`/`endsAt`/`registrationDeadline` como `string` ISO
  8601; formatação via `Intl.DateTimeFormat("pt-BR")`.
- **Rationale**: serializável server→client sem Date objects, parse
  determinístico pra comparar "futuro/passado" com `new Date()`.
- **Alternatives**: Date no seed (não serializa pro client component);
  timestamps numéricos (ilegível pra quem edita o seed).

## Decision: "inscrições encerradas" computado no render

- **Decision**: derivar `closed = deadline && deadline < now` por item — sem
  campo manual no seed.
- **Rationale**: elimina estado inconsistente (deadline passa e ninguém lembra
  de desmarcar). `now` fixo por request evita hydration mismatch.
