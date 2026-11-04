# Estudo: Orkut → HackaHub

Pesquisa de 28/10/2026 (3 pesquisadores + tradução). Inspiração, não cópia.


---

<!-- seção: Tradução pro HackaHub -->

# Orkut → HackaHub: o que trazer, o que deixar e por quê

Li o repo antes de escrever. O HackaHub já tem `community_members` (papéis dono/organizador/membro), `community_follows`, `community_reports` com os flags `hidden` e `verified`, `posts` com escopo (`hackathonId` ou `communityId`), `member_badges` e `BADGES` em `lib/game.ts`, `team_members` (ligado por **username**), `edition_roles` (mentor e jurado), `certificates.kind` (com mentoria), `checkins`, `teams.placement`, `finalist`, `prize_winners`, `project_dossiers`, `notify()`, `RATE_LIMITS` e o `lib/privacy.ts`, que acha sozinho as FKs pra `members`.

Ainda não existem:
- seguir **pessoa**;
- denúncia de post, comentário ou perfil (só existe denúncia de comunidade);
- bloquear alguém;
- tópicos (o mural é uma lista corrida);
- comunidades no `/u` (a página nem importa `lib/communities`);
- tipo de comunidade.

## 0. Base antes de tudo (onda 0)
- **`lib/evidence.ts`**: um módulo só de consultas sobre o que aconteceu de verdade. Cobre fez time junto (`team_members` × `teams`), presença (`checkins`), entrega (`team_projects`/`project_submissions`), pódio (`placement` 1–3, `prize_winners`), mentoria ou júri (`edition_roles` + `certificates`), organização (`hackathons.communityId` publicado + papel na comunidade) e commits durante o evento (`project_dossiers`). Selo, depoimento, recado, aniversário e pet leem daqui. Sem tabela de pontuação nova, então os números não descolam do registro.
- **Denúncia genérica**: tabela `reports(targetType post|comment|recado|depoimento|member|community, targetId, reporterId, reason, createdAt, resolvedAt, resolvedBy)`. Ela entra na fila do `/admin`, que hoje só lista comunidade. O rate limit reaproveita o padrão `community-report` (5/h).
- **Bloqueio**: `member_blocks(memberId, blockedId)`. Quem foi bloqueado não manda recado, depoimento nem "quero fazer time" pra quem bloqueou, e não vê o perfil dessa pessoa.
- **LGPD**: o `privacy.ts` só apaga linhas cuja coluna seja `memberId` ou `judgeMemberId`. As tabelas novas que têm autor diferente do dono precisam entrar no `OWNER_COLUMNS` com a coluna `authorId`. Assim, se qualquer um dos dois lados apagar a conta, o texto some. Sem isso, um depoimento de quem saiu continua no ar, preso a uma linha anonimizada.

## 1. O que vale trazer

### 1.1 Comunidade no perfil como crachá, incluindo a comunidade-meme (P0, custo baixo)
É o que mais pesava no Orkut e o que mais falta aqui.
- **Dados**:
  - `communities.kind TEXT CHECK IN ('grupo','identidade') DEFAULT 'grupo'`. A de identidade não tem hackathon, apoio nem aviso, só membros e, depois, tópicos.
  - `communities.sensitive INT DEFAULT 0`.
  - `community_members.showOnProfile INT DEFAULT 1` e `profilePosition INT`.
- **Rotas**:
  - `/u/[username]` ganha a seção "Comunidades": grade de 9 (como no Orkut) mais "ver todas".
  - `PATCH /api/members/me/communities` define ordem e visibilidade.
  - Criar continua em `/comunidades/nova`, agora com a escolha de tipo.
- **Entrar numa comunidade de identidade não coloca nada no `/feed`.** Ela é um adesivo, não uma assinatura. Assim o feed "minhas comunidades" não vira barulho.
- **Permissões e anti-abuso**:
  - pra criar, conta com mais de 7 dias **ou** pelo menos 1 check-in **ou** GitHub preenchido;
  - continua o limite de 3 por dia;
  - comunidade de identidade nova entra numa fila "novas" no `/admin` (igual a "hackathons novos") e pode ser escondida com o `hidden` que já existe.
- **LGPD**: comunidade marcada como `sensitive` (religião, orientação, saúde, política, todos dados sensíveis pelo art. 5º II) nasce com `showOnProfile=0`, e a lista de membros fica visível só pra membros.
- **Lançamento**: semear umas 12 comunidades escritas por nós no formato clássico "Eu…". Exemplos: "Eu já dormi no pufe do hackathon", "Eu faço deploy sexta 18h", "Funciona na minha máquina", "Eu leio o regulamento inteiro", "Meu pitch passou do tempo". Nada que ataque ferramenta.
- **Estado vazio**: "Você ainda não tem comunidade no perfil. Tem umas que são a sua cara", seguido de 3 sugestões. O `CommunitySuggestions` já existe.

### 1.2 Depoimento de time (P0, custo baixo, é a aposta)
- **Tabela `testimonials`**:
  - `id`, `memberId` (quem recebe), `authorId`, `hackathonId`, `teamId` (opcional);
  - `relation` (`colega` ou `mentor`);
  - `body` (até 600 caracteres, texto puro);
  - `status` (`pending`, `accepted` ou `declined`), `position`, `createdAt`, `decidedAt`, `editedAt`;
  - `UNIQUE(authorId, memberId, hackathonId)`.
- **Quem pode escrever**:
  - colega do mesmo time numa edição que já começou (`team_members` cruzado por username com `members`);
  - mentor da edição (`edition_roles`) pra quem fez check-in nela;
  - jurado não escreve, porque seria conflito.
- **Rotas**:
  - `POST /api/members/[username]/testimonials`;
  - `PATCH /api/testimonials/[id]` pelo dono (aceitar, recusar, ordenar);
  - `PATCH` ou `DELETE` pelo autor (editar ou retirar);
  - a caixa de pendentes fica em `/perfil/depoimentos`.
- **Regras**:
  - o pendente só o dono vê;
  - a recusa é silenciosa, e o autor continua vendo "enviado";
  - **depoimento aceito que for editado volta pra pendente**, pra ninguém trocar o texto depois de aprovado;
  - ao aceitar, o app sugere uma vez "Quer escrever sobre @x também?". É a reciprocidade do Orkut sem cobrança.
- **Anti-spam**: 5 por dia. Como só colega de time pode escrever, o depoimento quase não serve de DM, que foi a gambiarra do Orkut.
  - O aviso "escreveu sobre você" sai uma vez por par a cada 30 dias. Apagar o recusado e reescrever não avisa de novo.
  - Aceitar leva o texto que a tela mostrou. Se o autor trocou no meio, dá 409 e a pessoa relê.
- **Edição fora da regra antifarm** (menos de 15 check-ins ou comunidade não verificada, `eligibleEdition` em `lib/evidence.ts`): o depoimento pode ser escrito e aparece no perfil, mas não entra na contagem (`countAccepted`), que é o número do `/talento`, do cartão e do bicho.
- **Moderação**: a denúncia vai pra organização da edição. Quem trata a denúncia, ou o admin, tira do ar pela fila (status `removido`). O dono não traz de volta e o autor não reescreve.
- **Onde aparece**: no `/u` só os aceitos. No `/talento`, a contagem e o primeiro trecho. No cartão de quem não está logado, só "3 depoimentos de time". Os aceitos ganham botão "denunciar".
- **Estado vazio**:
  - pro dono: "Depoimento aqui só vem de quem fez time com você." e a lista "Você fez time com @a e @b no X. Escreva sobre eles.";
  - pra visita: a seção some.
