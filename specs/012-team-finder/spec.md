# Spec 012 — "Procuro time" (formação de equipe por edição)

> Status: draft — implementar no próximo ciclo. Inspirado no
> Cofounder Matching do Colosseum + na dor real de hackathon:
> chegar sozinho e não ter com quem montar equipe.

## Problema

Quem se inscreve solo num hackathon passa o evento inteiro tentando
achar time no WhatsApp improvisado. A plataforma que resolve isso
captura o momento mais importante do funil: a formação da equipe.

## User stories

### US1 — Inscrito marca "procuro time" — P1

Na página da edição (`/h/[id]`), membro inscrito ativa um toggle
"procuro time" e descreve o que busca (skills oferecidas + o que falta
no time: "dev front + alguém de dados"). A entry aparece no board da
edição com link pro perfil público.

### US2 — Visitante/inscrito explora o board — P1

`/h/[id]` ganha seção "achar time": lista de quem tá procurando, com
skills, headline, o que busca, e link pro perfil/contato. Público pra
ler (prova social), autenticado pra postar.

### US3 — Admin/modelo de time fecha a formação — P2

Quando o time se forma, o membro desativa o anúncio. Admin pode
esconder entry abusiva (moderar). Vincular anúncio → time do arquivo
quando a edição vira histórico é v2.

## Requisitos funcionais

- FR-001: tabela `looking_for_team` — memberId + hackathonId (UNIQUE
  par), skills TEXT[], need TEXT (o que falta), note TEXT, active,
  createdAt.
- FR-002: só pode anunciar quem tá **inscrito** na edição
  (registration existe) — senão o board vira spam.
- FR-003: POST/DELETE `/api/hackathons/[id]/team-board` — auth,
  upsert do próprio anúncio; DELETE desativa.
- FR-004: GET público lista anúncios ativos da edição com
  username/skills/headline/persona.
- FR-005: XP: +10 por anunciar (primeira vez — incentiva completar).
- FR-006: contagem no header da edição ("12 procurando time").
- FR-007: auto-desativar quando a edição passa (sweep ou filtro por
  data na query — preferir filtro: dados históricos ficam).
- FR-008: admin pode `active=0` qualquer anúncio (moderação).

## Edge cases

- Anunciar sem estar inscrito → 403 com mensagem "inscreve-te primeiro".
- Re-anunciar atualiza o existente (upsert), não duplica.
- Edição encerrada → board aparece como histórico? v1: esconde o
  composer, ainda lista (as pessoas podem ter formado times visíveis
  no arquivo).
- Anúncio vazio/sem need → 400.

## Monetização tie-in

O board é também **talent discovery**: sponsors/empresas veem quem
tá disponível + skills — é o embrião do "talent" do PRD. Sem paywall
pra participante; empresas verão esse board no futuro tier comercial.
