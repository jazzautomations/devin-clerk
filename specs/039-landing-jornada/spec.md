# 039 — Landing e jornada

Diagnóstico com prints: `diagnostico.md`. Resumo: a landing fala com todo
mundo e com ninguém, a próxima edição aparece 4 vezes sem dizer o que
fazer, o organizador não tem porta, e a página da edição e o dashboard
espalham os estados da jornada (inscrição, presença, ingresso, entrega,
resultado, certificado) em lugares diferentes.

## Referências estudadas (o que foi pego de cada uma)

- **Luma (página de evento)**: o bloco de inscrição muda de estado no mesmo
  lugar ("Register" → "You're going" → ingresso/agenda). Pegamos: **um
  painel só, no topo, que muda conforme o estado da pessoa**.
- **ETHGlobal (dashboard do hacker)**: cada evento ativo vira um checklist
  com a etapa atual (aplicar → aceito → confirmar presença → time → entregar
  → julgamento). Pegamos: **trilho de etapas com a atual marcada** e o
  dashboard como lista de "próximo passo" por edição.
- **Colosseum**: a vitrine de vencedores é prova (projeto, prêmio, time) e
  vem antes de qualquer pitch de plataforma. Pegamos: **campeões reais na
  landing**, puxados do arquivo.
- **MLH**: separa com clareza quem vai competir de quem organiza
  (páginas e CTAs próprios; código de conduta sempre à mão). Pegamos: **CTA
  e página por público** e conduta como link fixo na edição.
- **linear.app / vercel.com (hierarquia)**: um H1, uma frase de apoio, dois
  CTAs, prova logo abaixo e cada seção com uma ideia e uma imagem real do
  produto. Pegamos: **ordem e densidade**, e prints reais em `/organizar`.

A identidade continua a da Hack Inova (papel, tinta, verde, fios de 1px,
Archivo + JetBrains Mono, VT323 só de acento, sem sombra/gradiente/glow).

## Mudança de escopo do dono (14/10)

"Tá tudo aberto, a landing tem que explicar a porra toda e aí a plataforma
inteira a pessoa entra só depois que cadastra" + "tem que ter onboarding
também". Duas consequências: (1) acesso por **allowlist** e a landing passa a
mostrar as telas de dentro; (2) onboarding curto em `/bem-vindo`.

### Acesso (`lib/access.ts` + `proxy.ts`)

Allowlist: o que não está na lista exige login. Página privada sem sessão →
307 pra `/sign-up?redirect_url=<caminho>`; API privada sem sessão → 401
`{"error":"Unauthorized"}` (as rotas seguem checando sessão sozinhas).

| Rota | Sem conta | Por quê |
|---|---|---|
| `/` | pública | explica o produto pros 3 públicos, com prints das telas de dentro |
| `/organizar` | pública | porta do organizador + contato |
| `/empresas` | pública (exceção) | porta do patrocinador; lead sem conta (spec 022) |
| `/legal/*`, `/sign-in`, `/sign-up` | pública | |
| `/c/[code]`, `/c/[code]/pdf` | pública (exceção) | verificação de certificado: recrutador e LinkedIn |
| `/h/[id]` | **teaser** | nome, data, local, prêmio, desafios, patrocinadores, CTA "criar conta e se inscrever" (volta pra `/h/[id]/inscricao`) |
| `/h/[id]/conduta` | pública | é termo |
| `/h/[id]/incidente` + `POST /api/hackathons/[id]/incidents` | pública | relato anônimo, por segurança |
| `/h/[id]/telao` + `GET /api/hackathons/[id]/stage(/stream)` | pública | telão no projetor, como já era |
| `/h/[id]/programacao.ics` | pública (exceção) | assinatura webcal: app de calendário não loga |
| `/u/[username]` | **cartão mínimo** | nome, headline, personas, nº de edições + CTA |
| `/p/[teamId]` | **cartão mínimo** | título, edição, time, prêmio + CTA |
| `/rsvp/[token]` + `/api/rsvp/[token]` | pública (exceção) | link assinado do e-mail de confirmação |
| `/demo/*` | pública (exceção) | app publicado do time roda no proxy, sem login |
| `/api/me/calendar/[token]` | pública | feed .ics pessoal assinado |
| OG images, `/sitemap.xml`, `/robots.txt`, `/api/health` | pública | sitemap só lista o que é público; robots bloqueia a área logada |
| `/api/leads`, `/api/subscribe`, `/api/webhooks/*`, `/api/cron/*` | pública | formulário público / assinatura ou segredo próprio |
| todo o resto (radar, feed, membros, projetos, talento, blog, dashboard, perfil, notificações, admin, inscrição, ingresso, entrega, programação, projetos da edição, dúvidas, votar, NPS, candidatura, feedback, APIs) | **login** | |