- **Reaproveita**: `notify()`, `rateLimit`, `Avatar`, `PublicCard`, `lib/archive` (`getMemberArc`) e o export/exclusão automáticos.

### 1.3 Selos por evidência no lugar das notas confiável/legal/sexy (P0, custo baixo)
- **Calculados na leitura** a partir do `lib/evidence.ts`, sem voto e sem IA:
  - **Apareceu**: N check-ins;
  - **Entregou**: N projetos entregues no prazo;
  - **Pódio**;
  - **Mentorou**;
  - **Julgou**;
  - **Organizou**;
  - **Commitou no evento**, vindo do dossiê.
- Cada selo leva a contagem e o link da prova (`/h/[id]`, `/p/[teamId]`).
- **O que mexer no que já existe**:
  - `influente` (10 curtidas) e `criador` (5 posts) medem vaidade; sairiam do destaque e iriam pra um "outros";
  - **bug**: o badge `organizador` é dado só quando `role === 'admin'`, ou seja, só ao admin global. Quem organiza pela comunidade nunca ganha.
- **Estado vazio**: "Selo aqui vem do que você fez em hackathon. O primeiro chega no check-in."

### 1.4 Recado no perfil (P1, custo baixo reaproveitando `posts`)
- **Dados**: em vez de criar tabela, adicionar `posts.profileId INT REFERENCES members` como mais um escopo do `PostScope`, mais um `CHECK` de que só um escopo vem preenchido. Ganha de graça apagar, comentar (que vira a resposta, um nível só), rate limit e moderação.
  - Curtida em recado fica desligada.
  - Diferente do Orkut, a resposta fica no mesmo mural e a conversa não se parte entre dois perfis.
- **Quem escreve** é configurado em `members.recadosFrom`:
  - `conexoes` (padrão): mesmo time, mesma edição com check-in, mesma comunidade de grupo ou encontro de pet;
  - `todos`;
  - `ninguem`.
- **Segurança, lição do worm de 2007**:
  - texto puro, até 280 caracteres;
  - **sem** `renderUserMarkdown`;
  - links com `rel="nofollow ugc noopener"` e o domínio à mostra.
- **Anti-corrente**:
  - 10 por hora, 1 por minuto pra mesma pessoa;
  - o mesmo texto mandado pra mais de 5 perfis em 1 hora é barrado.
- **Moderação**: o dono apaga qualquer recado, o autor apaga os dele, e tem denúncia e bloqueio.
- **Sem contador público de recados.** Aparecem só os últimos 10 e um "ver mais".
- **Notificação** agrupada ("3 recados novos").
- **Estado vazio**:
  - pro dono: "Quem fez time com você pode deixar recado aqui.";
  - pra visita: "Deixe o primeiro recado.".

### 1.5 "Quero fazer time com", a lista de paqueras sem romance (P1, custo médio)
- **Dados**: tabela `team_wishes(memberId, targetId, hackathonId, createdAt)`, limitada a 5 por edição.
- **Como funciona**: só existe dentro de uma edição com inscrição aberta e expira no `teamFormationDeadline`. Se os dois marcarem um ao outro, os dois recebem "@x também quer fazer time com você", com atalho pro `team_invites` que já existe.
- **Sigilo**: a marca é secreta e nunca aparece se for de um lado só. Isso tira o risco de rejeição, que era o motor do crush.
- **Reaproveita**: `looking_for_team` e `TeamBoardPanel`.

### 1.6 Aniversário de hackathon (P1, custo baixo)
- **Como funciona**: sem tabela. Uma consulta diária no cron (as rotas `/api/cron/*` já existem) procura edições que fazem N anos hoje e em que a pessoa teve check-in ou time.
- **Notificação**: uma por ano por edição. O card no `/dashboard` diz "Faz 1 ano do X. Você estava com @a, @b e @c.", com os botões "deixar recado pro time" e "escrever depoimento". Assim o aniversário puxa os itens 1.2 e 1.4.
- **Comunidade** também faz aniversário ("a X faz 1 ano") no feed dela.
- **Não** coletar data de nascimento, por minimização de dados.
- Dá pra desligar nas notificações.

### 1.7 Dica do dia no lugar da sorte do dia (P1, custo baixíssimo)
- **Conteúdo**: `content/dicas.json` com cerca de 150 frases escritas e revisadas por gente. `lib/dailyTip.ts` escolhe pelo hash da data em BRT, então **é a mesma pra todo mundo**, e isso vira assunto ("viu a de hoje?").
- **Três tipos de frase**:
  - dica curta ("README com GIF ganha jurado");
  - pergunta de quebra-gelo, que no dia de evento vira a pergunta do encontro de pet;
  - mini desafio.
- Aparece no topo do `/feed` e do `/dashboard`.
- Sem sequência de dias, sem cobrança e sem IA gerando ao vivo.

### 1.8 Seguir pessoa no lugar do fã (P2, custo baixo)
- **Dados**: `member_follows(memberId, targetId)`, com `targetId` também no `OWNER_COLUMNS`. Alimenta a aba "pessoas" do `/feed`, em ordem cronológica.
- **Visibilidade**: o número de seguidores só o dono vê. A visita vê "segue você" e "vocês fizeram time no X". Ninguém tem placar de popularidade.

### 1.9 Vitrine (P2, custo baixo)
Até 6 projetos fixados no topo do `/u`, saindo do `getMemberProjects`, guardados em `members.pinnedProjects` (JSON). É a ideia do álbum de 12 fotos do Orkut: pouco espaço obriga a escolher.

### 1.10 Fórum de tópicos na comunidade (P1, custo médio)
É o centro do Orkut e o maior buraco que temos hoje. Você já pediu tópicos no estilo Reddit no workflow de ondas, então aqui fica só o que o Orkut acrescenta, pra não duplicar a spec de lá:
- a comunidade de identidade também pode ter tópicos;
- enquete é um tipo de tópico;
- organizador pode fixar e trancar tópico;
- "evento" continua sendo os `communityHackathons` que já existem.

### 1.11 Visitantes recentes (P3, parqueado)
- **Membro vendo membro, não.** A terceira pesquisa ("nada de feature de vigiar") vence as duas primeiras aqui.
- **Se um dia tiver**, só a versão útil: "2 empresas viram seu perfil esta semana", agregado, vindo do `/talento` ou de patrocinador logado, com opt-in de quem é visto. Guardar um registro por dia e apagar com 30 dias no cron.

