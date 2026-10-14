# 039 — Diagnóstico: landing e jornada

Base: commit `86b7939`, app buildado (`next start`) contra `hackahub_dev`
com `seed:demo` (15 membros, 4 edições Hack Inova, 26 inscrições, 8 times).
Prints em 1440 e 390 px, deslogado e logado (usuário de teste via ticket do
Clerk dev). Arquivos `antes-*.png` em
`scratchpad/feat-p/` (fora do repo; nomes citados abaixo).

## 1. O que está misturado ou confuso

### Landing `/` — `antes-home-desktop.png`, `antes-home-mobile.png`

1. **A próxima edição aparece quatro vezes** antes de qualquer outra coisa:
   faixa do topo, link "Próxima edição ↗" do hero, bloco "14 NOV. Alphaville,
   SP." e a janela `EDICAO.cal` da mesa. Nenhuma das quatro diz o que fazer
   (data de inscrição, vagas, se está aberta).
2. **Números repetidos e frágeis.** "15 membros" aparece no grid de stats e de
   novo em `COMUNIDADE.db`; "1 hackathon aberto" em três lugares (selo AO
   VIVO, stats, `RADAR.live`). Com radar vazio, a página grita "1".
3. **O leque de cartas do hero mostra "0 MINTADAS"** nas edições encerradas —
   prova negativa no primeiro scroll.
4. **Não existe público.** A página fala com todo mundo ao mesmo tempo: o
   hero é participante, a mesa mistura participante/radar/membros, o grid
   "Um perfil, todos os hackathons" lista 6 rotas (edições, radar, projetos,
   feed, membros, marcas) como se fossem features, e o organizador só
   aparece numa faixa escura no fim. Patrocinador é um card preto entre as
   rotas.
5. **Nenhum projeto ou campeão na landing.** O arquivo tem pódio, repo e demo
   no banco, mas a home não mostra um único projeto.
6. **Copy fala contra ferramenta**, o que a regra proíbe: "INSCRIÇÃO AQUI, SEM
   FORMS ▸" (faixa), "INSCRIÇÃO PELO HACKAHUB, SEM FORMS" (edição), "é o
   cadastro único do hackahub, não um Google Form" (edição), e a descrição
   do site (`app.config.ts`) "inscrição sem Google Forms, avisos sem grupo
   de zap".
7. **Botão da newsletter parece desabilitado** (cinza sobre menta) mesmo
   habilitado.
8. Mobile: a janela `ARQUIVO.zip` corta o nome da edição ("PUC Consola…")
   fora da caixa.

### Header — todas as rotas

- **8 links + 2 botões**: radar, feed, membros, projetos, talento, blog,
  painel, perfil, entrar, criar conta. "talento" é coisa de recrutador,
  "blog" é conteúdo; os dois disputam espaço com a ação principal.
- **"painel" aparece pra quem está deslogado** e leva pro login sem dizer.
- **Sem estado ativo**: nenhum link indica a página atual.
- **Mobile 390**: a nav vira uma faixa com scroll lateral escondido; "painel"
  e "perfil" ficam fora da tela sem pista de que existem
  (`antes-*-mobile.png`, topo).
- Nenhum caminho pra quem quer **organizar** uma edição.

### Página da edição `/h/[id]` — `antes-h_hack-inova-alphaville-2026-*.png`

- **O próximo passo não está no topo.** No desktop o hero é nome + ficha;
  a ação ("fazer inscrição") fica na coluna lateral, a ~520px. No mobile a
  coluna lateral sobe com `order-first`, mas antes dela vem o hero inteiro e
  a ficha (data/local), e o botão cai a ~790px.
- **Os estados da jornada estão espalhados**: inscrição na lateral, ingresso
  num botão separado em cima dela, RSVP só no `/dashboard`, entrega no bloco
  de prazos, voto ao vivo na janela do palco, resultado no fim da coluna
  principal, certificado em lugar nenhum da página.
- **Ficha duplicada**: data/local/formato aparecem no hero (ingresso) e de
  novo na `<dl>` lateral.
- **Programação e dúvidas sem link** na página (rotas `/programacao` e
  `/duvidas` existem; só o bloco "agora/a seguir" aparece no dia).
- "Quer ajudar?" (voluntário/mentor/jurado) aparece na lateral **acima** da
  ficha técnica e da carta, competindo com a inscrição.

### Dashboard `/dashboard` — `antes-dashboard-*.png`

- Etiqueta do topo diz **"FEED"**; o primeiro bloco depois da barra de XP é o
  **compositor de post da comunidade**. Nada diz "tua próxima edição".
- Quem está inscrito não vê a própria inscrição: nem status, nem ingresso,
  nem entrega. O RSVP pendente aparece, mas sozinho, sem contexto.
- Lista **"vindo por aí" com 5 cards "COMING SOON" em inglês** — dois deles
  (desafio patrocinado, deploy) **já existem** no produto.