### Onboarding (`/bem-vindo`)

- 3 passos, barra de progresso, voltar e "pular por agora":
  1. quem é você (personas, até 4) e o que quer aqui (participar,
     organizar, mentorar/julgar, patrocinar);
  2. nome de exibição, headline, cidade/UF, instituição e curso (opcionais;
     ajudam a hora complementar). Foto vem do Clerk. Sem data de nascimento.
  3. GitHub, LinkedIn (`normalizeSocial`) e opt-in no diretório de talentos
     (o `openTo` que já existia).
- Fim: tela "teu próximo passo" (`onboardingNext`): `redirect_url` ganha de
  tudo (link de edição → volta pra inscrição); senão participar → próxima
  edição aberta (ou radar), organizar → `/organizar#contato`, mentorar →
  candidatura aberta (ou painel), patrocinar → `/organizar#patrocinio`.
- Quando aparece: o proxy manda pro `/bem-vindo` a 1ª página **logada** de
  quem não tem o cookie `hh_onb` (= userId). Decisão: proxy + cookie, sem
  consulta ao banco por request. O `/bem-vindo` consulta o banco uma vez:
  membro já onboarded só ganha o cookie (`/api/onboarding/ok`) e volta.
  `/bem-vindo`, `/api/*` e sign-in/up ficam fora (sem loop). Página pública
  não força.
- Persistência: migration `018` (a mesma do lead `organizar`):
  `onboardedAt`, `intents`, `city`, `institution`, `course`. Quem já tem
  conta não é forçado: o backfill marca `onboardedAt = createdAt` pra todos
  os membros existentes (com ou sem perfil preenchido).
- Pulou? Lembrete discreto (completude do perfil em %) no painel e no
  `/perfil` até completar; "completar" reabre o `/bem-vindo?refazer=1`.

## Nova IA

Header (todas as rotas):

- marca `HACKAHUB /hack inova` → `/`
- logado: **hackathons** (`/radar`) · **projetos** (`/projetos`) · **comunidade**
  (`/membros`) · **organizar** (`/organizar`)
- sem conta: **como funciona** (`/#como-funciona`) · **por dentro**
  (`/#por-dentro`) · **organizar** · **patrocinar** (`/empresas`)
- deslogado: `entrar` + botão `criar conta` (o cadastro cai no painel, que passa pelo `/bem-vindo`)
- logado: **meu painel** (`/dashboard`) + sino + avatar
- link ativo com `aria-current="page"` e sublinhado fixo
- mobile (< lg): marca + ação principal + botão "menu" que abre um painel
  com os mesmos links, fecha com Esc, clique no link ou troca de rota

Saem do header: `feed`, `talento`, `blog`, `perfil` (vão pro rodapé; perfil
fica no dashboard).

Rodapé: Participar (hackathons, projetos, comunidade, feed, talento) ·
Organizar (organizar uma edição, patrocinar, blog) · Legal.

## Landing `/` — seção por seção

| # | Seção | Objetivo |
|---|---|---|
| 0 | Faixa da próxima edição (se houver) | data + nome + "inscrições abertas ▸" |
| 1 | Hero: "Sua comunidade de hackathon." + apoio + CTA primário (inscrever na próxima edição; sem edição aberta → hackathons abertos) + secundário (organizar) | uma decisão por público em 5 segundos |
| 1b | Ficha da próxima edição (ingresso) ao lado do hero: data grande, local, formato, inscritos, vagas, prazo | responde "tá aberta? quando? onde?" sem clicar |
| 2 | Prova (do banco): edições realizadas, inscrições, projetos entregues, membros | só número real; cada item some se for 0; a seção some se tudo for 0 |
| 3 | Como funciona pra quem participa: 5 passos numerados (achar → inscrever → confirmar e ingresso → time e entrega → certificado, carta e portfólio) | mostra a jornada inteira antes de pedir conta |
| 3b | Por dentro: 4 prints reais das telas logadas (edição com próximo passo, meu painel, hackathons abertos, perfil) | quem não tem conta vê o que ganha ao entrar |
| 4 | Próximas edições: lista com data, nome, local e estado | ação direta; "ver todos" → `/radar` |
| 5 | Vitrine: campeões do arquivo (pódio com projeto, edição e time) | prova de que sai coisa daqui; some sem dado |
| 6 | Faixa escura "Pra quem organiza": ciclo da edição em 6 etapas, só com o que existe no código | vende o produto pro organizador; CTA `/organizar` |
| 7 | Pra patrocinador: desafio próprio, relatório automático, contatos com opt-in por QR, NPS | CTA `/empresas` |
| 7b | Tua conta: o que vem com o cadastro + CTA criar conta | fecha a decisão de entrar |
| 8 | FAQ curto (6 perguntas, inclui "por que preciso de conta") | tira a dúvida que impede a inscrição |
| 9 | Newsletter (já existia) | captura quem não vai se inscrever agora |