## 2. O que não trazer
- **HTML ou script em conteúdo de usuário.** O worm de 2007 nasceu de uma feature lançada dias antes. Recado e depoimento ficam em texto puro.
- **Nota anônima de pessoa** (confiável, legal, sexy ou qualquer variação como "explica bem"). Vira assédio, ninguém consegue contestar e é perfilamento sob a LGPD. Reputação aqui só vem de registro.
- **Contadores públicos de popularidade** (recados, fãs, seguidores). O Orkut virou disputa de placar e corrente de "bom dia".
- **Teto de amigos.** Gerou o "fulano 2".
- **Visitantes entre membros.** Era o "o ex visitou meu perfil": tensão, e não valor.
- **Comunidade sem dono ativo e moderação lenta.** O Orkut ficou com cerca de 90% do conteúdo investigado pelo MPF-SP e virou "terra sem lei". Por isso a denúncia genérica e a fila entram na onda 0, antes de qualquer conteúdo novo.
- **Convite como única porta de entrada.** Você já decidiu abrir o radar. Escassez trava rede pequena.
- **Feed por engajamento e "Promova".** Pagar pra ter alcance (a ideia anotada do César) foi a fase em que o Orkut virou cópia do Facebook. Se um dia existir, só o hackathon patrocinado no radar com o rótulo "patrocinado", nunca post de pessoa.
- **Apps de terceiros e temas com CSS livre.** Perfil pesado, spam e brecha de XSS.
- **Postar no LinkedIn e afins sem a pessoa mandar.** A integração mão única com o Google+ irritou todo mundo. Compartilhar continua manual, com o `ShareBar`.
- **Surfar o hype da petição com "o novo Orkut".** A marca é de terceiro, o próprio fundador está ativo e os clones (orkut.br, orkut.li, Hello) viraram curiosidade. Nostalgia traz download, não hábito.
- **Cair no dia do pico.** É o erro que o próprio fundador admite. A VPS é uma só. Antes de qualquer ação de divulgação, vale um teste de carga no `/u` e no `/comunidade`.

## 3. Ligação com o pet do Quebra-Gelo
No Quebra-Gelo o pet é voxel, cresce só com conversa real e o encontro acontece pelo QR do pet. No fim do dia a pessoa leva a lista de quem conheceu, medida em alcance e profundidade. Isso encaixa no Orkut pelo lado do BuddyPoke, que era o app mais usado lá.
- **Onde fica**: no cabeçalho do `/u`, ao lado do `Avatar`.
- **Do que ele cresce**: só de evidência do `lib/evidence.ts`, ou seja, check-in, encontro, entrega, depoimento aceito e mentoria. **Post, curtida e recado não fazem o pet crescer**, pra não virar fazenda de corrente.
- **Encontro**: tabela `pet_encounters(memberId, targetId, hackathonId, at)`. Só vale com os dois de check-in na mesma edição e dentro do horário do evento. O QR fica no ingresso, reaproveitando o QR de `/h/[id]/ingresso`. O encontro vira "conexão", que libera recado (1.4).
- **Alcance**: pessoas diferentes que a pessoa encontrou.
- **Profundidade**: encontros que depois viraram time, depoimento aceito ou recado trocado. É aí que depoimento, recado e "quero fazer time" passam a ter efeito no pet.
- **Acessório por comunidade de identidade** (no máximo 3 visíveis, a pessoa escolhe). Uma marca no aniversário do primeiro hackathon.
- **O pet não morre nem cobra.** Some por meses e ele dorme. A Colheita Feliz prendia por culpa, e isso a gente não copia.
- **No dia do evento**, a dica do dia vira a pergunta do encontro.

## 4. Tom: nostalgia brasileira sem virar paródia
- **Usar as palavras de verdade**: "recado", "depoimento", "comunidade", "fã". São palavras normais do português e carregam a memória sozinhas. Nada de "scrap", "add?", brilho, "aLtErNaDo", Comic Sans ou o rosa e azul do Orkut.
- **Não escrever "Orkut" em nenhuma tela.** A referência fica no formato. Comunidade de identidade começa com "Eu…", e o depoimento aceito tem o rito de "aceitar" que todo mundo lembra.
- **Uma piscadinha por vez, em lugar de pouco tráfego**: 404, estado vazio e dica do dia. O resto da interface segue a identidade visual que você fez.
- **Microcopy**, frase curta e na segunda pessoa:
  - "@x escreveu um depoimento sobre você. Aceita?"
  - "Recado novo de @y."
  - "Faz 1 ano do X."
  - Nada de "reviva a nostalgia".
- **O humor fica com as comunidades semeadas**, que falam da vida de hackathon. A interface em volta é seca.

## Onde isso pode dar errado, e o teste barato antes da onda grande
Toda a tese depende do hackathon, porque é dele que vem o motivo de voltar. Com a base pequena de hoje, recado e seguir pessoa podem nascer mortos.

O teste é fazer só a onda 0 e mais 1.1, 1.2 e 1.3, e medir até 2 semanas depois da próxima edição:
- quantos % dos times têm pelo menos um depoimento escrito (meta de 30%);
- quantos % dos membros ativos entraram em alguma comunidade de identidade semeada (meta de 20%).

Se não bater as metas, 1.4 a 1.9 e o pet esperam.

Ordem sugerida das ondas:
- **onda 0**: evidência, denúncia, bloqueio e LGPD;
- **onda 1**: 1.1, 1.2 e 1.3;
- **onda 2**: 1.4, 1.5, 1.6 e 1.7;
- **onda 3**: pet, 1.8 e 1.9, mais os tópicos vindos da onda do Reddit;
- **1.11** fica fora.

Não editei nada no repo, foi só leitura.

Arquivos que embasam o que está acima:
- /home/jazz/Projects/hackahub/lib/privacy.ts (OWNER_COLUMNS)
- /home/jazz/Projects/hackahub/lib/xp.ts e /home/jazz/Projects/hackahub/lib/game.ts (badge `organizador` só pra admin)
- /home/jazz/Projects/hackahub/lib/posts.ts (PostScope)
- /home/jazz/Projects/hackahub/lib/follows.ts
- /home/jazz/Projects/hackahub/lib/ratelimit.ts
- /home/jazz/Projects/hackahub/lib/archive.ts (getMemberArc)
- /home/jazz/Projects/hackahub/app/u/[username]/page.tsx
- /home/jazz/Projects/hackahub/migrations/027_comunidades.sql
- /home/jazz/Projects/hackahub/migrations/030_seguir_comunidade.sql


---

<!-- seção: Mecânicas do Orkut -->

# Orkut: como cada mecânica funcionava e o que ela gerava

Pesquisa feita sem tocar no repo. Antes de tudo, o que mais importa pro HackaHub: **neste mês (out/2026) o próprio Orkut Büyükkökten abriu uma petição pra voltar com o Orkut**. A contagem regressiva no orkut.com acabou em 08/10/2026 e só soltou uma carta e a petição. A carta critica "feeds baseados em engajamento", IA e bots, e defende uma rede de "identidade autêntica, amizade e comunidade". Ele não marcou data nem confirmou que tem produto. As matérias falam em 270 a 360 mil assinaturas de 115 a 142 países, e o Brasil é 68 a 70% disso. Ou seja, tem demanda brasileira medida agora por uma rede de comunidade sem algoritmo. E o lugar ainda está vazio.

Os pontos que só lembrei e não achei fonte estão marcados com **[não confirmado]**.

---

## 1. Entrada só por convite (2004 até ~2006)
- **Como era:** só entrava quem recebia convite de um membro. Os membros recebiam uma cota de convites pra distribuir. O convite dizia "share the karma, rank your friends". Na volta de 2009, o "Novo Orkut" também foi liberado por convite de quem já tinha a versão nova.
- **O que gerava:** escassez e status. Quem tinha convite era a porta de entrada da turma. A rede crescia por grupos de amigos inteiros, o que deixava o grafo denso desde o primeiro dia. No Brasil isso virou mercado: tinha gente vendendo convite.

