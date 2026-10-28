# Estudo: como o HackaHub conecta pessoas

Pesquisa de 28/10/2026, com o código lido e o bundle do quebra-gelo inspecionado.
Fontes: Brella, Grip, Swapcard, Donut, Lunchclub, Hinge (prompts: +47% de
virar encontro do que like em foto), Bumble For Friends, Luma, MLH (código de
conduta), Colosseum, Devpost team-up, Hack Club, Boothby 2018 (liking gap),
Epley & Schroeder 2014, Casciaro/Gino/Kouchaki 2014 (networking instrumental
"suja"), Aron 1997, Huang 2017, Nolte (diversidade de skills; um mentor por time
de iniciante), Ensono 2020 (29% das mulheres em evento tech sofreram assédio),
LGPD art. 7º, 8º e 18.

## Quebra-gelo por dentro (complementa a spec 042)

- **Código e QR:** 4 letras por pet; o QR aponta pra `/?c=CODIGO`. Basta um
  lado ler; o outro descobre por polling de `/api/eu` a cada 2 s. Não há
  aceite, rotação de código nem checagem de lugar.
- **Chips de criação:** área, procura e oferece, de lista fechada.
- **Finais:** o jogo pune quem só coleciona contato (Colecionador de Crachás).
- **Academia:** diagnóstico de 5 situações em abordar, escutar e conectar, que
  monta a trilha pela habilidade mais fraca.
- **O que muda no HackaHub:** aqui o encontro vira rede permanente, dá XP e
  pode virar convite de time. Por isso precisa de **aceite dos dois**.

## O que já existe e o que falta

- **Reaproveitar:**
  - `members.personas`, `skills`, `openTo`, `city`, `institution`;
  - `looking_for_team` (need, skills, note);
  - times e `team_invites` (`inviteToTeam`, `respondInvite`,
    `classifyInvitees`, `assertFormationOpen`);
  - `checkins`;
  - `offlineCheckin` e `checkinPack` (padrão de fila offline);
  - `sponsorContacts` (molde de consentimento com prévia, revogável, perfil
    lido ao vivo);
  - `notify`, `incidents` + `edition_conduct_handlers`, `community_reports`,
    `privacy.ts`;
  - `follows` e `communityAudience`.
- **Não usar o QR do ingresso pra encontro:** ele é a credencial de presença
  (token HMAC `HH1.`).
- **Faltam:**
  - DM;
  - bloquear pessoa;
  - denúncia de pessoa fora de evento;
  - prompts no perfil;
  - qualquer registro de encontro.
- **Conflito:** a plataforma é 18+, mas o código ainda tem `ageAtEvent`,
  responsável e `isMinorAtEdition`. O módulo de conexão exige 18+ comprovado,
  checado numa função única `canNetwork(memberId, hackathonId)`.

## Desenho

### Encontro verificado no evento

- **Pré-requisitos:** inscrição aprovada, check-in feito, 18+ e o aceite
  próprio de "Encontros na edição". O aceite mostra o que o outro vai ver:
  nome, @, personas, skills, cidade ou instituição e o canal que você escolher
  (LinkedIn, GitHub ou e-mail).
- **Tela `/h/[id]/encontros`:**
  - QR de encontro próprio, `https://hackahub…/e/<code>`;
  - código de 5 caracteres, sem 0, O, 1 e I;
  - câmera e campo pra digitar;
  - no crachá impresso, um 2º QR pequeno com o código e a faixa "encontro".
- **Fluxo:**
  1. A lê o código de B. O encontro fica `pending` e A vê o cartão de B, sem o
     contato.
  2. B recebe "@ana quer registrar o encontro" e escolhe Confirmar ou Agora
     não. Ler o QR de A também confirma.
  3. Confirmado, os dois veem "Como foi a conversa?" e o contato aparece.
  4. Recusado ou expirado (15 min), A vê "não rolou dessa vez", sem motivo.
- **Contexto gravado:** zona opcional definida pelo organizador (nunca GPS),
  horário arredondado em 15 min, a carta usada e uma nota privada de até 280
  caracteres.
- **Offline:** fila local, no padrão do `offlineCheckin`; o horário fica preso
  à janela do evento.
- **Dados:**
  - `edition_meet_codes(hackathonId, memberId, code, optedInAt, pausedAt)`,
    UNIQUE `(hackathonId, code)`; regenerar o código invalida o antigo;
  - `encounters(id, hackathonId, lowId, highId, initiatorId,
    status pending|confirmed|declined|expired, zone, createdAt, confirmedAt)`,
    UNIQUE `(hackathonId, lowId, highId)`;
  - `encounter_sides(encounterId, memberId, cardKey, depth ampla|funda|null,
    note, hiddenAt)`.
- **Anti-abuso:**
  - rate limit de 30/h e no máximo 5 pendentes;
  - código inválido, bloqueado ou pausado dá a mesma resposta genérica;
  - a recusa não notifica quem pediu;
  - 3 recusas pro mesmo alvo travam o par na edição;
  - os dois precisam ter check-in na mesma edição.

### Cartas, prompts e missões

- **Cartas** (`lib/icebreakers.ts`):
  - abrir: "Que stack você usaria pra um app em 24h?", "O que te trouxe nesse
    hackathon?", "Qual desafio você tá de olho?";
  - funda: "Pior bug da sua vida?", "A ideia maluca que não sai da cabeça?",
    "O que você quer aprender até domingo?", "Qual problema da sua faculdade
    ou cidade você resolveria?";
  - time: "Se o time fosse nós dois, o que falta?", "Você prefere ideia própria
    ou entrar na de alguém?".