- **Sobra de template**: caixa "`$ keep_building: open Devin and ask it to
  Build 'Deploy em 1 comando'…`".
- Quem tem papel numa edição (organizador, staff, mentor, jurado) **não tem
  atalho pro painel da edição** (`/admin/h/[id]`); só o admin global vê um
  link genérico pra `/admin`.
- Sessões Hack Inova e radar repetem o `/radar` inteiro no fim da página.

### Outras rotas

- `/radar` (`antes-radar-*.png`): ok na estrutura; com radar vazio mostra só
  a sessão Hack Inova e "nenhum hackathon aberto". Fica.
- `/perfil` e `/u/[username]` (`antes-perfil-*`, `antes-u_marina.builds-*`):
  ok; o perfil público é o portfólio (carta, trajetória, badges). Fica.
- `/h/[id]/inscricao` (`antes-h_…_inscricao-*`): formulário claro; fica.
- `/empresas`: página comercial existe e funciona, mas só é achável pelo
  card preto da landing e pelo rodapé.

## 2. Arquitetura de informação atual

Header (todas as páginas): `/radar` · `/feed` · `/membros` · `/projetos` ·
`/talento` · `/blog` · `/dashboard` ("painel") · `/perfil` (logado) ·
entrar/criar conta (modal Clerk) · sino de notificações · avatar.

Rodapé: Plataforma (`/radar`, `/feed`, `/projetos`, `/membros`) · Pra marcas
(`/empresas`, `/talento`, `/blog`) · Legal (`/legal/termos`,
`/legal/privacidade`).

Rotas públicas: `/`, `/radar`, `/feed`, `/membros`, `/projetos`,
`/talento`, `/blog`, `/blog/[slug]`, `/empresas`, `/u/[username]`,
`/p/[teamId]`, `/p/[teamId]/feedback`, `/c/[code]` (certificado),
`/demo/[id]`, `/rsvp/[token]`, `/legal/*`.

Edição: `/h/[id]` e filhas `inscricao`, `ingresso`, `entrega`,
`programacao` (+ `.ics`, `[itemId]`), `projetos`, `duvidas`, `conduta`,
`incidente`, `candidatura/[kind]`, `votar`, `telao`, `nps`,
`patrocinador/[sponsorId]`.

Logado: `/dashboard`, `/perfil`, `/notificacoes`.

Organização: `/admin` (global) e `/admin/h/[id]` com 19 abas (inscritos,
formulário, candidaturas, avisos, dúvidas, programação, presença, check-in,
crachás, refeições, entregas, júri, palco, certificados, incidentes,
equipe, patrocinadores, patrocinador/[id], nps).

Não existe rota pra quem quer **organizar** (só o `/admin` pra quem já é).

## 3. Jornada por público

### Participante (prioridade 1)

| # | Passo | Onde hoje | Trava |
|---|---|---|---|
| 1 | Descobre a edição | landing (4 vezes) ou `/radar` | ok, mas a landing não diz se está aberta nem quantas vagas |
| 2 | Decide | `/h/[id]` | não há "sobre"; ação longe do topo no mobile |
| 3 | Se inscreve | `/h/[id]/inscricao` | ok; volta pra edição sem dizer o que vem depois |
| 4 | Fila/curadoria | botão da lateral muda de texto | posição da fila só no botão |
| 5 | Confirma presença (RSVP) | link do e-mail ou card no `/dashboard` | **nada na página da edição** |
| 6 | Ingresso QR | botão na lateral | ok, mas solto |
| 7 | Monta time | bloco "Meu time" na coluna principal | ok |
| 8 | Entrega | bloco de prazos → `/entrega` | só aparece depois de ter time |
| 9 | Final ao vivo | janela do palco | ok quando ao vivo |
| 10 | Resultado | seção "Resultado" no fim | longe |
| 11 | Certificado | `/dashboard` (lista) | **nada na página da edição** |
| 12 | NPS | e-mail/notificação | **nada na página da edição** |
| 13 | Portfólio | `/u/[username]` | ok, mas ninguém aponta pra ele depois do evento |

O `/dashboard` não junta nada disso por edição.

### Organizador (prioridade 2)

| # | Passo | Onde hoje | Trava |
|---|---|---|---|
| 1 | Descobre que dá pra rodar a edição aqui | faixa escura no fim da landing | **sem página, sem contato** |
| 2 | Fala com a Hack Inova | não existe (só `/empresas`, que é pra marca) | **trava total** |
| 3 | Opera a edição | `/admin/h/[id]` | ok pra quem já tem papel; sem atalho no dashboard |

### Patrocinador (prioridade 3)

| # | Passo | Onde hoje | Trava |
|---|---|---|---|
| 1 | Descobre | card "Pra marcas" no grid da landing, rodapé | escondido entre rotas |
| 2 | Entende a oferta | `/empresas` | fala de desafio, radar e talento; **não cita relatório automático, opt-in por QR nem NPS**, que existem desde a frente O |
| 3 | Contato | formulário de lead em `/empresas` | ok; admin só vê se abrir o `/admin` (sem notificação) |

## 4. Acesso e primeiro uso (adendo, pedido do dono em 14/10)

- **Tudo aberto.** Antes, só `/dashboard`, `/perfil` e `/admin` pediam
  login (`proxy.ts` com denylist). Radar, feed, membros, talento, projetos,
  blog, perfis completos, inscritos e mural de cada edição abriam pra
  qualquer um, e a própria plataforma fazia o papel de vitrine. A landing não
  precisava explicar nada porque dava pra entrar em tudo, e por isso mesmo não
  explicava: não havia motivo pra criar conta.
- **Sem primeiro uso.** Quem criava conta caía no `/dashboard` (o "feed" com
  compositor de post) sem dizer quem é nem o que quer. Perfil vazio, sem
  cidade/instituição (que a hora complementar pede), sem caminho por
  intenção (participar, organizar, mentorar, patrocinar).
- Correção (spec 039): allowlist de rotas públicas, teaser da edição e
  cartões mínimos de perfil/projeto pra divulgação, landing com as telas de
  dentro, e onboarding de 3 passos em `/bem-vindo`.
