---
title: Como vencer um hackathon de IA na saúde
description: Guia de preparação em 7 passos, escrito a partir do que funcionou (e do que falhou) nas edições do Hack Inova — Unifacens, PUC Consolação e Anhembi.
date: 2026-10-10
author: equipe hackahub
tags: [guia, ia, saúde]
---

Hackathon de saúde não se ganha com o modelo mais sofisticado — se ganha com a demo que um jurado consegue repetir sozinho. Nas três primeiras edições do Hack Inova (Unifacens, PUC Consolação e Anhembi), o padrão dos vencedores foi sempre o mesmo: um fluxo só, funcionando de ponta a ponta, com impacto claro pra quem tá do outro lado do balcão.

## 1. Estude a jornada do paciente antes do evento

Na PUC Consolação, a Oracle estruturou os desafios em torno da **jornada do paciente**: agendamento, triagem, consulta, exame, retorno. Quem já chegou sabendo o vocabulário (triagem, fila regulada, linha de cuidado) não perdeu as primeiras 2 horas descobrindo o problema.

Antes do evento, leia sobre o tema anunciado e anote 3 dores concretas. "Sistema de saúde é ineficiente" não é dor. "Paciente que falta na consulta não avisa e a vaga morre vazia" é dor.

## 2. Monte o time antes, não no dia

Time formado na correria da abertura gasta a manhã inteira se organizando. O ideal é 3–5 pessoas com papel claro:

- **Dev** — sobe a demo (o resto espera)
- **Domínio** — alguém que entende o problema (aluno de saúde vale ouro)
- **Pitch** — quem vende a ideia em 3 minutos

O HackaHub existe exatamente pra isso: monte o time pelo [diretório de membros](/membros) antes da edição.

## 3. Escopo de 24h: um fluxo só

O erro nº 1 é tentar resolver o hospital inteiro. O **One Day Hospital** — vencedor da 1ª edição na Unifacens — fez exatamente uma coisa: resolver a triagem de pacientes com IA, do fim pro começo.

Regra prática: se a demo não cabe num fluxo de 5 cliques, corta. Um `if/else` que simula o "modelo" é mais convincente que um pipeline de ML que não terminou de treinar.

## 4. Dados: público e pronto

Não gaste tempo raspando dados no dia. Fontes que já caem bem em saúde:

- **DATASUS / CNES** — estabelecimentos, leitos, produção ambulatorial
- **Kaggle** — datasets de triagem, readmissão e sintomas
- **Dados sintéticos** — gerados na hora com um script de 20 linhas; declare que é sintético, jurado respeita honestidade

## 5. Demo ao vivo > deck bonito

Slide não vence hackathon — demo vence. E "roda no meu notebook" não é demo. Com o deploy do HackaHub, o repo do time vira uma URL pública `/demo/id` em ~5 minutos — veja o [guia de deploy](/blog/deploy-da-demo-em-5-min).

Dica: tenha um caminho feliz gravado (vídeo ou script de cliques). Se a internet do auditório falhar, o backup salva o pitch.

## 6. Pitch de 3 minutos: problema → demo → impacto

Estrutura que os vencedores repetiram nas 3 edições:

1. **30s** — a dor, com nome e número ("1 em cada 5 vagas de consulta morre por falta não-avisada")
2. **90s** — a demo rodando, sem trocadilho técnico
3. **60s** — impacto e próximo passo ("piloto em 1 UBS por 1 mês")

Não abra o pitch explicando a arquitetura. Jurado pergunta se quiser saber.

## 7. O que faz jurado torcer contra

- Solução procurando problema ("fizemos um agente multi-modal" — pra quê?)
- Métrica inventada sem fonte
- Demo que precisa de 6 permissões e 3 contas pra abrir
- Ignorar privacidade — em saúde, mencionar consentimento/LGPD conta ponto

## TL;DR

Estude a jornada, monte o time antes, um fluxo só, demo pública rodando, pitch de 3 atos. É o que o arquivo das edições mostra — e tá tudo documentado aqui: [arquivo da Unifacens](/h/hack-inova-unifacens-2026), [PUC Saúde](/h/hack-inova-puc-saude-2026) e [Anhembi OS 2](/h/hackinova-os-2-anhembi-2026). Boa sorte na próxima sessão — o radar tá aberto no [/radar](/radar).
