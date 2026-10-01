# Quickstart — Feed de Hackathons

Validação end-to-end depois de implementar.

## Setup

```bash
npm install   # já feito
npm run dev   # localhost:3000
```

## Cenários

### 1. Gate de auth

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard
# esperado: 307 → https://*.accounts.dev/sign-in?redirect_url=...

curl -s http://localhost:3000/api/hackathons
# esperado: {"error":"Unauthorized"} + HTTP 401
```

### 2. Feed logado (browser)

1. Sign up/in via Clerk no link público do tunnel.
2. `/dashboard` → lista de hackathons com nome, organizador, data,
   formato, local, tags, deadline e link.
3. Ordenação: evento mais próximo primeiro.
4. Clicar no link de inscrição → abre nova aba na página oficial.

### 3. Filtros

1. Selecionar "online" → só eventos online.
2. Selecionar uma tag → só eventos com a tag.
3. Filtro sem resultado → estado vazio + botão limpar filtros.

### 4. Estados especiais

- Marcar `active: false` ou `startsAt` passado num evento do seed → some
  da lista.
- `registrationDeadline` passado → badge "inscrições encerradas".
- Seed vazio → estado vazio informativo no dashboard.

### 5. Production checklist

`PRODUCTION.md` seções 1-5: lint/typecheck/build, curls de auth, 390px sem
scroll X, feature removida de `upcomingFeatures`.
