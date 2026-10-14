-- 022 — consentimento da newsletter e motivo do "pulado" (auditoria 041,
-- pacote E).
--
-- subscribers: quem assina passa a ter registro de quando aceitou e qual
-- versão da política de privacidade estava no ar (LGPD art. 8º). A
-- newsletter só vai pra quem confirmou pelo link do e-mail (confirmedAt).
-- unsubscribeToken é o link de descadastro de cada mensagem. Quem assinou
-- antes desta migration fica sem consentAt e sem confirmedAt: não recebe
-- nada até confirmar.
--
-- deliveries.reason: código do motivo do skip que tem conserto do lado da
-- plataforma. 'no_driver' = canal sem chave neste ambiente; quando a chave
-- aparece, o worker reenfileira só essas linhas.

ALTER TABLE subscribers ADD COLUMN "consentAt" TEXT;
ALTER TABLE subscribers ADD COLUMN "policyVersion" TEXT;
ALTER TABLE subscribers ADD COLUMN "confirmedAt" TEXT;
ALTER TABLE subscribers ADD COLUMN "confirmToken" TEXT;
ALTER TABLE subscribers ADD COLUMN "unsubscribeToken" TEXT;
CREATE UNIQUE INDEX idx_subscribers_confirm_token ON subscribers ("confirmToken");
CREATE UNIQUE INDEX idx_subscribers_unsubscribe_token ON subscribers ("unsubscribeToken");

ALTER TABLE deliveries ADD COLUMN "reason" TEXT;
CREATE INDEX idx_deliveries_no_driver ON deliveries ("channel")
  WHERE "status" = 'skipped' AND "reason" = 'no_driver';
