---
title: "Guia: deploy da demo em 5 min com o hackahub"
description: Do repo público no GitHub pra uma URL ao vivo /demo/id — Dockerfile, package.json ou index.html, sem mexer em nginx, porta ou conta de cloud.
date: 2026-10-05
author: equipe hackahub
tags: [guia, deploy, demo]
---

O projeto do hackathon não pode morrer num `git push`. Com a ferramenta de deploy do HackaHub, qualquer repo público do GitHub vira uma URL funcionando `hackahub.dev/demo/<id>` — pra mostrar pro jurado, pro sponsor ou pro recrutador sem instalar nada.

## O que você precisa

- Um **repo público no GitHub** com o projeto
- Ser **membro do time** no arquivo da edição (o organizador vincula os usernames) ou admin
- 5 minutos

## Passo a passo

1. Abra a página da edição — ex.: [/h/hack-inova-unifacens-2026](/h/hack-inova-unifacens-2026)
2. Ache o card do seu time na seção de resultado
3. Se o projeto já tem `repo →` cadastrado, é só clicar em **deploy**; senão, cole a URL do repo no painel
4. Aguarde o status subir: `queued → building → running`
5. Quando `running`, a demo já responde em `/demo/<id>` — manda o link

```txt
POST /api/projects/[teamId]/deploy { "repoUrl": "https://github.com/time/projeto" }
→ 202 { deployId }
GET  /demo/<id>/  → sua app ao vivo
```

## Stacks que funcionam direto

- **Dockerfile no repo** → build direto; a app deve ouvir na porta `8080` (a gente injeta `PORT=8080`)
- **package.json** (Node/Next) → Dockerfile gerado: `npm install`, `npm run build`, `npm start`
- **Site estático** (só `index.html`) → servidor `python -m http.server` automático
- **Outra stack** → passe `startCommand` no deploy e a gente usa ele como CMD

## Limites honestos

- **TTL de 72h** — demo é pra mostrar o projeto, não pra hospedar produto; expirada, vira tombstone com link pro repo
- **1 deploy ativo por projeto**, máximo 3 rodando por membro — recurso da máquina é finito
- **SPA com paths absolutos** (`/assets/app.js`) pode quebrar sob `/demo/<id>/` — use caminhos relativos ou configure o base path da app
- **Repo privado falha** no clone — só GitHub público

## Por baixo do capô

Cada deploy é um container isolado (memória/CPU limitados, read-only, sem privilégios) publicado só em `127.0.0.1` — quem fala com a internet é o proxy do Next em `/demo/[id]`. Admin tem kill-switch e lista de inventário no `/admin`.

## TL;DR

Repo público → botão deploy no card do time → URL `/demo/id` em ~5 min. A próxima demo que um jurado vai abrir pode ser a sua.
