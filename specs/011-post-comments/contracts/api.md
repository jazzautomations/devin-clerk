# Contrato: `/api/posts/[id]/comments`

## `GET /api/posts/[id]/comments` — público

```json
200 → { "comments": [
  { "id": 1, "postId": 7, "body": "demo ficou ótima", "createdAt": "2026-10-02 14:00:00",
    "username": "ana_dev", "name": "Ana", "persona": "dev", "xp": 60 }
]}
404 → { "error": "Not found" }   // post inexistente ou id não-inteiro
```

Ordem: `createdAt ASC, id ASC` (cronológica, determinística).

## `POST /api/posts/[id]/comments` — membro autenticado

Body: `{ "body": "string" }` — 1–1000 chars após trim.

```
201 → { "comment": { ...Comment } }   // +5 XP pro autor; checkBadges roda depois
400 → { "error": "Comentário inválido" }  // vazio / só espaços / >1000 / não-string
401 → { "error": "Unauthorized" }     // deslogado OU clerkId sem linha em members
404 → { "error": "Not found" }        // post inexistente ou id não-inteiro
```

## `GET /api/posts` — shape estendido

Cada post passa a incluir `commentCount: number` (subselect, sem N+1).
`POST /api/posts` retorna o post criado com `commentCount: 0`.
