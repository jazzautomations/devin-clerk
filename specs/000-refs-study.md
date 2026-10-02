# Estudo de referências — AI Tinkerers · Colosseum · Devpost

> Pesquisa real (páginas internas via fetch, não só homepage).
> Atualizar quando as features derivadas forem implementadas.

## AI Tinkerers (aitinkerers.org)

Modelo: **capítulos por cidade** — 264 cidades, cada uma com
organizador próprio e mini-site (subdomain `cidade.aitinkerers.org`).
Stats públicos na home: 135k membros / 264 cidades.

O que eles têm que a gente não tem:

- **"Apply to attend"** — presença é *curada*, não aberta. Aplicação →
  organizador aprova. A curadoria é parte da marca ("Always Curated").
- **Cidade como entidade**: cada capítulo mostra "Last: 1w ago /
  Next: Oct 27" — vitalidade visível por capítulo.
- **Organize a city** — qualquer um vira organizador local (nossa visão:
  organizador cria edição via /admin — hoje só admin global).
- **Talent**: "warm intros backed by demos, shipped projects, talks" —
  posicionamento de talento é *intro quente*, não diretório.
- **Sponsor page**: wordmark wall de quem confia (OpenAI, Anthropic…)
  + 3 CTAs de escopo (global / capítulo local / programa digital).
- **Jobs board** separado de talento.
- **Resources**: newsletter própria (Post-Training/Substack), Paper
  Club, One-Shot, Virtual Events — conteúdo como produto separado.
- Detalhe de personalidade: banner de cookie em shell script
  (`$cat /etc/cookies.conf`). Nosso equivalente = tom mono/arcade.

## Colosseum (colosseum.com)

Modelo: **funil contínuo** — hackathon (2x/ano) → Eternal (sprint
perpétuo de 4 semanas entre hackathons) → Accelerator → Portfolio.

O que eles têm que a gente não tem:

- **Eternal**: entre edições, builder liga um timer próprio e faz um
  sprint de 4 semanas com **update de vídeo de 1 min por semana**;
  Eternal Award $25k semi-anual. Equivale ao nosso "feed por edição" +
  submissão contínua fora de ciclo.
- **Histórico de campanhas**: cada edição é card com **N projetos**
  ("2,858 projects") — a contagem de submissões é a prova.
- **"Earn your place"** — trajetória do builder entre edições:
  "competiu 4x: honorable mention → 1st track → grand prize". Nosso
  perfil tem campanhas mas não mostra o ARCO (posições ao longo do tempo).
- **Submission portal rico**: projeto = pitch — nome, descrição,
  stack, teammates + backgrounds, localização, **logo**, repo,
  **vídeo de apresentação 2-3min**, **vídeo de demo ≤3min**, GTM.
  Nosso team_project é raso (title/desc/repo/demo) — adicionar
  `videoUrl`/`logoUrl` é barato e aumenta muito o valor do arquivo.
- **FAQ dedicado** por hackathon.
- Julgamento por líderes do ecossistema (judges como status social).
- Portfolio page é rasa por design: logo+nome+país+site. Prestígio
  vem de ESTAR no portfolio, não da página.

## Devpost (devpost.com)

Modelo: **marketplace de hackathons** + diretório de software
(`/software` = projetos de todos os tempos).

O que eles têm que a gente não tem:

- **Filtros de verdade**: location, status (upcoming/open/ended),
  duração (1-6d/1-4sem/1+mes), interest tags (24), host, open-to
  (public/invite-only). Nosso radar filtra formato+cidade apenas.
- **Card = decisão em 3s**: thumbnail, "21 days left", **prêmio em
  destaque** ($138,000), N participantes, datas. Nossos cards não
  mostram prêmio — e Devpost API TEM o campo (não raspamos).
- **"Managed by Devpost"** — selo de confiança na listagem (nosso
  equivalente: "oficial hackahub" nas edições da comunidade/parceiras).
- **Devpost for Teams** — hackathon interno de empresa = white-label.
  (Já nosso roadmap: "operação white-label" — é a 4ª linha de receita.)
- Sorts: relevance / submission date / recently added / **prize amount**.

## Concorrentes diretos

### Shawee (shawee.io) — O concorrente BR direto

