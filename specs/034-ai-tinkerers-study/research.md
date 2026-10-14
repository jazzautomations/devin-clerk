# 034 — Estudo AI Tinkerers (aitinkerers.org)

**Data da coleta:** 14/10/2026 · **Método:** só páginas públicas (WebSearch, WebFetch, `curl` com User-Agent de navegador — WebFetch toma 403 em várias). Sem conta, login ou formulário.
**Legenda:** **[visto]** está na página citada · **[inferido]** conclusão a partir do visto · **[não verificável]** exige login ou sem fonte.
Números do site (138.482 membros, 264 cidades, 6.462 demos) são autodeclarados.

## 1. Como funciona

- "Homebrew Computer Club da IA": meetups mensais por cidade, demos técnicas curtas, sem pitch. Fundador Joe Heitzeberg (Seattle, nov/2022). Posicionamento "not built around followers, feeds, or personal branding". [visto] /about, /p/how-to-run-demos
- Em volta: newsletter Post-Training, YouTube One-Shot, Paper Club, quadro de vagas, "Talent by AI Tinkerers" (beta), AIT Fund. Plataforma própria ("Created with DREAM.page"). [visto]

**Membro:** "Apply to Attend" com revisão do organizador ("Selection is based on fit, not speed"; fora: só explorando, investidor, recrutador, marketing; 18+) → login por passkey/código → aprovado recebe QR → check-in "Scan and Print" (etiqueta na hora) → pós: pesquisa, fotos, vídeos editados, Message Center. Perfil `/connect/client/<id>` com "Builder evidence: Hackathon projects"; talks atrás de login. Bio em 3ª pessoa com cara de gerada por IA a partir do LinkedIn [inferido]. Plataforma pontua candidatos com sinais públicos, "advisory, not automatic admission" [visto, organizer_first_90_days].

**Organizador de cidade:** candidatura (/organize-a-city), builder neutro; 1 evento/mês, "3-event arc", 3–6 demos de ~5 min, sala pequena; recrutar demos antes de divulgar. Plataforma entrega: página com "AI page creator", RSVP com triagem, propostas de demo, painel de palestrantes automático, e-mails do capítulo/evento, banners, logo de patrocinador nos e-mails, check-in/crachás, galeria, pesquisas, métricas, **pipeline de vídeo** ("upload the footage, let the platform handle the editing"). Sem verba central: capítulo se paga com patrocínio local (US$ 1–3k por meetup de ~100 pessoas; 50–70% comparecimento). Brasil: SP (hackathon com Google DeepMind abr/2026, 27 projetos), Curitiba, Ribeirão Preto, BH, Floripa, Goiânia, Rio. Organizador SP: Carlos Eduardo Ramos (LinkedIn ceramos) entre outros.

**Patrocinador:** global/capítulo/digital, sem preço público (faixas <US$10k a US$250k+). Hackathon "turnkey platform and ops with workflows and reporting". Patrocínio NÃO compra admissão, palco, resultado do júri, nem dados de contato — relatório agregado; compartilhar contato só com opt-in explícito (premium). Patrocinador marcado aparece em todos os e-mails. [visto, hackathon_platform_overview_for_sponsors, new_city_sponsor_coaching]

## 2. Fluxos de submissão

### 2.1 Proposta de demo (meetup)
`/meetup/<id>/speaking`: título, descrição, links; Dubai pede stack, repo público e "one honest note on what broke or surprised you". Critérios: profundidade técnica, novidade, valor; proibido pitch e vídeo gravado. Curadoria aprova / "sideline" / recusa; sidelined citados no fim; formato "science fair". ~59% apresentadas. Talk ganha página com tags de tecnologia; vídeo vai pro palestrante, YouTube e newsletter. Sem ranking.

