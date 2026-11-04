-- 048 — salão no telão (spec 046, onda 4, telao-e-bicho-do-time).
--
-- O telão da edição passa a ter duas telas: 'palco' (a final ao vivo, de
-- sempre) e 'salao' (a ilha isométrica com os bichos de quem fez check-in).
-- A tela escolhida é estado do evento, não do navegador: quem troca é o
-- controle (organizador/staff) e todo telão aberto segue em até 10s — o
-- projetor da entrada e o do auditório mostram a mesma coisa.
--
-- "screen" mora na mesma linha de stage_sessions (migration 009): o salão
-- não é um segundo palco, é o mesmo evento em outro enquadramento. O
-- default 'palco' mantém o comportamento de quem já tinha final montada.
ALTER TABLE stage_sessions ADD COLUMN IF NOT EXISTS "screen" TEXT NOT NULL DEFAULT 'palco'
  CHECK ("screen" IN ('palco', 'salao'));
