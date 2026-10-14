# Feature Specification: HackaHub pra valer — a Hack Inova opera a edição inteira aqui

**Feature**: `033-hackinova-ops`
**Created**: 2026-10-13
**Status**: Draft
**Input**: Jazz, 13/10: "construir essa porra pra valer e hospedar na VPS asyn" +
"além de ser rede social de hackathons, é uma plataforma pra Hack Inova organizar
os hackathons sem o Carlão precisar mandar inscrição de Google Forms e criar grupo
no zap". Visual novo = design system do site da Hack Inova
(`hackinova-anhembi.vercel.app`).

## Tese

A rede social nasce fechada numa comunidade (Facebook/Harvard, Luma/primeira
comunidade). Nosso campus é a **Hack Inova**: cada edição dela roda 100% no
HackaHub — do anúncio ao certificado. Rede, radar e feed são a vitrine que cresce
em cima de gente que já está lá porque precisou se inscrever.

**Critério de pronto do produto**: uma edição real da Hack Inova abre inscrição,
se comunica com os inscritos, faz check-in, julga e entrega certificado **sem
Google Forms, sem planilha e sem grupo de WhatsApp criado à mão**.

## O que já existe (não refazer)

Página da edição `/h/[id]`, inscrição 1-clique, edição curada com fila de
aprovação (032), admin com edição/inscritos/CSV (004), times e projetos (021),
"procuro time" (012), voto popular (025), feed/comentários/notificação in-app,
radar raspado, perfis/XP/cartas, deploy tool (008).

## User Scenarios & Testing *(mandatory)*

### US1 — Organizador monta o formulário de inscrição da edição (P1)

O organizador define as perguntas da edição (texto curto, texto longo, escolha
única, múltipla, sim/não, com obrigatoriedade) — curso, universidade, tamanho de
camiseta, restrição alimentar, "já tem time?". O inscrito responde uma vez; o que
já está no perfil (nome, e-mail, GitHub, universidade) vem preenchido e não é
perguntado de novo.

**Aceitação**
1. Dado uma edição com 3 perguntas (1 obrigatória), quando o membro tenta se
   inscrever sem responder a obrigatória, então recebe 400 e a inscrição não é criada.
2. Dado respostas válidas, então a inscrição grava as respostas e o admin as vê
   na lista de inscritos e no CSV, uma coluna por pergunta.
3. Dado uma edição sem perguntas, a inscrição continua sendo 1 clique.
4. Consentimento LGPD (termos + política + finalidade do uso dos dados pela
   organização e parceiros nomeados) é uma caixa obrigatória e fica registrado
   com data e versão do termo.

### US2 — Avisos da edição substituem o grupo do zap (P1)

