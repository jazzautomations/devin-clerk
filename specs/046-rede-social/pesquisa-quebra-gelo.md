# Quebra-Gelo: o que é, como funciona por dentro, e 3 formas de levar pro HackaHub

O site e o bundle são públicos. Fiz a análise com o HTML, o JS de 738 KB, `/api/stats` e duas screenshots via Playwright headless (o chromium que o npx baixou estava na versão errada, então usei o `chromium_headless_shell-1243` que já tinha no cache). Não mexi em nenhum arquivo do repo.

## 1. O que é

- **Nome e evento:** "Quebra-Gelo — o networking do DevDay, jogável". É do Julio Akamine, feito pro "OpenAI DevDay Community Hackathon São Paulo" (o texto está desenhado num canvas dentro do bundle).
- **Promessa:** "Seu pet só cresce quando você conversa com alguém de verdade." Cria em 30 segundos e não pede login.
- **Criação em 5 passos:**
  - Passo 1: escolhe uma espécie entre 10 (Xícara, Caderninho, Laptopinho, Plantinha, Lâmpada, Coração, Globinho, Estrelinha, Conezinho, Nuvem). Cada uma tem uma frase de personalidade, tipo "Empático, escuta até o fim antes de falar". Escolhe também um acessório (nada, óculos ou boina).
  - Passo 2: seu nome, nome do pet (tem botão de dado pra sortear) e LinkedIn opcional.
  - Passos 3 a 5: chips de "com o que você trabalha", "com o que quer ajuda hoje" e "com o que pode ajudar". São 12 áreas: front, back, fullstack, mobile, dados, design, produto, marketing, comercial, rh, gestão e carreira.
- **4 missões:**
  1. Conheça alguém de outra área.
  2. Encontre quem pode te ajudar. O app sugere quem oferece o que você procura.
  3. Ligue pessoas que combinam.
  4. Reencontre alguém antes das apresentações finais.
- **O encontro físico:** cada pet tem um código de 4 letras e um QR. Você vai até a pessoa, um digita o código do outro ou lê o QR, e escolhe como conversar. Papo rápido dá +2 de Alcance, conversa funda dá +2 de Profundidade.
- **3 finais:**
  - "Time dos Sonhos": Alcance e Profundidade a partir de 4.
  - "Colecionador de Crachás": mais Alcance que Profundidade.
  - "Amigo de Um Só": Profundidade igual ou maior que o Alcance.
- **Outras abas:** Mapa, Academia, Quem eu conheci, Conexões, Finais e um "Quem está online" ao vivo. A Academia faz um diagnóstico de soft skill em 3 habilidades (abordar, escutar, conectar), com situações de múltipla escolha, e monta uma trilha pela sua habilidade mais fraca.
- **O pet evolui:** ganha itens que encaixam no corpo. Crachás com Alcance a partir de 4, xícara com Profundidade a partir de 4, capa com as duas.
- **Números ao vivo do `/api/stats`:** 44 pessoas com pet, 22 encontros, 7 finais, só 1 LinkedIn preenchido. Criar funciona. O ciclo depois disso perde gente, e quase ninguém deixa contato.

## 2. Stack e como o bicho é feito

- **Front:** Vite, JS puro com template strings (sem React), three.js e animação com spring (cara de Motion). A fonte é Inter Tight e tudo é em português, inclusive o código (`corpo`, `parte`, `pintar`, `encaixes`).
- **Bicho em voxel construído por código, sem arquivo .vox nem modelo pronto.** Uma classe faz o papel de construtor:
  - Primitivas: `caixa`, `elipsoide`, `esfera`, `cilindro`, `capsula`, `extrudar`, `bloco` com cantos arredondados.
  - Rosto desenhado sobre a superfície com matrizes ASCII, por exemplo olhos `[".KK.","K..K"]` e boca `["KKKK","KLLK",".LL."]`.
  - O corpo é dividido em partes com pivô e pai (braços, pernas, itens) pra dar pra animar.
  - Tem também decalques (logo ou texto), hastes e âncoras.
  - Cada espécie é uma função `construir` feita à mão, com `encaixes` (olhos, topo, peito) onde os acessórios entram.
  - O resultado é um JSON v3 (`escala`, `paleta`, `partes[{nome,pai,pivo,voxels}]`, `ancoras`).
- **Malha:** uma por parte, com as faces escondidas removidas. São dois materiais, fosco e brilho; a cor com `*` na paleta vira brilho.
- **Animação procedural:** balanço em seno (`sin(t*2.2)`), squash and stretch que preserva volume (`scale(1/√e, e, 1/√e)`), braço que balança e um `acenar`.
- **Truque de performance que vale copiar:** só existe um WebGLRenderer de 160×160 fora da tela. Cada combinação de espécie e acessório é renderizada uma vez, salva como dataURL em cache e aparece como `<img>` em listas, chips, sugestões e "quem eu conheci". O 3D de verdade só aparece no canvas principal: a vitrine na criação e o mapa em ilha das missões.
- **Backend:**
  - Rotas: `/api/pets`, `eu`, `comecar`, `encontro`, `escolha`, `avancar`, `atividade`, `diagnostico`, `demo` e `stats`.
  - Sem login: um token anônimo fica no localStorage (`qg-token`) e vai no header `x-token`.
  - A presença é feita com `visibilitychange`: quando a aba some, manda `POST /api/sair` com keepalive; quando volta, chama `/api/eu`.
  - O header `alt-svc h3` sugere Caddy. Não vi banco nem nada pago, e não tem chamada de IA nenhuma.

**O que encanta:**
1. Fica pronto em 30 segundos e é fofo, com objetos do dia a dia do dev virando bicho.
2. A recompensa só vem de encontro presencial.
3. A escolha "rápido ou fundo" ensina networking sem dar sermão.
4. As sugestões de quem procurar vêm de "oferece e procura", ou seja, um matchmaking leve.

