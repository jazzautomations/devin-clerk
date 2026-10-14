# 037 — Roadmap HackaHub (a partir de 034, 035 e 036)

Data: 14/10/2026. Cruza o estudo do AI Tinkerers (034), operação de evento
(035) e plataformas de hackathon (036). Evidência nas specs citadas; o que
é palpite está marcado **[palpite]**.

## A tese que as pesquisas sustentam

1. **Ninguém faz bem o depois do hackathon pra quem paga a conta.** Painel do
   patrocinador e feedback do júri pros times são lacunas confirmadas (036).
2. **No Brasil, o que tira aluno do sofá é hora complementar** e certificado
   com presença provada (035, 036) **[palpite a validar com 2–3 coordenadores]**.
3. **A Oracle já compra empregabilidade do NoCountry** (830 estudantes, 74
   contratações — 036). O HackaHub ganha esse orçamento mostrando **prova**
   (projeto travado, commits no período, nota do júri, certificado) onde o
   NoCountry mostra rótulo (nota de soft skill sem entregável).
4. **Comparecimento de evento grátis é ~50%** (MLH, 035). Sem RSVP a fila de
   espera não anda; com RSVP + histórico de presença, a curadoria melhora.

Daí o posicionamento: **operação ponta a ponta + evidência verificável**.
Não competir em volume com Devpost/lablab nem virar rede social de vaidade.

## Em construção agora
- **E** candidatura voluntário/mentor/jurado → papel na edição.
- **F** modo palco: telão, cronômetro, voto ao vivo só com check-in (036 #6).
- **G** entrega de projeto: prazos, rascunho→enviado→travado, snapshot, trabalho anterior, desafios de patrocinador, categorias de prêmio, lembretes (034 §5, 036 #1/#3).
- Feito hoje: LGPD (baixar meus dados / excluir conta — 035 #12), LinkedIn/compartilhar, personas.

## Onda 1 — pra Hack Inova rodar a próxima edição sem susto
| # | O quê | Por quê (fonte) | Esforço |
|---|---|---|---|
| 1 | **RSVP D-7 + lembretes D-1/H-2**, sem confirmação até D-3 libera vaga pra fila | comparecimento ~50% (035 #1, 036 #10) | M |
| 2 | **Certificado com carga horária** por papel + presença mínima + CSV por curso | hora complementar (035 #3, 036 dif. 3) | P |
| 3 | **Uso de imagem** (caixa separada, revogável) + **idade mínima/ECA** por edição | risco jurídico concreto (035 #4, riscos 3–4) | M |
| 4 | **Programação com salas + .ics** e bloco "agora / a seguir" | primeira pergunta no grupo do zap (035 #5) | M |
| 5 | **Check-in offline + QR no e-mail + crachás em PDF (Pimaco)** | Wi-Fi da faculdade cai no pico (035 #6–7) | M |
| 6 | **Refeições/alergias** com relatório pro buffet | MLH/HackUTD (035 #8) | P |
| 7 | **Código de conduta + canal de incidentes** | MLH/Hack Club exigem (035 #9) | P–M |

## Onda 2 — o que vende pra patrocinador e universidade
| # | O quê | Por quê | Esforço |
|---|---|---|---|
| 8 | **Relatório/painel do patrocinador** automático (funil, uso da stack, talentos com opt-in, feedback do SDK) | ninguém expõe; produto pago (036 #4, dif. 2) | M |
| 9 | **Feedback do júri pro time** (anônimo, notas vs média da edição) | lacuna do mercado; valor educacional (036 #5) | P |
| 10 | **Dossiê de evidência**: linha do tempo de commits vs horário do evento + declaração de pré-existente/IA, sinalizando (nunca desclassificando sozinho) | fraude nº 1 é TCC reciclado (036 #2, dif. 1) | M |
| 11 | **Pesquisa NPS por papel, só pra presentes** | MLH (035 #11) | P |
| 12 | **Opt-in de contato pro patrocinador por QR** | monetização com LGPD (034 #8) | M |

## Onda 3 — comunidade entre edições
| # | O quê | Por quê | Esforço |
|---|---|---|---|
| 13 | **Formação de time por papel** com sugestão aprovada pelo organizador / aceite mútuo | Colosseum, NoCountry (036 #8) | M |
| 14 | **Continuidade**: temporada de 4 semanas pós-edição com update semanal; liga entre edições com pontos por entrega (não por like) | Colosseum Eternal, lablab League (036 #9) | M/G |
| 15 | **Fila de mentoria** (pedir/assumir/resolver, tempo médio) | HELPq (035 #10) | M |
| 16 | **Normalização do júri exibida ao lado da média + resultado auditável** | Gavel/VERDICT (036 #7) | M |
| 17 | **Evidência pra recrutador**: peer review intra-time agregado (N≥3) ao lado do artefato + pedido de intro com opt-in | modelo NoCountry, com prova (036 #11) | M/G |
| 18 | **Pedir palco / demo day** entre edições | AI Tinkerers (034 #10) | M |

## Correções que as pesquisas apontaram
- **XP por like recebido** gera farm (036, não copiar #4) → pontuar entrega verificada (presença, entrega travada, prêmio, continuidade).
- **Voto popular** não decide prêmio principal; categoria separada (frente F).

## Depende do fundador (não é código)
- **WhatsApp pela Cloud API oficial da Meta** com número da Hack Inova e 3–5 templates utility — Evolution com Baileys arrisca ban no dia do evento (035 risco 1). ~US$17/edição [estimativa 035].
- **Resend plano pago** (grátis ~100 e-mails/dia) + SPF/DKIM/DMARC no domínio de envio (035 risco 2).
- **Admins** em produção (HACKAHUB_ADMIN_EMAILS).
- **Parecer jurídico** antes de edição com menores (035 risco 4); texto dos termos e encarregado.
- **Validar com 2–3 coordenadores** a demanda de hora complementar antes de investir além do item 2.
- Contato com organizadores do AI Tinkerers SP (034) pra ver o lado logado da plataforma deles.

## Depois (anotado pelo dono em 14/10/2026)
- **Copilot HackaHub**, inspirado no Colosseum Copilot. É um assistente que responde em cima da base do próprio HackaHub:
  - projetos e campeões de edições passadas;
  - quem já construiu o quê;
  - desafios de patrocinador;
  - perguntas da edição (regras, programação, prazos).

  Ajuda o participante a validar a ideia ("já fizeram isso?"), achar time e escolher stack. Ajuda o organizador a responder dúvidas e montar desafio. Fica pra depois da landing, do onboarding e das correções da auditoria. Antes de construir, validar o uso com a galera da Hack Inova. Fica em pé: IA nunca dá nota nem decide prêmio (ver "Não fazer").

## Não fazer (consolidado)
Token/NFT/voto on-chain · IA dando nota · proctoring/time-tracking · muro de login em projeto · bio gerada por IA · pontuação automática de candidato · Hopin/Discord/Slido próprios · impressão no check-in com driver · Open Badges completo agora · check-in facial · ingresso pago/nota fiscal · marketplace de eventos do mundo · hackathon de 5 semanas pra universitário.
