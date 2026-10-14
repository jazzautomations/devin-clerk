# 038 — Certificado com carga horária e feedback do júri pro time

Roadmap 037 itens 2 e 9 (frente K). Migration `014_cert_hours_jury_feedback.sql`.

## Certificado com carga horária (#2)

- **Horas por papel** (participante, voluntário/staff, mentor, jurado,
  organizador) na aba `/admin/h/[id]/certificados`. Campo vazio = default
  pela duração da edição: com horário de início e fim, horas corridas
  arredondadas; só com data, 8 h por dia (inclusivo); sem fim, 8 h.
- **Congelamento**: na emissão o certificado grava papel, horas, período e
  instituição promotora. Reemitir só atualiza o detalhe (pódio). Mudar as horas
  depois vale só pra certificado novo. Certificado emitido antes da 014 fica
  sem horas e continua válido.
- **Presença mínima**: check-in sempre. Opcional: exigir entrega do time
  enviada até a trava (edição com prazo = versão em `project_submissions`;
  sem prazo = projeto cadastrado). Só vale pra participante.
- **Papéis**: organizador e staff dividem o certificado de organização; com os
  dois papéis, valem as horas de organizador. Premiação não tem horas (as horas
  estão no certificado de participação).
- **Instituição promotora**: texto livre; vazio = `hackathons.organizer`. Sai
  no PDF, em `/c/[code]` e no "adicionar ao LinkedIn" (organizationName).
- **CSV de hora complementar**: `GET /api/admin/hackathons/[id]/certificados/csv`
  (botão na aba). Uma linha por certificado, ordenada por instituição do aluno,
  depois curso, depois nome. Colunas: instituição do aluno, curso, matrícula,
  nome, e-mail, username, papel, tipo, carga horária, período, instituição
  promotora, código, link de verificação. Tem BOM UTF-8 (Excel) e proteção contra fórmula.

### Como mapear "curso" (o formulário não tem campo fixo)

O formulário de inscrição é livre (`edition_questions`). Na aba certificados,
"CSV de hora complementar", o organizador escolhe qual pergunta do formulário
de participante é **curso**, **instituição do aluno** e **matrícula/RA**. Se
não escolher, vale a primeira pergunta (ativas antes das arquivadas) cujo texto
casar com: `matrícula`/`RA`, `curso`, `instituição`/`faculdade`/`universidade`/`escola`.
Sem pergunta nenhuma, a coluna sai vazia: crie a pergunta na aba formulário
antes de abrir inscrição.

## Feedback do júri pro time (#9)

- O jurado escreve, além da nota, um comentário por critério e um geral pro
  time (`scores.feedback`, `jury_team_feedback`). O antigo `scores.comment`
  vira "nota interna pra organização" e **nunca** vai pro time. Esse comentário
  foi escrito antes, sem o jurado saber que o time ia ler.
- O time vê em `/p/[teamId]/feedback` (atalho na ficha do projeto, só pra
  membro) e em `GET /api/projects/[teamId]/feedback`: nota por critério e
  ponderada do time ao lado da média da edição (média das médias dos times
  avaliados) e comentários sem autor, ordenados por texto (não por jurado).
- Só aparece com resultado publicado **e** liberação ligada pela organização
  (`POST /api/admin/hackathons/[id]/juri/feedback {released}` na aba júri). A
  organização pode ligar antes e deixar armado, e pode recolher depois.
- Só membro do time logado. Jurado e organizador também levam 403 nessa
  rota, porque já têm a aba júri. API: 401 deslogado, 404 time inexistente,
  403 quem não é do time, 200 `{released:false}` antes da liberação, sem dado
  nenhum.
