# 035 — Estado da arte: operação de evento e comunidade (out/2026)

Coleta 14/10/2026, páginas públicas. **[V]** visto em fonte ou no código · **[I]** inferência.

Já existe no HackaHub (não é gap): formulário versionado + consentimento, fila com **promoção automática** (Luma aprova à mão — help.luma.com/p/waitlist), JSON-LD Event, "adicionar ao LinkedIn", List-Unsubscribe, check-in QR HMAC, júri, certificado `/c/[code]`.
Não encontrado: .ics/agenda, lembrete agendado, nascimento/responsável, uso de imagem, crachá, alergia, incidente, NPS, relatório pro patrocinador, check-in offline, carga horária no certificado, export/exclusão pelo titular.

## Top 12 gaps (impacto ↓)

1. **RSVP + lembretes D-7/D-1/H-2 (M).** MLH (323 eventos): ~50% de comparecimento em hackathon grátis, recomenda inscrever o dobro [V guide.mlh.com]. Sem confirmação, a fila nunca anda. Luma: lembrete 1 dia/1 hora antes, blasts agendados [V]. → D-7 "confirmo/não vou" com token; sem confirmação até D-3 perde vaga pra fila; D-1 logística; H-2 endereço+QR; sobrevenda configurável.
2. **WhatsApp pela Cloud API oficial (M).** Evolution suporta o provedor oficial [V]. Meta cobra por template entregue; utility dentro da janela de 24h grátis; faturamento em BRL desde 01/07/2026 [V]. ~US$0,022 utility BR [V-secundário] → ~US$17/edição de 150 pessoas × 5 msgs [I]. Exige templates aprovados; tom promocional vira marketing [V].
3. **Certificado com carga horária e regra de presença (P).** Horas complementares exigem comprovação [V regulamentos de curso, ex. UFRJ]. Even3 emite em massa com QR [V]. → horas por papel, presença mínima configurável (check-in/out ou 2º dia), horas no PDF e em `/c/`, CSV por curso.
4. **Uso de imagem e menores (M; bloqueio por idade P).** Caixa de imagem separada, opcional, revogável, com finalidade; cordão de outra cor pra quem recusa; idade mínima por edição (padrão 18) + nascimento; menor = termo do responsável.
5. **Programação com salas e .ics (M).** Luma anexa .ics e feed iCal [V]. → itens com início/fim/sala/público, "agora / a seguir", .ics por item e feed por inscrito, mudança gera aviso.
6. **Check-in offline e sem login na porta (M).** Sympla valida offline [V]; Luma pass de Wallet offline e staff só de check-in [V]. → QR no e-mail de aprovação; leitor baixa tokens, valida local e sincroniza; walk-in pela fila.
7. **Crachás em lote (P).** Luma só Enterprise imprime no local; Sympla só Android + 2 impressoras [V]. → PDF A4 em etiqueta Pimaco (nome, papel por cor, time, QR).
8. **Refeições e alergias (P relatório; M leitura por refeição).** HackUTD: retirada 90% almoço D1 … 30% café [V MLH]. → pergunta de dieta, relatório pro buffet, estimativa por refeição pelos presentes.
9. **Código de conduta + incidentes (P–M).** MLH exige canal de denúncia [V]; Hack Club registro em até 18h [V hackclub.com/safeguarding]. → CoC versionado aceito na inscrição, "reportar" (anônimo opcional) em fila privada, plantão por turno.
10. **Fila de mentoria (M).** HELPq do HackMIT [V], bots de Discord [V]. → "pedir mentor" com tag e mesa; assumir/resolvido; tempo médio vira métrica.
11. **Pesquisa por papel + relatório pro patrocinador (M).** MLH recomenda pesquisa logo após e "obrigado com números e fotos" [V]; Luma manda pesquisa até pra quem faltou [V]. → só presentes, NPS + 3 perguntas; relatório inscritos→aprovados→presentes, cursos agregados, projetos, NPS, fotos; dado individual só com consentimento nominal.
12. **Direitos do titular e retenção (M).** "Baixar meus dados" e "excluir conta"; retenção por tipo (formulário/dieta apagados N meses após a edição; presença e certificado mantidos); registro de pedidos; canal do encarregado (pequeno porte pode dispensar encarregado mas mantém canal — Res. CD/ANPD 2/2022 [V]).

## Riscos

1. **Evolution com Baileys → ban sem apelação** [V-secundário]; pior momento é véspera/dia do evento [I]. Migrar pra Cloud API com número próprio da Hack Inova e 3–5 templates utility antes da edição real; sem isso WhatsApp desligado e e-mail principal. Nunca número pessoal. (Boato de fim da janela grátis em 01/10/2026 não aparece na página da Meta.)
2. **E-mail:** Gmail/Yahoo/Microsoft exigem SPF+DKIM+DMARC alinhados, descadastro 1 clique (RFC 8058), spam <0,3% [V dmarcian]. Resend grátis ~100/dia [V-secundário] → plano Pro (~US$20), subdomínio de envio, testar entrega no Microsoft 365 das universidades [I].
3. **Imagem:** dado pessoal + direito de personalidade (CC art. 20); cláusula genérica nos termos é frágil [V-secundário]. Consentimento separado e revogável; foto pro patrocinador só de quem consentiu.
4. **Menores:** ECA Digital (Lei 15.211/2025) em vigor desde 17/03/2026, Decreto 12.880/2026, multa até R$50 mi; autodeclaração não basta; até 16 vinculado a responsável [V]. Padrão 18+; edição com menores só com parecer jurídico; 1 adulto pra 15 e sem mentoria 1:1 fora de vista [V Hack Club].
5. **Dados pro patrocinador/talento:** finalidade específica e patrocinador nomeado na coleta; usar histórico de no-show na curadoria é perfilamento — transparente e contestável [I].
6. **Dia do evento num host só:** VPS + Clerk + Wi-Fi da faculdade [I] → check-in offline + planilha de contingência gerada na véspera.

## Não copiar
Plataforma virtual estilo Hopin (vendida à RingCentral em 2023) · reconstruir Discord/Slido/Kahoot (linkar Slido basta) · impressão no check-in com driver · Open Badges 3.0 completo com VC (no máximo export JSON-LD barato; LinkedIn usa a URL, secretaria usa o PDF) · check-in facial (biometria) · marketplace/rede de calendários antes de rodar uma edição inteira · pesquisa pra quem faltou · ingresso pago/nota fiscal (onde Sympla/Eventbrite ganham).

## Diferenciais possíveis no Brasil [I]
1. **Ciclo anti-no-show fechado:** RSVP → liberação automática pra fila → histórico de comparecimento visível pro curador e pro membro.
2. **Certificado acadêmico com presença provada:** carga horária, horários reais de check-in, papel, verificação pública, CSV por curso — ligado a time/projeto/júri (Even3 não liga).
3. **WhatsApp oficial bidirecional no produto:** opt-in, templates prontos, custo da edição mostrado antes do envio, respostas caindo no canal de dúvidas.
