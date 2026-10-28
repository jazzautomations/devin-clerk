# Estudo: gamificação do HackaHub

Pesquisa e desenho de 28/10/2026, com o código atual lido. Fontes: Stack
Overflow (privilégios, teto diário de 200 rep, reversão de voto em série,
Anderson et al. WWW'13), GitHub (achievements; fim da streak em 2016, Moldon et
al.), Duolingo (streak freeze, ansiedade das ligas), Reddit (karma farming),
Hack Club High Seas (horas só valem com entrega revisada + antifraude), MLH
(liga normalizada por tamanho), Kaggle (tiers), Colosseum, Strava (Local
Legend), Orkut (depoimento aceito), Pokémon GO (amizade 1×/dia), Tamagotchi e
Habitica (punição contraproducente), Deci/Koestner/Ryan 1999 (overjustification),
Hamari 2014, estudos de leaderboard.

## Estado atual (furos de farm)

- `lib/game.ts`: XP por post 10, comentário 5, curtida recebida 5, inscrição 50,
  identidade 25, teamBoard 10, teamSubmit 15. Níveis novato 0, hacker 50,
  veterano 150, elite 400, lenda 1000. 8 badges.
- `lib/xp.ts`: `awardXp` só incrementa `members.xp` (sem histórico).
- Furos:
  1. curtir, descurtir e curtir de novo paga +5 toda vez (`lib/posts.ts` toggleLike +
     `app/api/posts/[id]/like/route.ts`);
  2. `teamSubmit` paga em cada POST do time
     (`app/api/hackathons/[id]/team/route.ts`);
  3. post e comentário sem teto;
  4. carta e +50 saem na inscrição, não na presença (`completeRegistration`);
  5. sem ledger, nada auditável nem reversível;
  6. badges fracos (`pioneiro` id ≤ 50, `influente` por curtida, `organizador` = admin);
  7. `/membros` ordena por XP de sempre com pódio dourado.
- `lib/momentum.ts` não é usado em nenhuma tela.
- Reaproveitáveis: `lib/arena.ts` (`editionPhase`), `lib/votes.ts` (voto com
  dedupe e sem voto no próprio time), `lib/stage.ts` (`voterStatus` = humano com
  check-in), `checkins`, `prize_winners`/`jury_results`, `project_submissions`,
  `edition_roles`, `team_invites`, `lib/dossier.ts`, `lib/crachas.ts`,
  `registration_rewards` (molde de idempotência).

## Princípios

1. Só pontua evidência que outra pessoa ou o sistema atesta (staff no check-in,
   júri, autor que aceita, colega que confirma).
2. Paga uma vez por fonte (chave única), com teto diário e revogação.
3. Recompensa simbólica e informativa, nunca tangível.
4. Comparar consigo mesmo e com quem está no mesmo estágio.
5. Nada pune quem some.

## Rep (ledger)