Sai da landing: leque de cartas (mostrava "0 mintadas"), mesa de janelas
(duplicava stats e próxima edição), grid de 6 rotas, letreiro.

## Jornada do participante e o "próximo passo"

Helper puro `nextStep(facts)` em `lib/nextStep.ts` decide, a partir do
estado da pessoa na edição, **um** próximo passo: rótulo de status, ação
(texto + link) e etapa no trilho. `getNextStepFacts()` junta os dados do
banco. O mesmo resultado aparece no topo de `/h/[id]` e em cada card do
`/dashboard`.

Trilho: **inscrição → presença → check-in → entrega → resultado →
certificado**.

| Estado | O que a pessoa vê | Ação |
|---|---|---|
| edição de fora (radar) aberta | "Inscrição no site oficial" | link externo |
| encerrada sem participação | "Edição encerrada" | ver resultado |
| inscrição fechada, sem inscrição | "Inscrições encerradas" | ver projetos/mural |
| aberta, sem inscrição | "Inscrições abertas" | fazer inscrição (formulário) |
| curada, sem inscrição | "Edição com curadoria" | pedir lugar |
| lotada, sem inscrição | "Vagas esgotadas" | entrar na fila de espera |
| candidatou-se pra ajudar | "Candidatura de mentor em análise" | ver candidatura |
| pedido pendente | "Pedido em análise" | — (cancelar continua no botão) |
| fila de espera | "Na fila — posição N" | — (sai da fila no botão) |
| recusado | "Não rolou dessa vez" | ver outras edições |
| aprovado, RSVP pendente | "Confirma tua presença até X" | confirmar presença |
| aprovado, final ao vivo, com check-in | "Final ao vivo" | votar |
| aprovado, dia do evento, sem check-in | "Mostra o QR na entrada" | meu ingresso |
| aprovado, sem time, antes do prazo de entrega | "Monta teu time" | meu time |
| aprovado, entrega aberta, rascunho/sem envio | "Entrega até X" | abrir entrega |
| aprovado, entrega enviada | "Entrega enviada" | ver entrega |
| aprovado, antes do evento, com time | "Inscrição confirmada" | meu ingresso |
| encerrada, participou, NPS aberto sem resposta | "Conta como foi" | responder pesquisa |
| encerrada, com certificado | "Certificado emitido" | baixar certificado |
| encerrada, participou | "Edição encerrada" | ver resultado / teu portfólio |

Depois: certificado (`/c/[code]`), carta e trajetória no perfil público
(`/u/[username]`), feedback do júri (`/p/[teamId]/feedback`).

## Página da edição `/h/[id]`

1. Faixa (data · formato · local · estado).
2. Hero: nome, realização, tags; à direita a ficha única (data, local,
   formato, inscritos, vagas, prazo). A `<dl>` duplicada da lateral sai.
3. **Painel "teu próximo passo"** logo abaixo do hero, largura total:
   trilho de etapas, status, ação principal e, quando cabe, o botão de
   inscrição/cancelamento que já existia (`RegisterButton`), mais atalhos
   (programação, dúvidas, conduta).
4. Coluna principal: avisos, agora/a seguir, contagem, prazos, meu time,
   desafios, resultado, procurando time, mural, patrocinadores.
5. Lateral: final ao vivo, links da edição, carta, inscritos, "Quer
   ajudar?" no fim.

## Dashboard `/dashboard`

1. Saudação + atalhos (perfil público, editar perfil, admin se for).
2. **Teu próximo passo**: um card por edição ativa (inscrito ou candidato),
   com o trilho e a ação. Sem edição: chamada pra próxima edição aberta.
3. Edições em que a pessoa é da equipe → atalho pro painel da edição.
4. Certificados.
5. Progresso (XP, badges, carta) e histórico de presença.
6. Hackathons abertos (lista curta → `/radar`) e o mural da comunidade.

Sai: "vindo por aí" (COMING SOON) e a caixa "keep_building/Devin".

## `/organizar`

Hero ("Tua edição, do formulário ao certificado."), o ciclo da edição em 6
etapas com print real de tela do painel (dados de demonstração, legendado),
o que a pessoa participante recebe, e contato: formulário simples gravando
em `leads` com interesse novo `organizar` (migration `018`) e notificação
in-app pros admins. Sem `mailto:`: o repo não tem e-mail de contato oficial e não vamos inventar um.

## Fora de escopo

Mudar regras de inscrição, RSVP, entrega ou júri; novo componente pesado;
lib nova de animação/ícones.
