# Modo palco — a final ao vivo (spec 033, frente F)

**Pedido**: "um mecanismo de votos públicos ao vivo… pensa como a gente deixa
essa porra foda de verdade".

## O que é

A final de uma edição roda inteira pelo HackaHub:

- **Controle** `/admin/h/[id]/palco` (organizador e staff, do celular): monta
  a fila dos pitches (times com projeto), próximo/anterior, toca num time pra
  pôr no palco, cronômetro (iniciar/pausar/zerar, 2–10 min), abre/fecha a
  votação do pitch atual, encerra a final (e desfaz, se apertou sem querer).
  Vê o ranking parcial; o público não.
- **Telão** `/h/[id]/telao` (público, tela cheia com `F`): projeto no palco,
  cronômetro VT323 gigante (âmbar nos últimos 30s, laranja e `+00:12` quando
  estoura), QR pra `/h/[id]/votar`, placar ao vivo do pitch (média + barras
  por nota) e, no fim, o ranking revelado de baixo pra cima.
- **Votar** `/h/[id]/votar` (celular, via QR): nota 1–5 no pitch do palco.
- Página da edição mostra a chamada "FINAL AO VIVO → votar" enquanto a final
  está no ar; a ficha do projeto `/p/[teamId]` ganha o selo "escolha do
  público na final" depois de encerrada.

## Regras

- **Só vota quem fez check-in** na edição (inscrição aprovada + presença).
- Integrante não vota no próprio time.
- Um voto por pessoa por pitch, **editável** enquanto a votação daquele pitch
  está aberta. Fechou (ou o pitch saiu do palco) → 409. O INSERT é
  condicionado ao estado da sessão no mesmo comando: voto atrasado não entra.
- Trocar de pitch fecha a votação e zera o cronômetro.
- Cada ação do controle leva `from` (o time que a tela via): duplo toque ou
  dois operadores viram 409 "o palco já mudou", nunca pitch pulado.
- Rate limit `stage-vote`: 120/h por membro.

## Decisões

**Nota 1–5, não estrela simples.** Com "curti" o placar mede quanta gente
estava na sala em cada pitch (o primeiro pega a plateia chegando, o último a
plateia indo embora). Com nota, o ranking é pela **média** e cada pitch é
julgado por quem o viu; a quantidade de votos aparece do lado.

**Empate visível.** Média arredondada em 2 casas (o que aparece na tela é o
que decide). Mesma média = mesma posição (1, 1, 3) e selo EMPATE. Sem
desempate escondido: quem desempata é a organização, na frente de todo mundo.

**Separado do voto popular (spec 025), não soma nem substitui.** O 025 é um
toggle aberto a qualquer membro logado, assíncrono, pra sempre; o voto ao vivo
é nota 1–5 de quem estava presente, num intervalo de minutos. Somar misturaria
unidade e população diferentes. Na ficha do projeto, os dois aparecem lado a
lado: "▲ N · escolha do povo" (comunidade) e "escolha do público na final ·
1º de 8 · média 4,6/5 · 32 votos de quem estava na sala". O pódio continua
sendo do júri (US5).

**Resultado só no fim.** O snapshot público não traz ranking até a final ser
encerrada — o suspense da revelação é parte do show. O placar do pitch atual
é ao vivo.

## Tempo real

- Estado 100% no banco (migration `009_live_stage.sql`): restart no meio da
  final não perde nada.
- `GET /api/hackathons/[id]/stage/stream` — SSE sem lib: evento `stage`
  (snapshot completo) na conexão e a cada mudança, `ping` a cada 15s,
  `retry: 3000`, conexão reciclada a cada 10 min, padding de 2KB (Safari).
  Headers `Cache-Control: no-cache, no-transform` (a compressão do
  `next start` não segura bytes) e `X-Accel-Buffering: no`.
- Um poller por edição por processo (1 query/s), repartido entre as conexões:
  300 celulares abertos = 1 query/s, não 300.
- Cliente: EventSource com watchdog de 40s; 3 falhas seguidas → polling do
  `GET /api/hackathons/[id]/stage` a cada 3s, tentando SSE de novo a cada
  minuto. Cronômetro ancorado no relógio monotônico do aparelho
  (`remainingMs` do servidor), então relógio errado no telão não importa.

## APIs

| rota | quem | códigos |
| --- | --- | --- |
| `GET /api/hackathons/[id]/stage` | público | 200, 404 |
| `GET /api/hackathons/[id]/stage/stream` | público | 200 text/event-stream, 404 |
| `GET/POST /api/hackathons/[id]/stage/vote` | logado | 401, 404, 429, 400, 403 (sem check-in / próprio time), 409 (fechada / pitch saiu), 200 |
| `GET/POST /api/admin/hackathons/[id]/stage` | organizador/staff | 401, 404, 403, 400 (ação inválida), 409 (transição impossível), 200 |

Ações do POST de controle: `queue {teamIds}`, `next/prev {from}`,
`goto {teamId}`, `timer-start`, `timer-pause`, `timer-reset`,
`pitch-seconds {seconds}`, `voting-open`, `voting-close`, `end`, `reopen`.
