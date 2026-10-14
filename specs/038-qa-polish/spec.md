# 038 — acabamentos do QA ponta a ponta (frente N)

**Status**: implementado · migration `016_qa_polish.sql`

Regras que o QA de 14/10 pediu e como ficaram. Teste de cada uma em
`tests/unit/*`, `tests/api/*` e, no que é público, `tests/e2e/qa-polish.spec.ts`
e `tests/e2e/stage.spec.ts`.

## 1–2. Funil e fila na visão geral

`/admin/h/[id]` mostra inscrições, aprovados, pendentes e o funil de presença:
confirmados, recusados, sem resposta (+ quantos perderam o prazo), na fila e
promovidos da fila (`lib/editionOverview.ts`). A posição de cada um na fila
continua na aba inscritos; o inscrito vê a própria posição no botão da edição.

## 3. Notificações

Estado de lida já existia. Agora: `/notificacoes` (todas, "marcar todas como
lidas"), `GET /api/notifications/[id]/open` (marca lida e redireciona; só
caminho interno; a de outra pessoa é 404) e o sino atualiza o contador a cada
minuto, ao voltar pra aba e quando a página marca tudo.

## 4. Aceite de membro de time

Criar time ou convidar depois manda **convite** (notificação in-app com link
pro "meu time"); só no aceite nasce a linha de `team_members`. Aceitar exige
continuar aprovado, sem time e com a formação aberta, e cancela os outros
convites da pessoa na edição. Quem convidou é avisado da resposta.

Convites em `team_invites`, não um status em `team_members`: a tabela segue
significando "está no time" pra todos os leitores (arquivo, júri, certificado,
voto, palco). Por isso os membros que já existiam continuam aceitos sem migrar
dado. O admin montando o arquivo de edição passada segue vinculando direto.

## 5. Quórum da escolha do público

`hackathons.audienceMinVotes` (default 10, editável no controle do palco). É o
**total de votos da final**, não por time. Abaixo dele o snapshot público não
traz ranking, telão e tela de voto mostram "votação sem quórum (X de N)" e o
selo na ficha do projeto some. A organização segue vendo a parcial.

## 6. Lista pública de inscritos × consentimento

O aceite da inscrição autoriza tratar os dados "para organizar o evento:
seleção, comunicação, credenciamento e certificados". **Não cobre exibir
publicamente quem se inscreveu**, e a página listava o @ e a foto de todo
aprovado. Decisão: manter a lista (prova social, achar time) como **opt-in
explícito**, separado do aceite:

- `registrations.publicListing`, padrão 0, inclusive pras inscrições antigas;
- caixa desmarcada no formulário e no 1-clique; o inscrito liga/desliga depois
  na própria lista (`PATCH /api/hackathons/[id]/register`);
- a página mostra o total (agregado) e só lista quem optou;
- excluir a conta zera o opt-in; a política de privacidade explica.

## 7. Programação acompanha a data da edição

Mudou o início no formulário da edição e há programação: aparece uma caixa
(desmarcada) com o deslocamento. Marcada, `PATCH /api/admin/hackathons/[id]`
recebe `shiftSchedule: true` e, na mesma transação da data, todos os itens
andam o mesmo delta, cada um sobe a `revision` (o `.ics` atualiza pelo UID com
SEQUENCE maior) e sai **um** aviso "a agenda mudou" pra aprovados, pendentes e
papéis. O delta é a diferença de relógio como o formulário mostra (sem fuso).

## 8. Username

- **Automático**: nome+sobrenome do Clerk, depois só o nome, depois o e-mail;
  slug sem acento, sem partícula (da/de/dos…), sem número, até 20 caracteres.
  Sufixo curto (`2`, `3`…) só quando colide; `hacker` se nada tiver 3 letras.
- **Troca única** no `/perfil` (`POST /api/members/me/username`): formato
  `[a-z0-9_]{3,20}`, sem reservados. Muda `members.username` e o vínculo em
  `team_members` na mesma transação; o antigo vai pra `username_redirects`,
  fica reservado (ninguém assume) e `/u/antigo` responde redirect permanente
  (308, o `permanentRedirect` do Next) pro novo.
- Certificados (`/c/[code]`) usam código próprio e `memberId`: não mudam.
- **Usernames feios existentes não são migrados em lote.** Trocar o @ de
  alguém sem pedir muda a identidade pública dela, e o texto congelado de
  notificações antigas (`actorUsername`) ficaria apontando pro nome velho.
  Quem tem um @ feio usa a troca única; o redirect cobre os links.
