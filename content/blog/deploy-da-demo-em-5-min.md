---
title: "Guia: deploy da demo em 5 min com o hackahub"
description: Como publicar a demo do seu time a partir de um repositório público no GitHub, quando a publicação de demos estiver ligada no HackaHub.
date: 2026-10-05
author: equipe hackahub
tags: [guia, deploy, demo]
---

Este guia vale quando a publicação de demos estiver ligada no HackaHub. Com ela ligada, um repositório público do GitHub vira um endereço `/demo/<id>` no próprio site, pra você mostrar o projeto pro júri ou pra quem patrocina sem instalar nada.

A publicação de demos ainda está desligada. Quando ela for ligada, o card do seu time vai mostrar o botão **publicar demo**. Enquanto o botão não aparecer, mande o link do repositório.

## O que você precisa

- Um **repositório público no GitHub** com o projeto
- Estar no **time** na página da edição
- 5 minutos

## Passo a passo

1. Abra a página da sua edição
2. Ache o card do seu time
3. Se o repositório já está cadastrado, clique em **publicar demo**. Se não estiver, cadastre o repositório primeiro
4. Espere o status passar de **na fila** pra **publicando…** e depois pra **ao vivo**
5. Com a demo ao vivo, o endereço `/demo/<id>` já funciona. É só mandar o link

## O que funciona direto

- **Dockerfile no repositório**: a gente usa ele. A aplicação deve ouvir na porta `8080` (a variável `PORT=8080` já vem definida)
- **package.json** (Node ou Next): a gente roda `npm install`, `npm run build` e `npm start`
- **Site estático** (só `index.html`): sobe um servidor simples sozinho
- **Outra linguagem**: informe o comando de início na hora de publicar

## Limites

- A demo fica no ar por **72 horas**. Depois disso a página mostra o link do repositório
- Cada projeto tem **1 demo ativa**, e a plataforma roda no máximo 3 ao mesmo tempo
- Aplicação de página única com caminhos absolutos (`/assets/app.js`) pode quebrar dentro de `/demo/<id>/`. Use caminhos relativos ou configure o caminho base
- Repositório privado não funciona

## Como funciona por dentro

Cada demo roda num container isolado, com memória e CPU limitadas, sem privilégios e sem acesso à sua sessão no HackaHub. Quem fala com a internet é o próprio site, pelo endereço `/demo/<id>`.
