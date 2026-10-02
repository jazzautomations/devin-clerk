# Tasks: Notificações

**Feature**: `013-notifications` | TDD: testes antes da implementação.

## Fase 1 — Schema + lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/notifications.test.ts` — notify insere + self-skip por username, listNotifications DESC/limite/isolamento, unreadCount, markRead escopo memberId, markAllRead
- [x] T1.2 `lib/notifications.ts`: CREATE TABLE próprio (sem tocar `lib/db.ts`) + notify, listNotifications, unreadCount, markAllRead, markRead

## Fase 2 — API

- [x] T2.1 Teste falhando: `tests/api/notifications.test.ts` — GET 401 deslogado + payload {notifications, unread}; POST readAll/{id}/400/401; gatilhos: like notifica autor, comment notifica autor, self não notifica, unlike não notifica
- [x] T2.2 `app/api/notifications/route.ts`: GET + POST
- [x] T2.3 Gatilhos: `notify()` em `app/api/posts/[id]/like/route.ts` (só no like) e `app/api/posts/[id]/comments/route.ts`

## Fase 3 — UI

- [x] T3.1 Teste BDD falhando: `tests/e2e/notifications.spec.ts` — anon não vê sino; GET/POST anon → 401 JSON
- [x] T3.2 `components/NotificationBell.tsx`: sino ◈ + badge accent + dropdown (texto, tempo relativo, ponto não-lida, "marcar tudo lido")
- [x] T3.3 `components/Header.tsx`: bell dentro do `<Show when="signed-in">` junto ao UserButton

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