## 2. Perfil em três camadas: social, profissional e pessoal
- **Como era:**
  - Social: idade, sexo, país, relacionamento, filhos, religião, opinião política, humor, fumo/bebo, e o campo "estou aqui para", com opções como amizade, contatos profissionais e namoro.
  - Profissional: formação, profissão, interesses profissionais.
  - Pessoal: preferências, "o que me atrai", "primeira coisa que noto nas pessoas". Na lateral do perfil apareciam uma grade de amigos (8 até 2007, depois 9), a lista de comunidades, os contadores de recados, fotos e fãs, e as avaliações.
  - No começo qualquer membro via qualquer perfil, menos quem estivesse na sua "lista de ignorados".
- **O que gerava:** o perfil virou um gênero de texto próprio, com frases de efeito, letras de música e campos preenchidos de brincadeira. Tem dissertação acadêmica sobre isso ("Quem sou eu? O gênero perfil no Orkut"). Os campos de identidade (humor, estilo, religião) eram o que a pessoa olhava primeiro antes de adicionar alguém.

## 3. Recados (scraps) e scrapbook
- **Como era:** era um mural público no perfil. Amigos e qualquer pessoa, conforme a privacidade, deixavam recados que apareciam na hora. A resposta ia no scrapbook da *outra* pessoa, então a conversa ficava partida entre dois perfis. O dono podia apagar recados.
  - Em set/2007 os recados passaram a aceitar HTML: imagem, vídeo, GIF, aqueles recados com "brilho".
  - Em 19/12/2007 um worm se espalhou por recado ("2008 vem aí, que ele comece mto bem pra vc"). Só de abrir o recado a pessoa já era infectada, entrava sozinha na comunidade "Infectados pelo Vírus do Orkut" e reenviava o recado pra todos os contatos. Foram 650 a 700 mil contas em poucas horas.
- **O que gerava:**
  - O contador de recados era sinal de popularidade.
  - Era o principal canal de conversa, antes do MSN e do WhatsApp, e a conversa ficava pública.
  - Muita gente apagava os recados depois de ler, pra manter a imagem limpa ou esconder treta.
  - Viraram comuns as correntes, os recados de "bom dia/feliz sexta" mandados pra todos os amigos e o "add?".

## 4. Depoimentos
- **Como era:** um texto longo sobre a pessoa, com homenagem, declaração de amizade ou de amor, ou recado de família. **Só aparecia no perfil se o dono aceitasse.** Os não aceitos ficavam pendentes e só o dono via.
- **O que gerava:**
  - Prova social escrita por terceiros. Era a parte que mais "vendia" a pessoa.
  - Disputa pra ver qual depoimento ficava no topo.
  - Reciprocidade: quem recebia um depoimento se sentia obrigado a escrever um de volta.
  - **Gambiarra famosa:** como só o dono via os não aceitos, o depoimento virou mensagem privada. A pessoa mandava, o dono lia e recusava, e ninguém mais via. Foi o "direct" da época, nascido de uma mecânica de aprovação.

## 5. Amigos, com teto de 1.000
- **Como era:** amizade dos dois lados, com pedido e aceite. Por mais da metade da vida do Orkut o limite foi de 1.000 amigos por conta. Na página inicial os amigos apareciam em ordem do último login, ou seja, quem tinha acabado de entrar vinha primeiro.
- **O que gerava:**
  - Quem batia o teto criava segunda e terceira conta, o "fulano 2".
  - Ver quem estava online virava motivo pra puxar conversa.
  - Uma análise de 2004 (Jill Walker Rettberg) notou que a ordenação lembrava o PageRank. Quem tinha mais amigos aparecia no topo das comunidades ("se você tem 300 amigos, aparece no topo de toda comunidade em que está"). Isso empurrava as pessoas a aceitar desconhecidos pra ganhar visibilidade, e confundia conhecido com amigo.

## 6. Fãs
- **Como era:** dava pra se declarar "fã" de qualquer amigo. O perfil mostrava a quantidade de fãs com um ícone de estrela.
- **O que gerava:** um placar público de admiração, idolatria e "ranking" social na escola. Era barato de dar e tinha muito valor pra quem recebia.

## 7. Avaliações: confiável, legal, sexy (o "karma")
- **Como era:** cada amigo dava nota **anônima** de 1 a 3 em cada critério. O resultado agregado virava porcentagem e aparecia no perfil como ícones que iam enchendo: carinhas sorridentes (confiável), cubos de gelo (legal) e corações (sexy).
- **O que gerava:**
  - O anonimato permitia elogiar sem se expor. A nota de "sexy" era paquera sem risco.
  - Comparação constante entre amigos.
  - Foi a parte mais "Hot or Not" da rede. Existe até patente do Google sobre esse tipo de medida de "coolness".

## 8. Lista de paqueras (crush list)
- **Como era:** você colocava qualquer membro na lista em segredo. Se os dois se colocassem, os dois eram avisados do match.
- **O que gerava:** declaração sem risco de rejeição. É o mecanismo do Tinder, dez anos antes.

## 9. Visitantes recentes
- **Como era:** o perfil mostrava as fotos dos **últimos ~6 visitantes** como ícones clicáveis. Depois virou "quem visitou seu perfil nos últimos dias" na página inicial. Dava pra desligar.
  - **[não confirmado]** Lembro que quem desligava também deixava de ver os próprios visitantes, o que fazia a regra valer pros dois lados.
- **O que gerava:**
  - Visita virou sinal. A pessoa visitava de propósito pra ser vista, como "chamar atenção".
  - Muita curiosidade e tensão ("o ex visitou meu perfil").
  - É a função que as matérias mais citam como "nenhuma rede trouxe de volta".

## 10. Comunidades
Era o centro do Orkut. Chegou a ter mais de 50 milhões de comunidades.
- **Estrutura:**
  - **um dono só**, que controla o conteúdo e a entrada de membros e pode nomear **moderadores**;
  - **fórum por tópicos**, em que qualquer membro abre tópico e os outros respondem;
  - **enquetes** com gráfico de votos;
  - **eventos** com data e informações;
  - **mensagem em massa** do dono pra todos os membros;
  - categoria, foto e descrição.
  - Tinha comunidade pública (todo mundo vê, mas para comentar precisa entrar) e moderada ou privada (entrada aprovada, conteúdo só pros membros).
  - Também tinha "Denunciar abuso" e, **[não confirmado]**, "comunidades relacionadas" e limite de participação por usuário.
- **Comunidade como identidade (o ponto mais importante):**
  - Boa parte das pessoas **nunca postava**. Entrava na comunidade pra que ela aparecesse no próprio perfil.
  - Exemplos: "Eu odeio acordar cedo" (6,1 milhões de membros, foto do Garfield), "Eu odeio segunda-feira", "Eu durmo na sala de aula", "Eu nunca terminei uma borracha", "O fundão também passa de ano", "Aluno deveria ganhar salário", "Adoro fazer tic tic na caneta" (400 mil).
  - A lista de comunidades era a frase de apresentação da pessoa, em forma de várias tags curtas e engraçadas.
  - Comunidades de escola, faculdade, turma e cidade serviam pra achar gente ("alguém do 3ºB 2006?").
- **O que gerava:**
  - Pertencimento ("me sentia especial, parte de algo maior").
  - Descoberta de pessoas pelo interesse em comum.
  - Fóruns de dúvidas de verdade: concurso, vestibular, programação, games.
- **O lado ruim:** comunidades de ódio, racismo e apologia à violência deram processo na Justiça brasileira em 2006, junto com fakes e trolls. Moderação fraca e suporte inexistente contra fraude.