### 2.2 Entrega no hackathon (o que importa)
Portal `aitinkerers.org/hackathons/<id>`: Teams · Messages · Gallery · Compete (All Entries / Showcase / Results / Voting) · People (Organizers/Judges/Mentors/Sponsors) · Handbook. [visto]
- **Key Deadlines** no fuso da edição: formação de times (8 dias antes), entrega, rodada 1 do júri, final.
- **Times:** lista pública com conceito e status ("Accepted" — curadoria por time); Team Lead, papel livre de cada um, "not accepting new members", chat, **"Entry Status: Submitted · Last saved: April 12 at 4:49 PM -03"**. "Waitlisted members keep their team slot, but have no event seat."
- **Campos da entrega** [visto na página renderizada; nomes exatos inferidos]: título, tagline, vídeo do time, **Stage demo** (vídeo do palco da organização), descrição markdown (SP organizou pelos critérios), **Prior Work**, **Products & Tools**, links com rótulo, posts sociais, membros; resumo de links por IA [inferido].
- **Depois:** All Entries com status; Showcase com filtro "Has video" e selos; **Results** com final, 1º/2º e **categorias de patrocinador** ("Best Use of Elevenlabs") + finalistas da preliminar; página de jurados; mentores só pra inscritos; handbook com regras e créditos; projeto vira "Builder evidence" no perfil; arquivo global filtrável; hackathon global multicidade no mesmo dia.
- Não verificável: aba Voting, rubrica/interface do júri, trava automática no prazo, e-mails. Qualidade varia por capítulo (SP/DeepMind com júri vazio e prêmios TBD).

## 3. O que eles têm e nós não — top 10

| # | O quê | Por quê | Esforço |
|---|---|---|---|
| 1 | Entrega com estado explícito, prazo e trava | hoje projeto é editável até o fim, ninguém sabe quem entregou | M |
| 2 | Linha do tempo de prazos no fuso da edição | participante sabe o que acontece quando; alimenta lembretes | P |
| 3 | Categorias de prêmio de patrocinador + rodadas (finalistas → final) | liga desafio patrocinado ao projeto; patrocinador ganha vencedor | M |
| 4 | Campos ricos: tagline, trabalho anterior, tecnologias, links com rótulo, posts | resolve "já existia"; relatório pro patrocinador | P |
| 5 | Vídeo do palco pela organização | melhor conteúdo do presencial se perde hoje | P (link) / G (pipeline) |
| 6 | Projetos da edição + mostruário "tem vídeo" + resultados numa página | o que patrocinador e próximo inscrito olham | P–M |
| 7 | Status de time: líder, aceitando membros, papel, prazo de formação, regra da fila | vai aparecer no 1º evento com fila de espera | P |
| 8 | Opt-in de contato pro patrocinador (QR) + relatório agregado | monetização com LGPD, sem vender lista | M |
| 9 | Handbook da edição (regras, como entregar, créditos, critérios públicos antes) | substitui PDF do regulamento e fixado do grupo | P |
| 10 | Pedir palco / demo day entre edições | mantém a comunidade viva entre hackathons | M |

## 4. O que NÃO copiar
1. Triagem que exclui estudante/entusiasta (nosso público é universitário; curadoria opcional por edição).
2. "Sem pitch" — hackathon BR com patrocinador é julgado por pitch; meio-termo: demo funcionando dentro do pitch.
3. Proibir vídeo gravado (em hackathon o vídeo permite júri assíncrono e portfólio).
4. Barrar investidor/recrutador (nosso modelo monetiza com talento) — separar papéis, não proibir.
5. Muro de login em demos/projetos (mata SEO e portfólio).
6. Bio/descrição gerada por IA a partir do LinkedIn (LGPD finalidade/art. 20) — no máximo rascunho que a pessoa aprova.
7. Pontuação automática de candidato pra admissão (LGPD art. 20).
8. Consentimento de imagem embutido no texto do evento — caixa separada e específica.
9. Endereço/código de porta em handbook pública (eles vazam isso em NYC) — detalhe sensível só pra aprovados.
10. Capítulos por subdomínio/HQ global (fora de escopo).
11. Créditos via bot de Discord (nosso canal é zap/e-mail).
12. Referência de preço em dólar.
13. 18+ fixo — decidir por edição (ECA).

