# 036 — Estado da arte: plataformas de hackathon (out/2026)

Coleta 14/10/2026. **[V]** visto · **[I]** inferido ou só snippet. 403: handbook/entries do AI Tinkerers, home da DoraHacks, Unstop.

Achados do código HackaHub (antes das frentes E/F/G): `team_projects` sem prazo/estado/desafio/pré-existente; `toggleVote` sem check-in nem janela; comentário do jurado não chega ao time.

## Destaque: NoCountry × Oracle
Caso "Oracle Next Education" [V nocountry.tech/casos-de-exito]: 830 estudantes, 106 times, 6 semanas, **197 do Brasil**, 574 perfis "validados comportamentalmente" (peer review de 13 soft skills), Demo Day com 12+ empresas, **74 contratações**. Home: "Oracle: +2.500 participantes, 4 edições". Concorrente direto pelo orçamento de empregabilidade da Oracle — que compra contratações e horas de triagem economizadas [I].

## Capacidades × players
| Capacidade | Melhor referência | Commodity/diferencial |
|---|---|---|
| Submissão rica | Colosseum: pitch ≤3 min + vídeo técnico separado [V]; Devpost: janela + template Inspiration/What it does/How we built/Built With [V] | commodity; vídeo técnico separado = diferencial pequeno |
| Código pré-existente | ETHGlobal: trilha Classic × Continuity com disclosure; commit único grande = desqualificado [V ethglobal.com/rules] | disclosure commodity; Continuity diferencial |
| Validação de vídeo | ETHGlobal auto-rejeita <2 ou >4 min, <720p, acelerado, TTS [V] | diferencial barato |
| Tracks de sponsor | ETHGlobal: até 3 por projeto, parceiro julga assíncrono, FEEDBACK.md [V]; Devfolio Sponsor Judging [V] | commodity; FEEDBACK.md diferencial pro sponsor |
| Rodadas | ETHGlobal: rodada 1 assíncrona, ~20% ao vivo, 4+3 min [V] | commodity |
| Método de julgamento | Gavel (comparação pareada) [V]; VERDICT 2026 (normalização + bundle assinado recomputável) [V]; Devpost escolhe vencedor arrastando manualmente [V] | rubrica commodity; normalização/auditável raro |
| Feedback pros times | ninguém faz bem | **lacuna** |
| Pagamento de prêmio | Devpost até 60 dias, lablab até 90 [V] | Pix + NF seria diferencial |
| Painel do sponsor | nenhum público | **lacuna** |
| Formação de time | Colosseum Cofounder Matching (curado, aceite mútuo) [V]; NoCountry monta time por papel [V]; lablab card "join" [V] | board commodity; curado/por papel diferencial |
| Pós-hackathon | Colosseum Eternal (4 semanas, vídeo semanal, US$25k) + Accelerator [V]; lablab League com pontos entre eventos [V] | funil contínuo diferencial |
| Ao vivo | lablab Twitch [V]; AI Tinkerers demo sem slide [V] | commodity/cultura |
| Voto do público | Devfolio voto quadrático + EAS [V]; DoraHacks MACI [I] | anti-sybil é o diferencial |
| Anti-fraude | Hack Club Hackatime + Fraud Squad [V]; ETHGlobal commit history [V] | pacote integrado raro |
| No-show | Devfolio stake reembolsável [V] | diferencial em evento grátis |
| Reputação | Devfolio credenciais on-chain [V]; NoCountry notas de soft skill pra empresa (premium) [V] | modelo de negócio do NoCountry |
| IA | Colosseum Copilot (8.000+ submissões) [V]; DoraHacks BUIDL AI [I] | ninguém tem IA auditável no julgamento |

Os 5 pedidos: **AI Tinkerers** (curadoria + intro quente, demo sem slide; ver 034) · **Colosseum** (5 semanas, 2 vídeos, Eternal, Accelerator, matching curado, Copilot — projeto continua depois) · **Devpost** (completo, julgamento rudimentar, força é o portfólio de uma década) · **lablab** (Twitch, mentor sob demanda, League com pontos, payout em até 90 dias; modelo "sponsor de API paga") · **NoCountry** (time montado por papel, sprints com entregas, desafio real de empresa, peer review, Demo Day, empresa paga pelo perfil validado; página de time mostrou "Entregables (0)" com notas — vende o rótulo, não a prova [V]).

## Top 12 gaps (impacto ↓)
1. Submissão de verdade (prazo, rascunho→enviado→travado, snapshot, checklist, lembretes) — M — ETHGlobal/Devpost. *(frente G)*
2. Declaração de pré-existente + verificação de commits no período (sinaliza, não desclassifica) + uso de IA — M — ETHGlobal/Hack Club.
3. Desafios de sponsor ligados ao projeto com julgamento próprio + campo "feedback pro sponsor" — M — ETHGlobal/Devfolio. *(parte na frente G)*
4. Painel/relatório do patrocinador (funil, uso da stack, talentos opt-in) — M — ninguém expõe; é o produto pago.
5. Feedback do júri devolvido ao time (anônimo, notas vs média) — P — lacuna do mercado.
6. Voto popular à prova de fraude (check-in, janela, orçamento, log) — P/M. *(frente F)*
7. Rodadas + normalização exibida lado a lado + resultado auditável — M — ETHGlobal/Gavel/VERDICT.
8. Formação de time por papel com aceite mútuo — M — Colosseum/NoCountry/lablab.
9. Continuidade pós-hackathon (temporada de 4 semanas com update semanal, liga entre edições) — M/G — Colosseum/lablab.
10. Confirmação de presença anti no-show (D-3, libera pra fila; caução Pix depois) — P — Devfolio.
11. Evidência pra recrutador com prova (peer review agregado N≥3 ao lado do artefato, pedido de intro com opt-in) — M/G — NoCountry/AI Tinkerers Talent.
12. Galeria com campos estruturados, badges de prêmio e filtros por stack/desafio — P — Devpost/ETHGlobal.

## Não copiar
Token/NFT/SBT/voto on-chain · IA dando nota ou escolhendo vencedor (só sinalizar e resumir) · time-tracking invasivo/proctoring · XP por like (o PRD dá +5 por like — farm) · voto popular decidindo prêmio principal · soft skill como nota única sem artefato · referral por pontos · competir em volume com Devpost/lablab · hackathon de 5 semanas pra universitário.

## Diferenciais possíveis no Brasil [I]
1. **Dossiê de evidência do projeto:** snapshot travado + linha do tempo de commits vs horário do evento + declaração + notas por critério + feedback + certificados — numa URL verificável.
2. **Relatório de sponsor/universidade automático em português:** funil, uso da stack, talentos opt-in, feedback do SDK, fotos, campeões; pra universidade, métricas de extensão.
3. **Horas complementares/extensão automáticas:** carga horária do check-in + entrega, verificação pela secretaria, export em lote (validar com 2–3 coordenadores antes).

Fontes: colosseum.com/eternal, blog.colosseum.com (submission, cofounder-matching), ethglobal.com/rules e /events/lisbon2026/prizes, help.devpost.com (judging), guide.devfolio.co (judging, quadratic-voting, onchain-credentials), devfolio.co/blog/staking-for-ethindia-2022-explained, lablab.ai/guidelines e AMD AI League, nocountry.tech (home, talent, casos-de-exito), Forbes AR, readme.hackclub.com/ysws, fraud.hackclub.com/fairplay, anishathalye.com (Gavel), dev.to VERDICT.
