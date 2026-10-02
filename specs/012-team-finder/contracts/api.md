# Contrato: `/api/hackathons/[id]/team-board`

## `GET` — público

```json
200 → { "entries": [
  { "id": 1, "memberId": 3, "hackathonId": "hack-inova-alphaville-2026",
    "skills": ["react", "typescript"], "need": "alguém de dados", "note": null,
    "active": true, "createdAt": "2026-10-02 14:00:00",
    "username": "ana_dev", "name": "Ana", "headline": "front pl",
    "persona": "dev", "xp": 60 }
]}
404 → { "error": "Not found" }   // edição inexistente ou inativa
```

Ordem: `createdAt ASC, id ASC`. Só `active = 1`.

## `POST` — membro autenticado **e inscrito** na edição

Body: `{ "skills": ["react"], "need": "string 1–200", "note": "string ≤300" }`

```
201 → { "entry": {...}, "created": true }   // 1ª vez: +10 XP + checkBadges
200 → { "entry": {...}, "created": false }  // re-anunciar = update + reativa
400 → { "error": "..." }                    // need ausente/>200, note >300, skills não-array
401 → { "error": "Unauthorized" }           // deslogado OU clerkId sem member
403 → { "error": "inscreve-te primeiro" }   // sem linha em registrations
404 → { "error": "Not found" }              // edição inexistente/inativa
```

Ordem dos guards: 401 → 404 hackathon → 403 não-inscrito → 400 validação → upsert.

## `DELETE` — membro autenticado

Desativa o próprio anúncio (`active = 0`). Idempotente: 200 mesmo sem anúncio.

```
200 → { "active": false }
401 → { "error": "Unauthorized" }
404 → { "error": "Not found" }              // edição inexistente/inativa
```

## `PATCH` — admin (moderação, FR-008)

Body: `{ "entryId": number, "active": boolean }`

```
200 → { "entry": {...} }
400 → entryId/active inválidos
401 → deslogado/sem member · 403 → não-admin
404 → edição inexistente OU entry de outra edição
```