## 5. Proposta de fluxo de entrega pro HackaHub

**Prazos por edição** (opcionais, America/Sao_Paulo): `teamFormationDeadline`, `submissionOpensAt`, `submissionDeadline` (trava no servidor, tolerância 0–10 min), `juryDeadline`, `votingOpensAt/ClosesAt`. Bloco "prazos" em `/h/[id]`.

**Estados:** rascunho (autosave, "último salvamento HH:MM") → enviar (valida obrigatórios, snapshot imutável versionado, confirmação por e-mail/zap) → editar antes do prazo gera nova versão → **travado** no prazo (júri vê a última versão enviada antes do prazo; seção separada "depois do hackathon" continua editável e não é julgada) → finalista/premiado/participante. Sem envio = "não entregue" (sem júri/voto). Reabrir só organizador, com motivo, em log.

**Campos:** título*, tagline ≤140*, descrição markdown* com modelo pelas seções da rubrica, repo (configurável, checagem leve), vídeo do time ≤3 min (configurável; YouTube/Loom/Drive), demo/deploy, slides (configurável), logo, **trabalho anterior***, **tecnologias*** (lista controlada + livre), **desafios patrocinados** (0..N), links com rótulo, posts sociais, uso de IA (configurável), integrantes* (só aprovados; ≥1 com check-in pra prêmio), vídeo do palco (só staff).

**Visibilidade:** antes do prazo público vê só "N times, M entregues"; depois do prazo lista All Entries (conteúdo completo configurável); júri vê só atribuídos na versão julgada; depois da publicação página completa com selos e vídeo do palco.

**Júri:** atribuir só enviados/travados; avaliar o snapshot; rodadas opcionais (finalistas → final); `prize_categories` (geral / desafio / voto popular), categoria de desafio só com times que marcaram, patrocinador pode indicar jurado da categoria dele mas não decide a geral; publicação grava vencedores por categoria → certificado de premiação + aviso.

**Voto popular:** só entregues; janela; modo "plateia" (só check-in) ou "comunidade"; vira categoria própria, sem misturar pontuação.

**Lembretes:** T-24h, T-3h, T-30min só pra times em rascunho; confirmação no envio; aviso na trava; resultado + certificado na publicação.

**Página do projeto:** capa · título · tagline · selos · vídeo do time · vídeo do palco · demo ao vivo · descrição · trabalho anterior · tecnologias · desafios · links · time · "versão avaliada em DD/MM HH:MM" · "depois do hackathon" · voto.

**Dados:** colunas novas em `hackathons` e `team_projects`; tabelas `project_submissions`, `submission_events`, `project_challenges`, `prize_categories`, `prize_winners`; `teams` + `leadMemberId`, `openToMembers`, `finalist`.

**Aceitação mínima:** enviar sem tagline → 400; PATCH em campo avaliado depois do prazo → 403 (notas pós-evento → 200); `assignAll` ignora rascunho e o jurado vê a versão do prazo mesmo após reabertura; voto fora da janela → 409; reabrir sem motivo → 400; categoria de desafio só com quem marcou e certificado por integrante presente.

## Fontes principais
aitinkerers.org (/, /about, /p/faq, /sponsor, /sponsor/hackathons, /organize-a-city, /all_cities, /hackathons, /p/what-makes-a-great-demo-at-AI-Tinkerers, /p/how-to-run-demos, /p/ai-tinkerers-city-organizer-quickstart-guide); /docs/public/guides/organizer_first_90_days?markdown=1; /docs/public/guides/new_city_sponsor_coaching?markdown=1; /docs/public/hackathon/hackathon_platform_overview_for_sponsors?markdown=1; sao-paulo.aitinkerers.org/p/ai-tinkerers-sp-e-claro; aitinkerers.org/hackathons/h_bR4e1ymrqkc (+ teams, entries, results, judges); aitinkerers.org/hackathons/h_HC6A20KVNpQ (+ results, handbook, showcase); dubai.aitinkerers.org (demo day, presenters); GeekWire 2024 (snippet).
