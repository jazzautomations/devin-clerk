-- 013 — mensagens automáticas (confirmação/trava de entrega, lembretes) usam
-- a mesma fila de entregas dos avisos, mas não são avisos da organização:
-- ficam fora da lista do painel pra o aviso de verdade não sumir no meio.
ALTER TABLE announcements ADD COLUMN "system" INTEGER NOT NULL DEFAULT 0;
