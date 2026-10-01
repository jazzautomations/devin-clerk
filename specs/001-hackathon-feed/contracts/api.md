# Contracts — Feed de Hackathons

## `GET /api/hackathons` (novo, protegido)

Retorna os hackathons futuros pra UI consumir se precisar (o dashboard
renderiza server-side; a API existe pra reuso futuro — ex.: newsletter,
widget).

**Autenticação**: sessão Clerk. Deslogado → `401 {"error":"Unauthorized"}`.

**Resposta 200**:

```json
{
  "hackathons": [
    {
      "id": "hack-inova-saude-2026",
      "name": "Hack Inova — Saúde",
      "organizer": "Hack Inova",
      "startsAt": "2026-10-18T09:00:00-03:00",
      "endsAt": "2026-10-19T18:00:00-03:00",
      "format": "presencial",
      "location": "São Paulo, BR",
      "registrationUrl": "https://...",
      "registrationDeadline": "2026-10-10T23:59:00-03:00",
      "tags": ["ia", "saude"]
    }
  ]
}
```

Não inclui eventos passados nem `active: false`. `closed` não é serializado —
o cliente deriva de `registrationDeadline`.

## Página `/dashboard` (server-rendered)

Sem contrato de rede novo — continua protegida por `proxy.ts` (redirect →
Clerk sign-in deslogado). O feed é HTML do server component.