`rep_events(id, memberId, kind, sourceType, sourceId, amount, grantedBy,
createdAt, revokedAt)` com `UNIQUE(memberId, kind, sourceType, sourceId)`.
`members.xp` vira cache de `SUM(amount) WHERE revokedAt IS NULL`.
`grantRep()` é idempotente. O saldo antigo vira um evento `legacy` ("rep antes
da temporada 1").

| Ação | Rep | Evidência | Única por |
|---|---|---|---|
| Check-in no evento | +40 | `checkins` | membro, edição |
| Inscrição | 0 | | |
| Time formado (≥2, convites aceitos, todos com check-in) | +15 | teams + invites + checkins | membro, edição |
| Projeto entregue no prazo | +60 | `project_submissions` | membro, edição |
| Pódio do júri | +100 / 70 / 50 | `prize_winners` publicado | membro, categoria |
| Escolha do público com quórum | +30 | `getAudienceResult` | membro, edição |
| Resposta aceita em tópico | +25 | o autor do tópico aceita | membro, resposta |
| Voto positivo em resposta | +5, máx. 50/dia | eleitor com ≥15 rep e ≥1 check-in | membro, voto |
| Mentoria confirmada | +20 por time, máx. 5/edição | mentor + o time clica "me ajudou" | mentor, time |
| Depoimento aceito | +5 pra quem escreveu, máx. 3/semana | o destinatário aprova | autor, destinatário |
| Organizar edição concluída com ≥15 check-ins | +80 | `edition_roles` + `editionPhase` ended | membro, edição |
| Post, comentário, curtida | 0 | | |

Anti-farm:

- Só vota humano verificado: ≥1 check-in na vida e conta com mais de 7 dias.
- Voto de colega do mesmo time na temporada não dá rep.
- Desfazer revoga (`revokedAt`).
- Cron noturno de voto em série: um par A→B com mais de 30% dos votos recebidos
  por B na semana é revogado e vai pro admin.

## Pet

A rep mede a obra; o pet mede gente e presença. O pet nunca morre nem encolhe:
se você some, ele dorme e acorda quando você volta. A criação leva 30 segundos
no onboarding, escolhendo espécie e paleta.

O estágio é uma função pura das contagens:

| Estágio | Condição |
|---|---|
| Ovo | conta criada |
| Filhote | 1º check-in |
| Jovem | 1º projeto entregue |
| Adulto | 3 edições com check-in e ≥1 entrega |
| Ancião | 8 edições, ≥5 times mentorados ou 2 edições organizadas |

Acessórios por evidência, cada um com link:

- louro: pódio;
- óculos: mentoria;
- cachecol da comunidade: check-in em edição da própria comunidade;
- mochila com patch: outra cidade;
- pin da edição: carta, agora mintada no check-in;
- capacete de solda: demo no ar;
- bandeirinha: escolha do povo;
- laços: encontros (alcance = tamanho, profundidade = brilho).

Encontros: `encounters(hackathonId, aId, bId, createdAt, confirmedAt, depth)`.

- Só valem com os dois de check-in na mesma edição em andamento. Um mostra o
  código ou QR do pet, o outro digita ou escaneia, e o primeiro confirma.
- Um por par por edição, no máximo 40 por dia.
- `depth` sobe quando o par vira time, troca depoimento ou um mentora o outro.
- Encontro dá 0 rep e só alimenta o pet.
- No fim, a tela "quem você conheceu" com consentimento de contato.

Onde o pet aparece: hero do `/u`, miniatura no feed, "bando" no card do time,
telão do palco, crachá PDF, OG do perfil.

Render: partes em JSON de voxel; uma função pura gera SVG isométrico (serve pra
SSR, OG e PDF); three.js só no perfil e no criador. O pet não tem loja.

## Selos (bronze, prata, ouro, com "por quê" linkado)

- Pé na estrada: 2 / 5 / 10 cidades.
- Entregou: 1 / 3 / 10 projetos.
- Do zero: entregou no primeiro hackathon.
- Ponte: time com gente de outra comunidade ou área, 1 / 3 / 10.
- Bússola: 1 / 10 / 50 respostas aceitas.
- Farol: 3 / 10 / 30 times mentorados.
- Anfitrião: edição organizada com 30 / 100 / 300 check-ins.
- Quebra-gelo: 10 / 50 / 150 pessoas encontradas.
- Voltou: check-in depois de 6 meses fora.
- Escolha do povo.

Ajustes nos atuais: `influente` vira legado; `colecionador`, `debut` e
`veterano` contam check-in; `organizador` vem de `edition_roles` em edição
concluída.

## Privilégios (rep e fato físico)

| Rep | Libera |
|---|---|
| 0 | postar, comentar, entrar e seguir, criar tópico |
| 15 + 1 check-in | votar em tópico e resposta, pôr link no post |
| 50 | sinalizar com peso 2, voto negativo em resposta |
| 150 + 1 check-in | escrever depoimento |
| 300 | editar flair e tags, marcar duplicata |
| 500 + 2 edições | candidatar-se a mentor |
| 750 + 30 dias na comunidade | pode ser indicado a moderador de tópico (o dono confirma) |
| 2000 | revisor da fila global de denúncias |

Criar comunidade exige só 1 check-in na vida. Os nomes dos níveis ficam, com os
limiares recalibrados.

## Temporada

- **Temporada:** semestre letivo (mar–jul, ago–dez). "Rep da temporada" é um
  filtro do ledger.
- **Copa das Comunidades** (modelo MLH): participação = check-ins normalizados
  por √membros, com piso; mérito = pódios e entregas. Divisões por tamanho
  (≤50, ≤300, >300). Página `/temporada`.
- **Copa das Cidades:** a mesma conta, por cidade (`regions.ts`).
- **Lenda local:** quem mais fez check-in na comunidade em 90 dias.
- **Semanas construindo:** a semana conta com entrega, devlog com link de
  commit ou deploy, resposta aceita ou commit no repo do projeto. O contador é
  cumulativo na temporada e nunca zera; a sequência visual tem 2 folgas por mês
  e não manda notificação de culpa.
- **Sorte do dia hacker:** hash(data + memberId) gera uma sugestão concreta
  ("3 tópicos sem resposta em #ia"). Vale 0 rep, só confete no pet.
- **Bingo do evento:** cartela 3×3 validada pelos encontros (outra área, outra
  cidade, mentor, patrocinador). Completar dá um acessório raro.

## Ranking justo

- `/membros` abre na temporada; "de sempre" fica numa aba sem pódio dourado.
- Ligas por estágio do pet e quadro de estreantes.
- Mostra faixa ou percentil, não "#847".
- O padrão é "você nesta temporada contra a passada"; o ranking é opt-in, sem
  rebaixamento.

## Não fazer

- IA dando nota.
- Token ou NFT.
- Decaimento de rep, pet morrendo ou notificação de culpa.
- Ponto por volume.
- Prêmio físico ou dinheiro por rep.
- Avaliação anônima de pessoas.
- Ranking geral como tela padrão.
- Streak diária punitiva.
- Pagar algo que o usuário escreve sem terceiro atestar.

## Fases sugeridas

- **F0:** fechar furos. Ledger com backfill legacy; XP de post, comentário e
  curtida zerado; teamSubmit 1×/edição; +50 e carta no check-in; `/membros` na
  temporada.
- **F1:** pet MVP (espécie, estágios, SVG no perfil, crachá e OG, 5 acessórios).
- **F2:** evento vivo (encontros, bingo, "quem você conheceu", pets no time e no
  telão).
- **F3:** tópicos estilo Reddit com voto, aceite, teto e privilégios.
- **F4:** temporada (copas, lenda local, semanas construindo, ligas).
- **F5:** laços (depoimentos, mentoria confirmada, selos Farol, Ponte e Voltou).
