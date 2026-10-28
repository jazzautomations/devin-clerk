# Estudo: Quebra-Gelo (quebra-gelo.julioakamine.com)

Engenharia reversa do bundle público (`/assets/index-8P14-GAV.js`, 738 KB) em
28/10/2026. Inspiração pro pet e pra conexão entre pessoas no HackaHub, não
cópia.

## O que é

"O networking do DevDay, jogável". Você monta um pet em 30 segundos, encontra
gente de verdade no evento e escolhe como conversar. O pet só cresce quando você
conversa com alguém de verdade. No fim do dia você leva a lista de quem conheceu.

## Stack

- Front em JS puro com Vite (template strings em `innerHTML`, sem framework),
  `<canvas id="cena">` + `<div id="ui">`.
- **three.js** (WebGLRenderer, BufferGeometryUtils.mergeGeometries): pets em
  **voxel** montados por código, sem modelo 3D externo e sem API de imagem. A
  miniatura do pet (lista, cards) é renderizada uma vez num WebGLRenderer de
  160×160 fora da tela e guardada como dataURL em cache (`especie|acessorio`).
- Lib `qrcode` no cliente: o QR aponta pra `/?c=<codigo>`.
- Backend próprio pequeno em `/api/*` com token em `localStorage` (`qg-token`,
  header `x-token`). Rotas: `GET eu`, `GET pets`, `GET atividade`, `GET demo`,
  `GET stats` e `POST comecar | encontro | escolha | avancar | diagnostico | retomar`.
  Polling de `eu` pra saber quando alguém te encontrou.
- Rota `/demo` com pets de exemplo pra apresentar sem depender do público.

## Pet

- **Espécie = objeto fofinho** (10): xícara, caderninho, laptopinho, plantinha,
  lâmpada, coração, globinho, estrelinha, conezinho, nuvem. Cada uma com cor e
  uma personalidade de uma linha ("Curioso, puxa assunto com qualquer um.").
- **Acessório** (3): nenhum, óculos, boina.
- Criação: nome do pet, nome do dono, LinkedIn (opcional), área (front, back,
  fullstack, mobile, dados, design, produto, marketing, comercial, rh, gestão,
  carreira), o que **procura** e o que **oferece**.
- **Crescimento visual** a partir de dois eixos:
  `{crachas: alcance>=4, xicara: profundidade>=4, capa: alcance>=4 && profundidade>=4}`.
  Ou seja, o pet ganha crachás pendurados (conheceu muita gente), xícara
  (conversas fundas) e capa (as duas coisas).
- Cena 3D com câmera que viaja entre missões (`irPara`), `chegarAmigo` (o pet
  do outro entra em cena), `consequencia`, `cenaFinal`, confete, zoom por roda,
  modo vitrine.

## Mecânica do encontro

- Cada pessoa tem um **código curto + QR**. Pra encontrar alguém você vai até a
  pessoa e digita o código dela ou lê o QR com a câmera do celular. O encontro
  vale nos dois lados (o outro descobre pelo polling).
- Lista "Quem está online" ao vivo, com a nota: "Achou alguém? Vá até a pessoa
  e leia o QR do pet." Ela não substitui o encontro físico, só ajuda a achar.
- Sugestões por missão: pessoas de outra área, ou que **oferecem** o que você
  **procura**, ou seus contatos (na missão de reencontro).

## História (4 missões, uma por encontro)

O pet narra em primeira pessoa ("Nasci agora, no meio do DevDay... você vai me
apresentar"). Cada missão tem abertura, encontro e uma escolha:

1. **Novas pessoas.** Conhecer alguém de outra área.
2. **Troca de ajuda.** Achar quem oferece o que você procura.
3. **Cultive conexões.** Ligar duas pessoas que combinam.
4. **Palco DevDay.** Reencontrar alguém antes das apresentações finais.

Em cada encontro há duas opções:

- **ampla** (papo rápido, apresentar, pedir direto), que soma +2 de
  **Alcance**: você conhece mais gente.
- **profunda** (perguntar e ouvir, oferecer ajuda primeiro, marcar café), que
  soma +2 de **Profundidade**: você conhece melhor.

A consequência é narrada com os nomes reais (`{amigo}`, `{dono_amigo}`,
`{oferta}`, `{contato}`).

**Finais**, a partir de alcance e profundidade:

- **Time dos Sonhos** (os dois ≥ 4): "esse é o time que você montou hoje".
- **Colecionador de Crachás** (mais alcance que profundidade): "ninguém lembrou
  do meu nome... fica um pouco mais em cada conversa?"
- **Amigo de Um Só** (mais profundidade que alcance): "arrisca mais um oi?"

Nenhum final é punição: todos ensinam.

## Treino de habilidade social

Diagnóstico e atividades em três habilidades: **abordar**, **escutar** e
**conectar**. São situações de múltipla escolha com explicação ("Você chega e
vê 3 pessoas em roda. O que faz?" → "Se aproxima e pergunta 'posso entrar?'").
Aparecem como trilha de bolinhas (feita certa, errada, atual, bloqueada) por
habilidade.

## O que encanta

- O pet é **seu** em 30 segundos e evolui só com **gente de verdade**.
- Narrativa em primeira pessoa com os nomes de quem você conheceu: o encontro
  vira história.
- A escolha **amplo × fundo** ensina networking sem sermão, e o final reflete
  como você jogou.
- Sai com uma lista útil (com LinkedIn) no fim do dia.
- Leve: sem app, só QR + código e funciona no celular.

## Tradução pro HackaHub (rascunho pro plano de ondas)

- **Pet do builder** em voxel (three.js, procedural, miniatura cacheada como
  imagem). Espécies com cara de hackathon (ex.: cafezinho, teclado, patinho de
  borracha, servidor, lâmpada, foguete, bug fofo...), acessórios desbloqueados
  por evidência real (check-in, projeto entregue, time formado, mentoria,
  depoimento aceito, pódio). Aparece no perfil, no card do time, no feed, no
  telão e no crachá.
- **Encontro verificado** com o código/QR do pet no evento (reaproveitar o QR
  do check-in): vale nos dois lados, guarda onde/quando, alimenta "quem eu
  conheci" e os eixos **alcance/profundidade**, que viram crescimento visual do
  pet.
- **Missões do evento** ligadas ao hackathon: conhecer alguém de outra área,
  achar quem oferece o que você procura (o "procuro/ofereço" já casa com
  procurar time e com o perfil), apresentar duas pessoas, reencontrar alguém
  antes do pitch. O final pode virar um **time** de verdade (convite pro time).
- **Trilha abordar/escutar/conectar** como conteúdo leve pra quem vai no
  primeiro hackathon.
- **Modo /demo e telão**: os pets do evento no projetor, com contador
  "N encontros entre gente de verdade".
