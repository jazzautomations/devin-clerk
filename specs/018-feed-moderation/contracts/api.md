# Contrato: moderação do feed

## `DELETE /api/posts/[id]` — autor ou admin

```
200 → { "ok": true }              // post apagado + likes + comments (transação)
401 → { "error": "Unauthorized" } // deslogado OU clerkId sem linha em members
403 → { "error": "Forbidden" }    // logado, mas nem autor nem admin
404 → { "error": "Not found" }    // post inexistente ou id não-inteiro
```

Ordem das guards: 401 (auth) → 404 (existe?) → 403 (pode?).

## `DELETE /api/posts/[id]/comments/[commentId]` — autor do comentário ou admin

```
200 → { "ok": true }
401 → { "error": "Unauthorized" }
403 → { "error": "Forbidden" }    // logado, mas nem autor do comentário nem admin
404 → { "error": "Not found" }    // comment inexistente, id inválido,
                                  // ou comentário que não é desse post
```

## Leitura — sem mudança

`GET /api/posts` e `GET /api/posts/[id]/comments` seguem públicos e com o
mesmo shape: `commentCount`/`likeCount` refletem a cascata automaticamente
(as linhas deixam de existir).