## 3. Como levar pro HackaHub (inspirado, não copiado)

Contexto do repo que pesa aqui:
- `specs/020-avatars` hoje é só foto do Clerk ou iniciais.
- `012-team-finder`, `016-live-arena` (telão) e `029-builder-arc` (trajetória do builder) já existem.
- Tem check-in em `app/admin/h/[id]/checkin`.
- A linha 60 do roadmap diz pra não dar XP por like e pontuar só entrega verificada.

### A) Bicho do builder (persistente, aparece no perfil e em todo canto)

- **Como cria:** em `/perfil` ou `/bem-vindo`, escolhendo base, cor e acessório. Nasce a partir de uma semente (id do membro), então quem não montar o seu recebe um bicho aleatório e nunca fica com quadrado cinza.
- **Como evolui (seguindo o roadmap):** só com coisa verificada. Itens e partes destravam com check-in feito, entrega travada no prazo, pódio, voltar em outra edição (o arco do 029), mentorar e organizar. Nada com like.
- **Onde aparece:**
  - Como opção no componente `Avatar` (foto, bicho ou iniciais).
  - Grande e girando em `/u/[username]`, ao lado do arco do builder.
  - No feed, nos comentários, em `/membros`, `/talento` e nos inscritos.
- **Custo:**
  - O ideal é um builder de voxel próprio, com umas 300 linhas. Fazer 6 bases boas, com pontos de encaixe padronizados pra os itens servirem em todas.
  - three.js carregado só em `/perfil` e `/u/*`. As listas usam PNG.
  - Na hora de salvar, o cliente renderiza e sobe o PNG. Isso resolve o OG image: `opengraph-image.tsx` usa Satori, que não roda WebGL.
  - No banco: uma coluna `mascote JSON` (config e itens destravados) e uma `mascoteUrl`.
  - Nenhuma API paga.
- **Riscos:**
  - O custo real é arte. Lá, cada uma das 10 espécies é modelada à mão em código.
  - Celular fraco ou sem WebGL precisa cair no PNG.
  - Pode virar "rede de vaidade", que o roadmap pede pra evitar. A trava é amarrar a evolução a entrega.

### B) Modo quebra-gelo da edição (presencial, dentro de `/h/[id]`)

- **Como liga:** depois do check-in, a pessoa recebe código de 4 letras e QR do próprio bicho.
- **As missões são do hackathon, não do networking genérico:**
  1. Ache alguém de outra área.
  2. Ache quem tem a skill que falta no seu time. Aqui usa o team-finder do 012: procura e oferece já são basicamente os dados de lá.
  3. Apresente duas pessoas.
  4. Reencontre alguém antes da demo.
- **Saída:**
  - "Quem eu conheci" vira contato salvo no HackaHub, sem depender de LinkedIn. Lá só 1 de 44 preencheu, e aqui o login do Clerk já resolve isso.
  - Gera sugestão de time.
  - Alcance e Profundidade viram métrica do evento no painel do organizador e do patrocinador (roadmap #8).
- **Custo:**
  - Tabela `encontros(edicao, a, b, tipo, ts)`, duas ou três rotas, QR feito no cliente.
  - Presença: o mesmo truque de `visibilitychange` mais polling, sem websocket.
- **Riscos:**
  - Farm, ou seja, trocar código pelo zap sem se ver. Mitigar com: só vale com check-in feito e durante o evento, os dois lados confirmam, um encontro por par.
  - LGPD: contato só com opt-in mútuo.
  - Evento online, estilo lablab, enfraquece a mecânica. Lá o encontro vira "call de 10 min na sala do evento" confirmada pelos dois, e conta menos.

### C) Bichos no telão e bicho do time

- **Telão:** a `016-live-arena` mostra a ilha ou o salão com os bichos de quem está presente. Quando um time se forma, os bichos se juntam. Quando entrega, o bicho levanta uma bandeira. Contador de encontros ao vivo, igual ao `/api/stats` deles.
- **Bicho do time:** na página do projeto (`/p`) vira um bicho do time, montado com uma peça do bicho de cada membro (cabeça de um, acessório de outro). Dá cara própria à vitrine estilo Devpost.
- **Custo:**
  - O telão é um canvas three.js num PC só, então dá pra usar o 3D completo sem medo.
  - O bicho do time é só combinar as configs dos membros. Sai de graça se a A for bem feita.
- **Riscos:** telão com 200 bichos precisa de instancing. E fusão feia acontece se os encaixes não forem padronizados desde o começo.

## Ordem sugerida e cuidados

**Ordem:** A primeiro, porque é a base e já resolve o "toda rede social precisa de cara". Depois B numa edição piloto, e C como enfeite.

**Não copiar:** as 10 espécies, os nomes, os textos das missões e o construtor de voxel deles. Não vi licença. A ideia do bicho fica, as espécies e o código são nossos: dá pra fazer bichos que são objetos de hackathon (café, crachá, teclado, pizza, servidor, mapa de calor).

**Não entra:** IA gerando avatar, NFT do bicho, ou nota pra conversa.

**Pra estudar depois:** o bundle está em `/tmp/claude-1000/-home-jazz/8329807e-1147-4730-a8c7-1e51bbd1b6c5/scratchpad/qg/main.js`. O construtor de voxel começa por volta do byte 645000, a montagem da malha (`w_`) e a thumbnail (`L_`) por volta do 676500, e a API e o fluxo de criação por volta do 707600.

As screenshots da abertura e da escolha de pet estão em `/tmp/claude-1000/-home-jazz/8329807e-1147-4730-a8c7-1e51bbd1b6c5/scratchpad/qg1.png` e `qg2.png`.