Plataforma de hackathon B2B brasileira (SP, desde 2017, do Cubo Itaú).
300+ edições, 40k+ participantes impactados. Clientes: Microsoft,
Banco Original, CCR, Órama, Mercado Pago (desafios proprietários).

- **Modelo**: empresa paga e a Shawee opera o hackathon inteiro
  (idealização → inscrições → times → avaliação). É agência+plataforma.
- **Mega Hack** = evento flagship próprio (multi-marca, milhares de
  participantes). Equivalente às edições Hack Inova — first-party.
- **Mega Rank** = ranking nacional de devs — *o mesmo produto que nosso
  /membros*, posicionado como "vitrine de talento pra empresa parceira".
- Pitch = **employer branding** com stats de RH (reputação ruim custa
  10%+ por contratação; branding reduz 28% de churn).
- **Mídia kit baixável** pra sponsor. Plataforma **grátis pra ONG,
  universidade e comunidade** — boa vontade que gera pipeline.
- Fraqueza: site é institucional, comunidade não é produto; sem rede
  social, sem arquivo público navegável rico, sem perfil persistente
  com XP/coleção. Ganhamos no *produto*, perdemos em *marca/vendas*.

### TAIKAI (taikai.network)

- **PoP badge** verificável de participação — nosso equivalente =
  cartinhas colecionáveis (somos mais fortes: serial+raridade).
- **Votação comunitária** $VOTE com leaderboard de projetos —
  "people's choice". Gap real nosso: arquivo é só pódio do júri.
- Matchmaking de times (nosso procuro-time é equivalente).
- Submission dashboard rico (imagens/vídeos/anexos).
- Host a hackathon = produto pra organizadores + consultoria +
  AI Program. Tier de serviço além do SaaS.
- Até MCP connector pra assistente de AI navegar submissões/votar.

### Lablab.ai

- O "hackathon de IA" semanal: posse de nicho (AI Hackathons).
- AI Apps gallery = projetos publicados contínuos (nosso /projetos).
- Tutorials/Articles como engine de conteúdo (nosso /blog).
- Lição: nicho vence — "hackathon de IA no Brasil" é nossa posição
  natural (edições são IA×saúde, IA×pagamentos…).

### DoraHacks (dorahacks.io)

- 350k hackers, 832 hackathons, 41k "builds" submetidos.
- **Stats com momentum**: "+3,656 in last 30 days" — prova de vida.
- Organizer dashboard com **AI-assisted review/judging** — o que
  venderia pra outros organizadores quando white-labelar.
- "Build Your Hacker Brand" — perfil = identidade persistente
  (igual nossa visão; eles não têm XP/coleção).
- Bounties/quadratic funding heritage — funding layer possível.

### Café Bugado (eventos.cafebugado.com.br)

Agregador de eventos tech BR — comunidades **submetem** eventos e
eles curam. Não é hackathon ops; é discovery+comunidade.
Relevância: modelo de **submissão comunitária** (qualquer comunidade
indica evento → fila de curadoria no /admin) e **potencial parceiro/
canal**, não concorrente. Nosso radar hoje é scrape+curadoria; a
submissão comunitária é o terceiro canal.

## Mapa → nosso backlog (ordem)

| Gap | Feature derivada | Esforço |
|---|---|---|
| prêmio nos cards | scraper captura `prize` do Devpost + campo no modelo | S |
| trajetória do builder | perfil mostra arco de colocações por edição | S |
| feed por edição | posts.hackathonId → atividade ao vivo na página | M |
| vídeo/logo no projeto | team_projects + videoUrl, logoUrl; form de submissão | S |
| prize sort/filtro | radar ordena por prêmio quando tiver | S |
| apply-to-attend | editions podem exigir aprovação do organizador | M |
| capítulos/cidades | organizer por cidade (visão, não agora) | L |
| judges | personas "jurado" com role visível na edição | M |
| eternal | sprint contínuo fora de edição (v2+) | L |

## O que já somos melhores que todos os três

- **Deploy tool** — repo → URL ao vivo. Nenhum deles deploya demo.
- **Cartinhas colecionáveis** com serial — prova de presença real.
- **Radar BR+mundo raspado** — Devpost é US-cêntrico; Colosseum é
  só crypto; AI Tinkerers não é hackathon. Nossa curadoria BR +
  automação é o nicho vazio.