O organizador publica um aviso na edição ("credenciamento abre 8h", "link do
pitch"). O aviso aparece fixado na página da edição pra inscritos, gera
notificação in-app, e é entregue por **e-mail** e, se o inscrito optou, por
**WhatsApp** (envio individual, não grupo). Pode mirar todos, só aprovados, só
quem fez check-in, ou um time.

**Aceitação**
1. Aviso publicado → cada destinatário recebe exatamente 1 e-mail (idempotente
   por `aviso_id + membro_id`, reenvio não duplica).
2. WhatsApp só vai pra quem marcou opt-in e tem telefone validado; sem opt-in não sai nada.
3. Inscrito vê o histórico de avisos da edição em ordem, os não lidos destacados.
4. Falha de entrega fica registrada por destinatário e o admin vê "entregue /
   falhou" por canal.

### US3 — Canal de dúvidas da edição (P2)

Inscritos perguntam numa thread da edição (só quem está inscrito escreve e lê);
organização e mentores respondem e marcam como resolvida. Substitui o "alguém
sabe…" do grupo.

### US4 — Check-in no dia por QR (P1)

Cada inscrito aprovado tem um QR (token assinado, não o id cru) em `/h/[id]/ingresso`.
O staff, logado com papel de staff da edição, lê o QR no celular em
`/admin/h/[id]/checkin` e marca presença. Presença é o que vale pra carta,
XP e certificado.

**Aceitação**
1. QR lido 2× → segunda leitura responde "já fez check-in às HH:MM", sem duplicar.
2. QR de outra edição ou forjado → recusado.
3. Busca manual por nome/e-mail funciona sem câmera.
4. Contador ao vivo: inscritos / aprovados / presentes.

### US5 — Júri com rubrica (P1)

O organizador define critérios com peso (ex.: impacto 30, execução 30,
inovação 20, pitch 20) e convida jurados. Cada jurado avalia só os projetos
atribuídos, nota 1–5 por critério, comentário opcional. Ranking por média
ponderada, empate visível. Resultado fica oculto até o organizador publicar;
publicar alimenta o arquivo da edição (campeões) e o voto popular segue separado.

**Aceitação**
1. Jurado não vê nota de outro jurado nem o ranking antes da publicação.
2. Jurado não avalia projeto do próprio time.
3. Alterar peso recalcula o ranking sem perder notas.

### US6 — Certificado verificável (P2)

Ao encerrar a edição, cada presente recebe certificado PDF (participação,
mentoria, jurado, organização, premiação) com URL de verificação pública
`/c/[codigo]`. Sem presença, sem certificado.

### US7 — Papéis por edição (P1)

Hoje é "admin global". Passa a existir papel por edição: organizador, staff
(check-in), mentor, jurado. O organizador convida por e-mail. Admin global
continua existindo (Jazz/César).

### US8 — Visual da Hack Inova em todo o produto (P1)

Troca o tema dark-hacker pelo sistema editorial da Hack Inova (ver Design abaixo)
em todas as rotas, incluindo Clerk (`appearance`), OG images e e-mails.

### US9 — No ar de verdade (P1)

Produção na VPS asyn-oracle, domínio próprio com HTTPS, banco com backup
restaurado e testado, Clerk em instância de produção, logs e alerta. Ver
"Produção" abaixo.

## Edge Cases

- Inscrição esgota (limite de vagas): fila de espera em ordem, promoção
  automática quando alguém cancela, com aviso por e-mail.
- Organizador edita pergunta depois de haver respostas: respostas antigas
  continuam visíveis com o texto original da pergunta (versão congelada).
- Inscrito menor de idade: perguntar data de nascimento quando a edição exigir;
  menores de 18 exigem termo do responsável (ECA Digital — avaliar escopo antes
  de abrir edição com menores).
- E-mail rejeitado (bounce) marca o contato; não insiste.
- Pedido de exclusão (LGPD) apaga respostas e anonimiza o membro, mas mantém a
  contagem agregada da edição.

## Requirements *(mandatory)*

### Functional

- **FR-001** Formulário por edição: perguntas tipadas, versionadas, ordenáveis; respostas por inscrição.
- **FR-002** Consentimento registrado (versão do termo, data, IP) por inscrição.
- **FR-003** Avisos por edição com público-alvo e entrega in-app + e-mail + WhatsApp opt-in, idempotente por destinatário, com status de entrega.
- **FR-004** Thread de dúvidas por edição, restrita a inscritos + papéis.
- **FR-005** QR assinado (HMAC) por inscrição; check-in idempotente; busca manual.
- **FR-006** Rubrica com pesos, atribuição jurado↔projeto, conflito de interesse bloqueado, resultado com publicação explícita.
- **FR-007** Certificado PDF com código verificável público.
- **FR-008** Papéis por edição (organizador, staff, mentor, jurado) com convite por e-mail.
- **FR-009** Limite de vagas + fila de espera.
- **FR-010** Telefone + opt-in de WhatsApp no perfil, separados do consentimento de e-mail.

### Key Entities

`edition_questions(id, hackathon_id, version, kind, label, options, required, position)`
· `registration_answers(registration_id, question_id, question_version, value)`
· `consents(member_id, hackathon_id, terms_version, accepted_at, ip)`
· `announcements(id, hackathon_id, audience, title, body, created_by, created_at)`
· `deliveries(announcement_id, member_id, channel, status, error, sent_at)`
· `checkins(registration_id, at, by_member_id)`
· `edition_roles(hackathon_id, member_id, role)`
· `rubric_criteria(hackathon_id, label, weight)` · `judge_assignments` · `scores`
· `certificates(code, member_id, hackathon_id, kind, issued_at)`

## Design (US8) — sistema Hack Inova

Fonte: `hackinova-anhembi.vercel.app/site.css`. Tokens:

| Token | Valor | Uso |
|---|---|---|
| `--bg` / `--paper` | `#fefefe` | fundo |
| `--ink` / `--line` | `#0c0c0c` | texto, fios de 1px |
| `--muted` | `#474747` | texto secundário |
| `--green` | `#047a43` (hover `#064f3e`) | ação, links, destaque |
| `--mint` | `#d8f4e5` | seção destacada, aviso |
| `--orange` | `#ba3919` | foco (`:focus-visible`), erro |
| `--dark` | `#0c0c0c` | faixas invertidas, rodapé |
| raio | 0 nos blocos, 6px em botão/campo | |

Tipografia: **Archivo** (títulos 800–850, tracking negativo), **JetBrains Mono**
(números, labels, dados), **VT323** só como acento pixel (contador, carta).
Linguagem visual: editorial, fios pretos em vez de cards com sombra, "ficha
técnica"/ingresso pra data e local, faixa escura pra jornada, listas numeradas
em mono verde. Sem gradiente, sem glow, sem emoji na UI. Dark mode: derivar
(ink↔paper, verde `#38e08a`), sem ser o padrão.

Raridade das cartas mantém as cores próprias, ajustadas pra contraste em fundo claro (WCAG AA).

## Produção (US9)

Decisões:

- **Host**: VPS asyn-oracle (`64.181.217.112`), app como serviço systemd atrás do
  Caddy que já serve os outros sites. Ambiente de **staging** separado
  (porta e banco próprios) antes de prod.
- **Banco**: Postgres em container (mesmo padrão do `oneiro-pg`), banco e
  usuário próprios. Migração da camada `better-sqlite3` (síncrona, ~100
  chamadas em 29 arquivos) pra driver assíncrono; migrations versionadas;
  índices nas colunas filtradas (`hackathon_id`, `member_id`, `created_at`).
- **Backup**: `pg_dump` diário com rotação, cópia fora da VPS, **restauração de
  teste feita e datada** em `docs/runbook.md`.
- **Auth**: Clerk instância de produção no domínio próprio (claim + DNS: é tarefa do fundador).
- **E-mail**: provedor transacional (Resend) com SPF/DKIM/DMARC no domínio.
- **WhatsApp**: Evolution API já operada pelo Jazz, envio individual com opt-in.
  Número dedicado da Hack Inova, não o pessoal.
- **Deploy tool (008)**: roda código de terceiros. Na VPS que também hospeda o
  settlement do ASYN fica **desligado** até ter o isolamento de rede do
  devin-clt (sem caps, rootfs read-only, bridge isolada sem acesso a
  metadata/RFC1918/tailnet).
- **Observabilidade**: log estruturado, uptime externo, alerta em erro 5xx e
  em backup que não rodou.
- **LGPD**: política e termos específicos (não template), canal do titular
  funcionando (export e exclusão já existem em parte), encarregado nomeado.

## Success Criteria *(mandatory)*

- **SC-001** Uma edição real da Hack Inova roda do anúncio ao certificado no HackaHub, com zero Google Form e zero grupo de WhatsApp criado à mão.
- **SC-002** Inscrição de membro novo (cadastro + formulário) em < 3 min no celular.
- **SC-003** Check-in de 1 pessoa por QR em < 5 s.
- **SC-004** 100% dos avisos entregues ou com falha registrada por destinatário.
- **SC-005** Backup restaurado em staging com sucesso, datado no runbook.
- **SC-006** `npm run test` e `test:e2e` verdes, lint/typecheck/build limpos, 390px sem scroll horizontal em todas as rotas.

## Fora de escopo

Pagamento de ingresso, app mobile, multi-organização externa (white-label), deploy tool ligado em prod.

## Pendências que só o fundador resolve

Domínio definitivo · claim do Clerk e instância prod · conta no Resend + DNS ·
número de WhatsApp da Hack Inova · encarregado LGPD nomeado · texto jurídico dos
termos · data da próxima edição (vira o prazo do SC-001).