- **Papo rápido × além do oi:** depois do encontro, cada lado marca "papo
  rápido" ou "fomos além do oi". **Profundidade só conta se OS DOIS marcarem
  "além do oi".**
- **Prompts no perfil** (até 3, 150 caracteres): "Tô procurando time que…",
  "Topo aprender…", "A ideia que eu faria hoje…", "Me chama pra falar de…",
  "Meu primeiro hackathon foi / vai ser…". Pedido de intro ou de "bora" cita um
  prompt ou uma carta; não existe pedido em branco. Tabela
  `profile_prompts(memberId, promptKey, answer, updatedAt)`.
- **Missões** (`lib/missions.ts`, o organizador liga por edição). O servidor
  verifica pelo perfil do outro no encontro confirmado:

  | Missão | Verificação |
  |---|---|
  | Outra área | personas sem interseção |
  | Oferece o que você procura | `openTo` e skills do outro contra a `need` do seu anúncio de time |
  | Primeira viagem | 0 inscrições aprovadas antes, com opt-in "pode me mostrar como estreante" |
  | Design ou dados | persona contém a chave |
  | Outra faculdade ou cidade | o valor nunca é revelado |
  | Um mentor | `edition_roles` mentor |
  | Ponte | "apresentei X a Y" conta quando X e Y confirmam encontro entre si depois |
  | Reencontro antes do pitch | 2º registro com alguém já confirmado, na última janela da agenda |

  Tabelas `mission_progress` e `introductions`.
- **Academia** (abordar, escutar, conectar): trilha opcional pré-evento no
  `/bem-vindo` ou no e-mail D-1. Dá 0 XP.

### Do encontro ao time

- **Selo de complemento** com frase fixa, sem IA ("você é dev, ela é design;
  seu time procura design"), calculado de personas e skills contra a `need`. A
  `need` do anúncio do outro aparece no cartão.
- **"Bora fazer junto?":** sinal mútuo e silencioso, tabela `team_up_signals`.
  Quando os dois marcam:
  - um tem time com vaga: `inviteToTeam` preenchido;
  - nenhum tem time: `submitTeam` já com o outro, o que vira convite;
  - os dois têm time: fica a conexão.
- **"Procure no evento":** 3 pessoas por missão, só entre quem fez check-in,
  ativou Encontros e não tem time. Nunca diz onde a pessoa está.

### Fora do evento

- **Intros quinzenais (Donut):**
  - opt-in, escopo de uma comunidade que você segue ou da sua cidade, cron de
    segunda às 10h, pares por complemento;
  - nunca repete dupla nem pareia bloqueado;
  - o canal só é revelado quando os dois dizem "quero";
  - uma semana depois o app pergunta "rolou?";
  - 3 intros ignoradas pausam sozinhas; dá pra pausar 2, 4 ou 8 semanas;
  - tabelas `intro_prefs` e `intros`.
- **Quem vai (Luma):** em `/h/[id]`, "3 pessoas que você já conheceu vão",
  só com conexão confirmada e `publicListing` ligado. O público vê só a
  contagem.
- **Mentor e iniciante:** mentor com `openTo` mentoria e mais de 2 edições,
  pareado com estreante que pediu mentor; no máximo 1 par por mês por mentor.

### Privacidade e anti-assédio

- **Três aceites separados e revogáveis:** encontros na edição, intros, e
  "mostrar-me como estreante". Entram no export e no delete.
- **"Quem eu conheci" é privada:** sem grafo público e sem "amigos em comum".
- **Bloquear** (`member_blocks`): o código deixa de funcionar e devolve a
  resposta genérica; os dois somem de sugestões, intros, "quem vai" e convites
  de time; pendentes são cancelados; o bloqueado não é avisado.
- **Denunciar:** em evento vai pra `incidents` com o `encounterId`; fora dele
  vai pra `member_reports`. Denunciar já bloqueia.
- **Localização:** sem GPS, sem "perto de você", sem horário exato público.
- **Contato:** lido do perfil na hora, nunca copiado.

### XP e pet (sem farm)

- **XP:**
  - encontro confirmado +10, uma vez por par na vida, máx. 8 por dia;
  - "além do oi" mútuo +10;
  - reencontro em outra edição +5;
  - missão +15;
  - ponte +20;
  - intro que rolou +10;
  - time formado com quem conheceu na edição +25.

  **Pendente de conciliar com a spec 043**, em que encontro dá 0 rep e só
  alimenta o pet.
- **Selos:** quebra-gelo (10 pessoas), ponte (3 apresentações), time de
  corredor, guia (3 encontros fundos com estreantes, sendo veterano).
- **Pet:** alcance (pessoas distintas) × profundidade (encontros fundos mútuos,
  pontes, time). Recap da edição com arquétipo; profundidade pesa mais. Tabela
  `edition_pets`. Não há ranking de encontros.
- **Fraude:** mais de 6 confirmações em 5 min ou o mesmo par confirmando em
  várias edições sem check-in viram flag e congelam o XP.
- **Feed:** nada postado automaticamente. Recap compartilhável só com números e
  quem deu ok.

## Fases

1. **MVP pra próxima edição presencial:** códigos, encontros com confirmação
   dupla, "quem eu conheci", 6 cartas, XP de encontro, bloquear e denunciar,
   18+, rate limit, LGPD e código no crachá.
2. **Missões e time:** missões, "bora fazer junto", selo de complemento, pet
   (alcance × profundidade) com recap, fila offline.
3. **Perfil e fora do evento:** prompts, quem vai, intros, `member_reports`.
4. **Refino:** mentor e iniciante, academia, rotação de código, detecção de
   fraude, card de recap.

Decisão em aberto: 18+ na plataforma inteira (remover o fluxo de responsável)
ou só no módulo de conexão.