## 11. Fotos e álbuns
- **Como era:** no começo eram **12 fotos no total**. O limite foi subindo até 1.000. Tinha álbuns com nome, e o clássico era o álbum "Eu". Em 2008 vieram a marcação de pessoas nas fotos, o compartilhamento de álbum só pra um grupo de amigos e o upload mais rápido.
- **O que gerava:** com 12 vagas, cada foto era escolhida a dedo. A pessoa montava a vitrine dela, sem algoritmo escolhendo nada. Comentário em foto virava conversa.

## 12. Sorte do dia
- **Como era:** uma frase curta, motivacional ou enigmática, no topo da página inicial a cada dia.
- **O que gerava:** um ritual diário de abrir o site, parecido com horóscopo. As pessoas comparavam a sorte com o que acontecia no dia, e ela virava assunto entre amigos e nas comunidades. Custava zero e trazia a pessoa de volta todo dia.

## 13. Aniversários e lembretes
- **Como era:** a página inicial mostrava quem fazia aniversário hoje e nos próximos dias, além de lembretes.
- **O que gerava:** uma enxurrada de recados de "parabéns" no scrapbook do aniversariante. O contador de recados disparava, e isso virava termômetro de popularidade.

## 14. Atualizações dos amigos (o "feed")
- **Como era:** só apareceu em 04/09/2007, três anos e meio depois do lançamento. Era uma caixa com o que os amigos fizeram: mudou o perfil, adicionou amigo, recebeu recado, entrou em comunidade. Em 2009 chegou o status curto, no estilo do Twitter e do Facebook.
- **O que gerava:** uma bisbilhotice mais passiva. Nos primeiros anos o Orkut funcionou **sem feed**: a pessoa ia ativamente ao perfil e à comunidade dos outros.

## 15. Temas, cores e visual do perfil
- **Como era:**
  - Temas visuais (rock, futebol, datas comemorativas) só existiam no Brasil e na Índia.
  - Em 2009 veio a escolha de cores do perfil (amarelo, rosa, vermelho etc.), porque o pessoal já usava app e script de terceiros pra "decorar" a página.
  - O Novo Orkut, de 29/10/2009, refez tudo em GWT, com menu no topo e uma página inicial mais limpa.
- **O que gerava:** expressão pessoal. A gíria "orkutização" vem dessa estética de GIF, brilho, "aLtErNaDo" e excesso de emoji.

## 16. Apps (OpenSocial)
- **Como era:** o Orkut foi o primeiro cliente do OpenSocial e chegou a mais de 600 apps em out/2008. Os mais usados:
  - BuddyPoke: avatar 3D que mandava beijo, abraço e dança pro avatar do amigo;
  - Colheita Feliz: fazenda, com visita e roubo da plantação dos amigos;
  - Café Mania: restaurante.
- **O que gerava:** jogo social com retorno diário e comparação com os amigos. Também deixou o perfil carregado e cheio de spam de app.

## 17. Promova, curtir e outras de 2009 a 2011
- **Como era:** o "Orkut Promova" deixava empurrar um texto, foto ou vídeo pros amigos em um espaço especial do perfil. Teve botão "curtir", chat pelo GTalk e depois chat por vídeo, grupos de amigos pra privacidade e vídeos do YouTube.
- **O que gerava:** foi a fase em que o Orkut virou cópia do Facebook. Logo depois o Brasil migrou pro Facebook (2011–2012), e o Orkut fechou em 30/09/2014.

---

## Mecânica do Orkut → HackaHub

O HackaHub já tem perfis /u, projetos /p, /feed com aba de comunidades, comunidades com mural, avisos, apoio e seguir, times, radar de hackathons e notificações.

| Orkut | Status no HackaHub | Sugestão (custo) |
|---|---|---|
| Comunidade-meme como identidade | não tem | badge de comunidade exibida no /u, entrar sem obrigação de postar, comunidades "Eu já virei a noite num hackathon", "Meu deploy é sexta 23h" (baixo) |
| Fórum por tópicos | tem só o mural | tópicos com respostas dentro de /comunidade/[slug] (médio) |
| Enquetes e eventos de comunidade | não tem | enquete simples e evento ligado ao radar de hackathons (médio) |
| Dono + moderadores | conferir | dono único e moderadores nomeados (baixo) |
| Depoimentos com aceite | não tem | "Depoimento de time": colega de hackathon escreve, o dono aceita, e isso vira prova social pro /talento e /empresas. É o que mais casa com o produto (baixo) |
| Fã / avaliações | tem "apoio/seguir" | trocar "sexy" por algo do contexto (confiável, "entrega", "explica bem"), anônimo e agregado. Precisa de cuidado com abuso (médio, arriscado) |
| Visitantes recentes | não tem | "quem viu seu perfil", com opt-out valendo pros dois lados. Útil quando recrutador entra em /u (médio) |
| Recado público no perfil | não tem | scrapbook no /u (baixo) |
| Convite | conferir | convite com cota por membro, tipo "traz o seu time" (baixo) |
| Sorte do dia | não tem | "dica/desafio do dia" na home ou no feed (baixíssimo) |
| Aniversários | não tem | aniversário de projeto ou "1 ano do seu primeiro hackathon" (baixo) |
| Álbum limitado a 12 | tem projetos | vitrine de no máximo N projetos fixados no perfil (baixo) |

**O que não copiar:**
- o teto de amigos, que gerou contas duplicadas;
- HTML livre no recado, que gerou o worm de 2007;
- nota "sexy" e crush list, que é risco claro numa rede de universitários;
- comunidade sem moderação, que gerou comunidades de ódio e processo;
- o sistema de convites, mas só se o convite for a ÚNICA forma de entrar, porque trava o crescimento.

**O contra-argumento (pra tentar derrubar a ideia):** o Tecnoblog defende que boa parte da saudade é "falsa memória afetiva". Depoimento perdeu espaço pro WhatsApp e comunidade perdeu pros grupos de Telegram e WhatsApp, então um Orkut de volta duraria o tempo do hype. Pro HackaHub isso pesa menos: depoimento de colega de time e comunidade como identidade técnica viram currículo, que é o que empresa e talento procuram. Só que isso ainda é hipótese. Dá pra testar barato com o depoimento de time e a comunidade exibida no perfil antes de construir fórum, enquete e o resto.

