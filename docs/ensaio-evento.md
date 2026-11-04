# Ensaio do evento — Hack Inova Alphaville 2026 (14/11)

Roteiro para rodar o fluxo operacional inteiro em **produção** antes do dia, com pessoas reais. Cada etapa lista a rota, quem executa e o resultado esperado. Meta: 45–60 min com 4 pessoas.

Edição: `hack-inova-alphaville-2026` — https://hackahub.jazzautomations.com.br/h/hack-inova-alphaville-2026

## Papéis

| Papel | Quem | Acesso |
|---|---|---|
| Organizador | jazzautomations | admin da edição |
| Staff/check-in | +1 conta | convidado em `/admin/h/[id]/equipe` |
| Jurado | +1 conta | convidado em `/admin/h/[id]/equipe` (papel jurado) |
| Participante A e B | +2 contas | inscrevem-se pelo site |

Contas de teste podem ser e-mails reais com `+ensaio` (ex.: `voce+ensaio@gmail.com`). Apagar depois ou deixar — o anonimizar cobre.

## 1. Inscrição (participante, ~5 min)

1. Abrir `/h/hack-inova-alphaville-2026` → botão de inscrição → `/h/hack-inova-alphaville-2026/inscricao`.
2. Entrar com Google. **Conferir**: perfil não pede de novo headline/cidade/instituição/curso/skills/telefone se já preenchido — só aceita termo, consentimento de imagem, restrições e perguntas da edição.
3. Esperado: inscrição criada, status visível no ingresso.

## 2. Aprovação (organizador, ~5 min)

1. `/admin/h/hack-inova-alphaville-2026/inscritos` → aprovar A, deixar B em lista de espera.
2. Esperado: A recebe confirmação; B vê "lista de espera" no ingresso. Aprovar B depois.

## 3. Ingresso + check-in (staff + participantes, ~10 min)

1. Participante abre `/h/hack-inova-alphaville-2026/ingresso` no celular — QR visível.
2. Staff abre `/admin/h/hack-inova-alphaville-2026/checkin` no celular → lê o QR de A e B.
3. Esperado: check-in registrado, presença aparece em `/admin/h/[id]/presenca`. Testar 1 check-in manual (contingência sem câmera).

## 4. Programação + desafio (organizador, ~5 min)

1. `/h/hack-inova-alphaville-2026/programacao` — conferir itens e countdown.
2. Publicar/confirmar desafio na página da edição/comunidade (`/comunidade/hack-inova/desafios/novo` se for por comunidade).
3. Esperado: desafio visível para inscritos, com prazo.

## 5. Time + entrega (participantes, ~10 min)

1. A e B formam time (convite por `/times` ou na página da edição).
2. `/h/hack-inova-alphaville-2026/entrega` — preencher rascunho, colar link do repo, **submeter**.
3. Esperado: estados rascunho → entregue → travado no prazo; projeto aparece na galeria `/h/hack-inova-alphaville-2026/projetos`.

## 6. Júri (jurado, ~10 min)

1. `/admin/h/hack-inova-alphaville-2026/juri` — ver rubrica (4 critérios), dar notas + feedback escrito no time.
2. Esperado: ranking calculado; feedback vai para o time; resultado só aparece quando o organizador liberar.

## 7. Palco + telão + voto (organizador + participantes, ~10 min)

1. `/admin/h/hack-inova-alphaville-2026/palco` — montar fila, iniciar apresentação com cronômetro.
2. `/h/hack-inova-alphaville-2026/telao` numa tela/TV — conferir timer, fila, bichos de quem fez check-in.
3. Participantes votam em `/h/hack-inova-alphaville-2026/votar`.
4. Esperado: timer corre na tela, votos computados sem fraude óbvia (1 voto/pessoa/projeto).

## 8. Certificado (organizador + participante, ~5 min)

1. `/admin/h/hack-inova-alphaville-2026/certificados` — emitir para A (com horas).
2. Participante abre o certificado e o link público de verificação.
3. Esperado: verificação abre **sem login**, com nome, edição e horas.

## 9. Social durante o ensaio (todos, ~10 min)

- Encontro: A abre `/h/hack-inova-alphaville-2026/encontros`, mostra código/QR → B confirma (os dois lados), expira em 15 min se não confirmar.
- Feed: 1 post em `/feed` marcando o time; 1 resposta em tópico da comunidade.
- Depoimento: A escreve depoimento para B (min 40 chars) → B aceita → aparece no perfil `/u/thiagop`.
- Recado: B deixa recado no perfil de A (se `recadosFrom` permitir).

## 10. Pós-evento (organizador, ~5 min)

1. `/admin/h/hack-inova-alphaville-2026/quatro-semanas` — grade times × semanas existe.
2. `/h/hack-inova-alphaville-2026/nps` — participante responde NPS.
3. `/admin/metricas` — conferir contadores do checkpoint (depoimentos aceitos, membros em comunidade).

## Checklist transversal

- [ ] Tudo no celular em **390px** sem scroll horizontal (Chrome DevTools ou iPhone real).
- [ ] Páginas públicas abrem **sem login**: edição, galeria, verificação de certificado, perfil aberto.
- [ ] Copy em pt-BR, sem "Orkut", sem emoji na tela.
- [ ] Anônimo não vê superfícies de contato (`canNetwork`).

## Após o ensaio

- Anotar cada quebra como issue; corrigir o que for bloqueante antes do dia 14.
- Opcional: remover inscrições de teste ou mantê-las (não poluem métricas públicas).
- Crontab das 4 semanas já instalada; digest e nível rodam sozinhos.