Fontes:
- [Wikipedia EN – Orkut](https://en.wikipedia.org/wiki/Orkut)
- [Wikipedia PT – Orkut](https://pt.wikipedia.org/wiki/Orkut)
- [Canaltech – 10 anos sem Orkut](https://canaltech.com.br/redes-sociais/10-anos-sem-orkut-relembre-dez-coisas-na-plataforma-que-deixaram-saudades/)
- [Canaltech – 9 recursos que fazem falta](https://canaltech.com.br/redes-sociais/saudade-do-orkut-9-recursos-que-fazem-falta-hoje-em-dia/)
- [Viva – 8 funções](https://viva.com.br/tecnologia/saudades-do-orkut-veja-8-funcoes-que-eram-febre-nos-anos-2000.html)
- [Quero Bolsa – comunidades de estudante](https://querobolsa.com.br/revista/7-comunidades-do-orkut-que-todo-estudante-fazia-parte)
- [Jill Walker Rettberg – rank your friends (2004)](https://jilltxt.net/rank-your-friends/)
- [MacMagazine – nova interface 2009](https://macmagazine.com.br/post/2009/10/29/como-previsto-google-apresenta-nova-interface-para-o-orkut/)
- [Darknet – worm de 2007](https://www.darknet.org.uk/2007/12/worm-spreading-fast-on-googles-orkut-social-network/)
- [Salon – Brazilian Orkut virus](https://salon.com/2007/12/19/brazilian_orkut_virus)
- [Tecnoblog – petição de 2026](https://tecnoblog.net/noticias/orkut-vai-voltar-depois-de-suspense-criador-publica-peticao/)
- [Tecnoblog – motivos errados](https://tecnoblog.net/comunidade/t/a-gente-quer-o-orkut-de-volta-sim-mas-pelos-motivos-errados/58884)
- [ProPakistani – comeback 2026](https://propakistani.pk/2026/10/12/orkut-could-be-making-a-comeback-after-12-years/)
- [Digit – petição](https://www.digit.in/news/general/orkut-co-founder-wants-to-bring-back-the-social-network-after-12-years-how-to-sign-the-petition.html)
- [revistas.usp.br – comunidades: dono, moderadores, enquetes, eventos](https://revistas.usp.br/esse/article/download/49275/53357/60515)
- [TecMundo – limites e página inicial de 2008](https://www.tecmundo.com.br/redes-sociais/239-como-usar-o-orkut.htm)


---

<!-- seção: Por que pegou no Brasil -->

# Orkut no Brasil: por que pegou, o que a galera de tech fazia lá, revivals e lições pro HackaHub

O Orkut pegou no Brasil por três coisas: a comunidade servia de crachá de identidade, o depoimento funcionava como moeda social e o scrap era conversa pública. A lan house levou isso pra classe C. Nenhuma das três depende de feed. O fundador do Orkut está pedindo hoje justamente a volta das comunidades, sem feed por engajamento.

## 1. Os números da adoção no Brasil
- **2004:** o Brasil começou em 3º lugar, com 5,16% dos usuários. Em junho já liderava, com 30,63%. [SBT News](https://sbtnews.sbt.com.br/noticia/tecnologia/orkut-faz-20-anos)
- **2007:** os brasileiros eram 55,82% da audiência. Na fase de ouro, até 2006, cerca de 70% dos cadastrados eram do Brasil. Em 2008 ainda eram uns 50%. No pico global a rede passou de 300 milhões de usuários. [SBT News](https://sbtnews.sbt.com.br/noticia/tecnologia/orkut-faz-20-anos), [Forbes BR](https://forbes.com.br/forbes-tech/2024/01/orkut-5-curiosidades-da-rede-que-completa-20-anos/)
- **2008:** o Google passou a operação inteira do Orkut pro Google Brasil, em Belo Horizonte, por causa do tamanho da base e das questões jurídicas. [Wikipedia](https://en.wikipedia.org/wiki/Orkut)
- **Dezembro de 2011:** o Facebook passou o Orkut no Brasil, com 36,1 milhões de visitantes contra 34,4 milhões (comScore). O tempo médio no Facebook saltou de 37 minutos pra 4,8 horas em um ano. [Tecnoblog](https://tecnoblog.net/noticias/trafego-facebook-ultrapassa-orkut-brasil/), [Oficina da Net](https://www.oficinadanet.com.br/noticias_web/4809/facebook-ja-e-o-preferido-no-brasil)
- **Classe C:** era 50% dos usuários do Orkut em 2009 e 57% em 2012. [Think with Google, "Novos donos da internet"](https://www.thinkwithgoogle.com/_qs/documents/1600/novos-donos-internet-classe-c-conectados-brasil_research-studies.pdf)

## 2. Por que virou fenômeno
- **Comunidade como identidade.** Ninguém entrava em "Eu odeio acordar cedo" (mais de 6 milhões de membros) pra conversar. Entrava pra mostrar no perfil quem era. A lista de comunidades fazia o papel da bio. As comunidades disputavam o nome mais engraçado, e foi aí que nasceram os primeiros memes da internet brasileira. [TecMundo](https://www.tecmundo.com.br/orkut/58432-11-comunidades-classicas-orkut.htm), [Quero Bolsa](https://querobolsa.com.br/revista/7-comunidades-do-orkut-que-todo-estudante-fazia-parte), [DCI](https://www.dci.com.br/tecnologia-e-games/7-comunidades-do-orkut-que-fizeram-sucesso-alem-dos-scraps/)
- **Depoimento como moeda social.** Um amigo escrevia um texto sobre você. Você aceitava ou não, e só aceito ele aparecia no seu perfil. Sem DM na época, o depoimento não aceito também virava recado privado. [Canaltech](https://canaltech.com.br/redes-sociais/saudade-do-orkut-9-recursos-que-fazem-falta-hoje-em-dia/)
- **Scrap como conversa pública.** O mural do perfil era uma conversa que qualquer um podia ler. Era fofoca, flerte e prova social ao mesmo tempo.
- **Reputação leve.** Tinha o contador de fãs (estrelas) e notas anônimas de "confiável", "legal" e "sexy". Também dava pra ver quem visitou seu perfil, e quem visitava aparecia pro outro. [Canaltech, "5 telas"](https://canaltech.com.br/redes-sociais/voce-lembra-como-era-o-orkut-5-telas-inesqueciveis/)
- **Lan house.** Era o acesso principal dos jovens das classes C e D, e o uso lá era basicamente Orkut e MSN. [Revista ALAIC](https://revista.pubalaic.org/index.php/alaic/article/download/103/104/105), [UFMG, preconceito social e distinção em redes sociais](https://repositorio.ufmg.br/bitstream/1843/40859/2/2016_Preconceito%20social%20na%20internet%20cultura%20informacional%20e%20distin%c3%a7%c3%a3o%20em%20redes%20sociais.pdf)
- **A academia brasileira estudou isso a sério.** Raquel Recuero (UFRGS/UCPel) analisou o capital social gerado em comunidades do Orkut em 2004. Daí saiu o livro "Redes Sociais na Internet". [Famecos/PUCRS](https://pucrs.emnuvens.com.br/revistafamecos/article/view/3340)

## 3. O que a galera de tech e de universidade fazia lá
- **A comunidade funcionava como fórum de verdade.** Tinha tópicos, enquetes, eventos (cursos, encontros) e lista de membros. [Unioeste](https://e-revista.unioeste.br/index.php/travessias/article/download/2781/2180/10741), [UTFPR](https://periodicos.utfpr.edu.br/rl/article/download/2399/1534)
- **Comunidades de tecnologia:** "Linux Brasil", com cerca de 48 mil membros, tinha tutoriais, dúvidas e software livre. "PHP Brasil", com cerca de 27 mil, tinha dicas, tutoriais e conversa sobre mercado de trabalho. Esses números vieram só do resumo da busca, de um artigo de 2009, e não consegui abrir a página original. Não use como dado oficial.
- **Comunidade por curso e por faculdade:** "Biologia - UFPel" é um exemplo que virou objeto de pesquisa. Também tinha pesquisa sobre o Orkut como extensão da sala de aula e sobre faculdades do ABC usando a rede pra falar com alunos e ex-alunos. [UFPel CIC 2011](https://www2.ufpel.edu.br/cic/2011/anais/pdf/CH/CH_01367.pdf), [Cásper Líbero](https://static.casperlibero.edu.br/uploads/2014/04/Claudemir-Martins-da-Silva.pdf)
- **Comunidade-meme de estudante:** "Eu durmo na sala de aula", "Aluno deveria ganhar salário", "O fundão também passa de ano". [Quero Bolsa](https://querobolsa.com.br/revista/7-comunidades-do-orkut-que-todo-estudante-fazia-parte)
- **Público jovem:** num estudo de 67 comunidades, 87% dos membros tinham menos de 30 anos e 63% tinham entre 18 e 23, ou seja, idade de universidade. (Também veio só do resumo da busca, sem URL confirmada.)

## 4. Revivals e nostalgia hoje
- **orkut.com, 8/10/2026:** o próprio Orkut Büyükkökten lançou uma petição pra uma rede nova "centrada em pessoas e comunidades". A carta critica feed por engajamento, IA e bots. Mais de 70% das assinaturas são do Brasil. O cadastro não reserva conta nem lugar na fila, e não tem data de lançamento. [Tecnoblog](https://tecnoblog.net/noticias/orkut-vai-voltar-depois-de-suspense-criador-publica-peticao/), [Meio & Mensagem](https://www.meioemensagem.com.br/midia/orkut-abre-peticao-mundial-para-criar-nova-rede-social), [A Crítica](https://acritica.net/entretenimento/novo-orkut-criador-anuncia-nova-rede-social/), [Diario de Pernambuco](https://www.diariodepernambuco.com.br/brasil/2026/10/11726159-orkut-de-volta-site-aparece-de-cara-nova-e-abre-contagem-regressiva-trazer-de-volta-o-que-realmente-importa.html)
- **Antes disso:** a Hello, rede do mesmo fundador focada em paixões, fechou em abril de 2022. O domínio orkut.com voltou em 2022 com um aviso de "algo novo" e teve teaser em 2024. [Canaltech](https://canaltech.com.br/redes-sociais/o-que-aconteceu-com-a-hello-ex-novo-orkut/), [SBT News](https://sbtnews.sbt.com.br/noticia/tecnologia/o-plano-do-fundador-do-orkut-para-a-volta-da-rede-social)
- **orkut.br:** clone feito pelo dev brasileiro Murillo Fagá em 2017, com app Android em 2020. Recriou depoimentos e as comunidades clássicas. [Olhar Digital](https://olhardigital.com.br/noticia/conversamos-com-o-brasileiro-que-ressuscitou-o-orkut/69708), [Tecnoblog](https://tecnoblog.net/328314/orkut-voltou-clone-da-rede-social-ganha-app-para-android/)
- **Outros clones:** já teve o orkut.li, com alerta de segurança. [Tecnoblog](https://tecnoblog.net/218749/orkut-li-clone-voltou/)
- **Katbook:** não achei nada com esse nome ligado ao Orkut. A busca só trouxe livros infantis. Ou o nome está diferente, ou o projeto não aparece na web.
- **Comunidade-meme nas redes atuais:** o TecMundo/Estadão tem matéria sobre "comunidades do Orkut voltando a fazer sucesso", mas a página não abriu (link no fim).

## 5. Do que a galera sente falta (o que aparece em várias listas)
1. Comunidades
2. Depoimentos com aprovação
3. Scraps públicos
4. Quem visitou meu perfil
5. Notas de fã, confiável e legal
6. Perfil personalizável (cores)
7. BuddyPoke (avatares) e jogos sociais, como Colheita Feliz

Fontes: [Canaltech 2025](https://canaltech.com.br/redes-sociais/saudade-do-orkut-9-recursos-que-fazem-falta-hoje-em-dia/), [Canaltech 2022](https://canaltech.com.br/redes-sociais/coisas-que-nao-podem-faltar-no-novo-orkut-215236/), [Canaltech, 10 anos sem Orkut](https://canaltech.com.br/redes-sociais/10-anos-sem-orkut-relembre-dez-coisas-na-plataforma-que-deixaram-saudades/), [Exame](https://exame.com/pop/estamos-sem-o-orkut-ha-20-anos-sera-que-faz-falta).

## 6. O que dá pra levar pro HackaHub
Isto é inferência minha, não está nas fontes.
- **A comunidade no perfil como crachá.** Comunidade de time, de faculdade ou de stack aparecendo em /u, com nome engraçado liberado ("Eu commito na main sexta 18h", "Meu MVP é um Google Forms"). A comunidade-meme dá identidade e é barata de manter.
- **Depoimento com aprovação, virado em aval de colega de time.** Quem fez hackathon com você escreve como você trabalha, e você decide se publica. Isso vale mais pra recrutador do que endorsement do LinkedIn.
- **Scrap público no perfil**, separado do mural da comunidade. É conversa leve e mostra quem anda com quem.
- **Comunidade com tópico, enquete e evento**, igual fórum. O /feed fica como agregador, não como timeline com algoritmo. Isso bate com o discurso do próprio Orkut em 2026 ("sem feed por engajamento"), que está em alta agora.
- **Comunidade oficial de cada curso/faculdade** ("Computação UFPE") como porta de entrada pro radar de hackathons e pra montar time.
- **Um selo leve de reputação**, tipo "fã" ou "bom de time". Já "visitantes do perfil" é polêmico (privacidade). Se tiver, tem que ser opcional e recíproco, como era no Orkut.
- **O risco:** nostalgia sozinha não segura usuário. Os clones (orkut.br, orkut.li) viraram curiosidade e não decolaram. O que prende é ter um motivo de uso, e no HackaHub esse motivo é o hackathon.

Matéria que não consegui abrir: [TecMundo/Estadão, comunidades do Orkut voltam a fazer sucesso](https://www.tecmundo.com.br/internet/228974-comunidades-orkut-voltam-fazer-sucesso-redes-entenda.htm)


---

<!-- seção: Por que morreu e lições -->

## Orkut: por que morreu, o que vale pro HackaHub, e o que foi o Hello

### Por que o Orkut morreu

**1. O Facebook virou uma coisa que dava vontade de abrir todo dia.** O Orkut dominou o Brasil de 2004 a 2010. Em 2008 a gestão foi passada pro Google Brasil. Em dezembro de 2011 o Facebook passou na frente em visitantes únicos: 36,1 milhões contra 34,4 milhões, segundo a comScore. O Facebook cresceu 192% em um ano. O diretor da comScore no Brasil disse que ele "triplicou a audiência e cresceu sete vezes em engajamento". Esse engajamento veio do News Feed e da marcação de pessoas em foto. O Orkut só deu destaque a status e atualizações de amigos no "novo Orkut" do fim de 2009, que entrou primeiro só por convite. Já era tarde. No meio de 2013 ele tinha perdido mais de 95% dos usuários regulares.

**2. Spam e scraps com vírus.**
- Em 19/12/2007 o Google tinha acabado de liberar JavaScript nos scraps. Um worm usou isso: só de **ver** o scrap ("2008 vem aí...") você era infectado, entrava na comunidade "Infectados pelo Vírus do Orkut" e o scrap ia sozinho pra todos os seus amigos. Foram mais de 650 mil contas em poucas horas.
- Teve outros. O MW.Orc (2006) roubava senha de banco. O W32.Scrapkut (2008) mandava instalar um "flash player" falso que roubava o login do Orkut.
- Os pedidos de amizade de spam nunca foram combatidos.

**3. Ninguém moderava.** O Orkut tinha cerca de 90% do conteúdo criminoso investigado pelo grupo de crimes cibernéticos do MPF-SP. O Google passou dois anos brigando na Justiça pra não colaborar. A CPI da Pedofilia quebrou o sigilo de 3.261 páginas, e só em julho de 2008 saiu um acordo (TAC) com o MPF e um canal com a SaferNet (até 500 URLs denunciadas por vez). Também teve processo por comunidades racistas e de ódio em 2006 e 2007. A marca ficou "terra sem lei".

**4. Fakes e privacidade ruim.** Não tinha nenhuma verificação. Mostrava quem visitou seu perfil e deixava dar nota de "sexy" pros amigos. O Facebook chegou com controles de privacidade e identidade real.

**5. O Google largou.** O Orkut sempre foi produto paralelo. Quando o Google+ chegou (2011–2012), a "integração" fazia post do G+ aparecer no Orkut, mas não o contrário. Fechou em 30/09/2014.

**6. Preconceito de classe.** Tinha gente "fugindo" do Orkut porque ele ficou popular entre as classes C e D. Pesquisa da UFMG trata a "orkutização" como etnocentrismo digital, um jeito de marcar distância de classe dentro das redes.

**O que o próprio Orkut Büyükkökten diz:** foram dois erros. O site caía por falta de escala, e eles subestimaram as comunidades, onde "pessoas fizeram amigos e acharam amor".

### O que vale pro HackaHub (rede nova e pequena)

1. **Comunidade é identidade.** "Eu odeio acordar cedo" tinha mais de 6 milhões de membros e quase ninguém postava lá. Era um adesivo no perfil. Vale mostrar as comunidades como selos no /u, deixar o usuário escolher a ordem e permitir comunidade só pra se identificar, sem obrigação de postar.
2. **Depoimento que o dono aprova.** No Orkut o depoimento só aparecia se a pessoa aprovasse. No HackaHub dá pra fazer "depoimento de colega de time", só pra quem já esteve no mesmo time ou projeto. Isso vira prova social pra recrutador.
3. **Conteúdo de usuário nunca executa nada.** O worm de 2007 nasceu de uma feature. Mural, scraps e bio passam por sanitize, link sai com `rel=nofollow ugc` e com a URL de destino visível, e mensagem pra quem não é conexão tem limite de envio.
4. **Moderação desde o dia 1, mesmo pequena.** Botão "denunciar" em perfil, comunidade, post e mural. Fila no admin. O dono da comunidade pode remover e banir. E precisa de um caminho rápido pra conteúdo grave: CSAM vai pra SaferNet e PF, e o caso de nudez sem consentimento está no art. 21 do Marco Civil. Pode ter gente de 16–17 anos na base, então vale olhar o ECA Digital (Lei 15.211/2025). Não confirmei esse ponto nesta pesquisa, é bom checar.
5. **Barreira contra fake.** Clerk com e-mail verificado já ajuda. Dá pra pôr selo de e-mail institucional (.edu.br/.usp.br) ou GitHub conectado e exigir isso pra criar comunidade ou mandar mensagem em massa.
6. **Nada de feature de vigiar.** Sem "quem visitou" e sem nota pra pessoa.
7. **Feed cronológico funciona numa rede pequena, desde que tenha assunto.** O Orkut perdeu porque não tinha motivo diário pra voltar. Os motivos do HackaHub existem: hackathon abrindo no radar, time procurando gente, projeto novo de alguém que você segue. O /feed tem que puxar isso.
8. **Cair mata.** O próprio fundador aponta a falta de escala. Rede pequena que dá erro no dia do hype não ganha segunda chance (o Hello passou por isso, logo abaixo).

### Hello Network (2016–2020/22)

- **O que tentou:** lançou em 1º/05/2016, só como app. Tinha "personas" por interesse (foodie, yoga, música). O feed vinha de interesses e de conteúdo local, não do seu grafo de amigos. Usava "karma" de reputação pra afundar conteúdo ruim, prometia não vender dado e ganhava dinheiro com moeda virtual (hellocoin), deixando anúncio pra depois. Mirou Brasil e depois Índia (2018).
- **Números:** cerca de 1 milhão de downloads em set/2019, segundo a Wikipedia. Outra fonte fala em mais de 2 milhões. O Orkut chegou a uns 300 milhões. Também tem data conflitante: uma fonte diz que fechou em 2020, a Wikipedia diz abril/2022 ("pausing hello...").
- **Por que não pegou:** não houve explicação oficial, então isto é análise minha. Ele travou e não mandava código de verificação no lançamento brasileiro de 2016, com enxurrada de reclamação na Play Store. Rede de interesse entre desconhecidos precisa de muita gente desde o início, e o Hello começou sem grafo, sem comunidade pronta e brigando com WhatsApp e Instagram já instalados. A nostalgia trouxe download, não hábito. Persona é um conceito abstrato demais. O HackaHub tem âncoras reais que o Hello não tinha: hackathon, universidade, time.
- **Agora:** em 08/10/2026 o Büyükkökten postou no X pedindo pra ex-usuários registrarem apoio no orkut.com pra uma volta, com "amizade, comunidade e conexão humana" no lugar de feed algorítmico. É uma porta falsa pra medir demanda. Vale acompanhar.

### Fontes
- [The Death and the Death of Orkut (Summer of Protocols)](https://summerofprotocols.com/the-death-and-the-death-of-orkut)
- [Storyboard18: From scraps to silence](https://www.storyboard18.com/brand-marketing/from-scraps-to-silence-the-untold-story-of-orkuts-meteoric-rise-and-quiet-exit-75522.htm)
- [Wikipedia: Orkut](https://en.wikipedia.org/wiki/Orkut)
- [Baguete: Facebook ultrapassa Orkut (comScore)](https://www.baguete.com.br/noticias/facebook-ultrapassa-orkut)
- [Darknet: worm no Orkut, dez/2007](https://www.darknet.org.uk/2007/12/worm-spreading-fast-on-googles-orkut-social-network/)
- [InformationWeek: Google Exterminates Its Orkut Worm](https://www.informationweek.com/it-sectors/google-exterminates-its-orkut-worm)
- [Migalhas: acordo MPF-SP x Google](https://www.migalhas.com.br/quentes/63887/acordo-poe-fim-a-disputa-judicial-entre-mpf-sp-e-google)
- [Congresso em Foco: CPI quebra sigilos do Orkut](https://www.congressoemfoco.com.br/noticia/80568/cpi-da-pedofilia-quebra-sigilos-do-orkut)
- [Tecnoblog: novo Orkut 2009](https://tecnoblog.net/noticias/google-anuncia-o-novo-orkut/)
- [JB: integração Orkut e Google+](https://www.jb.com.br/ciencia-e-tecnologia/noticias/2012/08/01/amp/google-amplia-integracao-entre-orkut-e-google-plus.html)
- [UFMG: Preconceito social na internet (orkutização)](https://repositorio.ufmg.br/bitstream/1843/40859/2/2016_Preconceito%20social%20na%20internet%20cultura%20informacional%20e%20distin%c3%a7%c3%a3o%20em%20redes%20sociais.pdf)
- [DCI: "Eu odeio acordar cedo"](https://www.dci.com.br/tecnologia-e-games/7-comunidades-do-orkut-que-fizeram-sucesso-alem-dos-scraps/)
- [Wikipedia: Hello](https://en.wikipedia.org/wiki/Hello_(social_network))
- [Scroll.in: Hello na Índia, entrevista](https://scroll.in/article/876071/as-facebook-stumbles-orkuts-founder-says-hello-to-india-once-again)
- [O Imparcial: falhas do Hello no Brasil](https://oimparcial.com.br/brasil/2016/07/novo-orkut-abre-inscricoes-para-brasileiros-mas-apresenta-falhas/)
- [ProPakistani: Orkut comeback, out/2026](https://propakistani.pk/2026/10/12/orkut-could-be-making-a-comeback-after-12-years/)
