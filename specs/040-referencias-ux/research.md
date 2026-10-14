# 040 — Referências de UX e jornada: o que copiar pro melhor hub de hackathon do Brasil

Data: 14/10/2026. Junta 10 estudos (Devpost, lablab, Colosseum, AI Tinkerers,
NoCountry, ETHGlobal, MLH + Hack Club, Devfolio + DoraHacks, Luma, TAIKAI) e
um recorte do Brasil. Todos passaram por uma checagem crítica, e as correções
dessa checagem já estão aplicadas aqui. Complementa a 034 (AI Tinkerers), a
036 (capacidades) e a 037 (roadmap) sem repetir o que já está lá.

**Legenda.** **[V]** = visto na fonte ou num print. **[I]** = inferido.
**[S]** = só snippet de busca ou fonte secundária. **[403]** = a fonte bloqueia
o WebFetch e só há print do Playwright (prints em
`scratchpad/refs/<slug>/`, fora do repo). **[hipótese]** = proposta nossa, sem
referência que prove que funciona.

**Limites deste estudo (vale pra tudo abaixo):**
- Nenhuma conta foi criada em nenhuma plataforma. O lado logado (dashboard do
  hacker, formulário real de submissão, tela do jurado, painel do organizador)
  foi reconstruído a partir de help centers, strings de i18n e bundles. String
  de bundle não prova que o fluxo está em uso.
- Números de marketing mudam a cada página e a cada dia. Aqui eles servem como
  exemplo de padrão, não como benchmark.
- A demanda brasileira não foi validada com nenhum organizador. Todo item de
  "Brasil" que dependa de "o organizador quer X" é **[hipótese]**.

**Regras do dono que valem pra tudo abaixo (14/10, spec 039 e AGENTS.md).**
Nenhuma recomendação deste estudo passa por cima delas; quando uma
referência aponta pro outro lado, o item diz isso e fica como decisão do dono.
1. **A landing explica tudo e o resto exige login.** Acesso por allowlist
   (`lib/access.ts`): `/`, `/organizar`, `/empresas`, teaser de `/h/[id]`,
   cartão mínimo de `/u` e `/p`, `/c/[code]` e termos. Rota nova pública
   (ex.: `/llms.txt`) só entra se for adicionada à allowlist, com motivo.
2. **Onboarding existe e é curto** (`/bem-vindo`, 3 passos, sem data de
   nascimento). Nada aqui adiciona pergunta ao onboarding; dado extra é
   pedido no momento em que é usado (inscrição da edição).
3. **Comunidade é parte do produto**, não só retenção: o que acontece entre
   edições tem que acontecer dentro da plataforma (ver 3.9).
4. **Copy nunca fala contra ferramenta ou pessoa.** As comparações com
   Forms, Sympla, zap, Devpost etc. neste documento são diagnóstico interno;
   nenhuma vai pra UI, landing, e-mail ou post.

---

## 1. Resumo em 10 linhas

1. O que separa os bons do resto é a **continuidade da jornada num lugar só**: inscrição, time, entrega, julgamento, resultado e histórico. A MLH manda o hacker pra 3 sistemas (site do evento, MyMLH, Devpost); o organizador brasileiro usa Forms, Sympla, zap e e-mail.
2. A segunda coisa é **o que cada tela mostra**: um próximo passo por estado (Devpost, Luma, lablab), a etapa atual dirigindo card e CTA (TAIKAI) e o resultado como primeira dobra da edição encerrada.
3. A terceira é a **prova pública**: projeto com selo de prêmio, papel de cada membro e versão entregue congelada (Devpost, Colosseum). Página pública vazia mata isso (AI Tinkerers, TAIKAI); com o login da 039, o cartão mínimo precisa carregar a prova (3.4).
4. Quase ninguém resolve julgamento: estrela sem âncora (Devpost), vencedor arrastado na mão, resultado atrasado meses, zero feedback. A rubrica ancorada da lablab e o planejador de júri da MLH são exceções.
5. Gamificação por volume quebra em todo lugar onde existe: Legend que nunca ganhou (lablab), Top 100 de quem farma quest (TAIKAI), "SEO backlinks" no ranking (Devfolio), referral dominando a liga (lablab).
6. O dinheiro vem sempre de quem paga o evento (empresa, ecossistema, governo, universidade), nunca do participante.
7. No Brasil, o concorrente real é o **status quo** (edital PDF + ferramenta genérica + planilha), mais a **NoCountry**, que já roda o Hackathon ONE Brasil com Oracle/Alura.
8. O que o universitário brasileiro pergunta primeiro (FAQs da Low Hack): **certificado com horas** e **quem é dono do código**.
9. O HackaHub já tem o miolo operacional (RSVP, fila, check-in offline, crachá, certificado com horas, feedback do júri, NPS, opt-in de patrocinador, snapshot de entrega). O que falta é UX de prova pública, julgamento com regra escrita e liga entre edições.
10. **Tese:** o melhor hub de hackathon do Brasil é o lugar onde **a edição roda inteira, as regras ficam escritas antes, o resultado sai no dia com critério e feedback, e o que você construiu vira portfólio público com prova**. Em pt-BR, no celular e com hora complementar.

---

## 2. Matriz de capacidades × plataformas (UX e jornada)

✔ faz bem · ~ faz parcial ou com defeito · ✗ não faz · ? não verificado (sem login).
"BR" = status quo de editais e ferramentas genéricas (Forms, Sympla, Even3, Canva, planilha).
"HH" = HackaHub em `main` @ 4c4871b (conferido no código).

| Capacidade | Devpost | lablab | Colosseum | AIT | NoCountry | ETHGlobal | MLH/HC | Devfolio/Dora | Luma | TAIKAI | BR | HH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Landing separa público por CTA | ✔ | ~ | ✔ (1 CTA) | ✔ | ✗ (3 públicos numa página) | ~ | ✔ | ✔ (roteador Dora) | ✔ | ✔ | ~ | ✔ (039) |
| Projetos/vencedores reais na home | ✗ | ✔ (mural) | ✗ | ~ (talks) | ✔ (ao vivo) | ✗ | ✔ (HC) | ~ | ✔ (eventos) | ~ | ✗ | ✔ (039, vitrine) |
| Cadastro curto + perfil preenchido sob demanda | ~ | ✔ | ✔ | ✔ (sem senha) | ✗ (telefone e nascimento antes) | ✗ | ✔ (MyMLH) | ✔ | ✔ (sem conta) | ~ | ✗ | ✔ (039 /bem-vindo) |
| Inscrição em 1 clique a partir do perfil | ✗ | ? | ✗ | ✗ | ~ | ✗ | ✔ | ✔ | ✔ | ~ | ✗ | ~ |
| CTA/status por estado do usuário na edição | ✔ | ✔ (sticky) | ✗ | ~ | ✔ (stepper) | ? | ✗ | ✔ (rodapé mobile) | ✔ | ✔ | ✗ | ✔ (nextStep) |
| Endereço só pra aprovados | ✗ | ✗ | ✗ | ✔ | — | ✗ | ✗ | ✗ | ✔ | ✗ | ✗ | ✗ |
| Elegibilidade estruturada + filtro | ✔ | ✗ | ✗ | ~ | ✗ | ~ | ✔ | ~ | ✗ | ~ | ✗ | ~ (minAge) |
| Time por vaga/papel com aceite | ~ | ✗ (Discord) | ✔ (matching) | ~ | ✔ (alocado) | ✗ (Discord) | ✗ | ✗ | ✗ | ✔ (vagas) | ~ (cota no edital) | ~ (looking_for_team + convite) |
| Papel de cada membro visível | ✔ (no projeto) | ✔ | ✗ | ✔ | ✔ | ✗ | ✗ | ✗ | — | ✔ | ✗ | ✗ |
| Rascunho → enviado → travado + snapshot | ✔ | ✔ | ? | ✔ | ✗ | ✔ | ✗ | ✔ | — | ✔ | ✗ | ✔ (010) |
| Desafio de patrocinador estruturado + limite por projeto | ~ | ✔ (por track) | ✔ | ~ | ~ | ✔ (Will not qualify, ≤3) | ✔ | ~ | — | ✗ (texto com emoji) | ✗ | ~ (sem campos nem limite) |
| Rubrica com âncora por nível | ✗ | ✔ (Rule Book) | ✗ | ? | ✗ | ✗ | ✗ | ~ (perguntas) | — | ~ (peso) | ~ (pesos) | ✗ (1–5 sem âncora) |
| Critério com peso público antes do evento | ✔ | ✔ | ✔ | ✗ (TBD) | ✗ | ✔ | ✔ | ✔ | — | ~ | ✔ (edital) | ~ |
| Feedback do júri pro time | ✗ | ~ (se ligado) | ✗ | ✗ | ~ (peer) | ✗ | ✗ | ✗ | — | ✗ | ✗ | ✔ (038) |
| Desempate e recurso escritos | ~ (regra Amazon, 403) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✗ | ✔ (TRT-12, IF) | ✗ |
| Resultado na própria página, no prazo | ✗ (atrasos) | ✗ (só no LinkedIn) | ✔ (Hall of Fame) | ✗ ("Coming soon" 1 mês) | ~ | ✗ (sem página canônica) | ✔ (MLH: último dia) | ✔ (Winners) | — | ✗ | ~ (PDF) | ~ (resultado na edição) |
| Selo de prêmio no card e no perfil | ✔ | ✔ | ✔ | ~ | — | ✔ | ✔ (pin) | ~ (Dora não) | — | ✗ | ✗ | ~ |
| Portfólio público individual indexável | ✔ | ✔ | ✔ | ✗ (muro) | ✗ (só time) | ✗ | ✗ (MLH) | ✔ | ✗ | ✗ (muro) | ✗ | ✗ (cartão mínimo, 039) |
| Galeria com filtros de prova (premiado, vídeo, stack) | ✔ | ~ | ✔ (shuffle, export) | ✔ (has video) | ✗ | ~ | ✗ | ~ | — | ✗ | ✗ | ~ |
| Calendário/temporada entre edições | ✗ | ✔ (League) | ✔ (ciclos) | ✔ (mensal) | ✔ (mensal) | ✔ (denso) | ✔ (temporada) | ~ | ✔ (seguir) | ~ | ✗ | ~ (radar) |
| Ranking que reflete mérito | ✗ | ✗ | — (sem ranking) | — | ✗ (insumo) | — | ~ | ✗ | — | ✗ | — | ✗ (XP por like) |
| Painel/relatório do patrocinador | ✗ | ~ (/live tecnologias) | ✗ | ~ | ✔ (caso Oracle) | ~ (feedback DX) | ✔ (case Twilio) | ✗ | ✗ | ✗ | ✗ | ✔ (sponsorReport) |
| Check-in/QR/crachá | ✗ | ? | ✗ | ✔ | — | ~ | ✔ (OHQ) | ✔ | ✔ | ✗ | ✗ | ✔ |
| Certificado verificável com horas | ✗ | ~ (só ID) | ✗ | ✗ | ✗ | ✗ (NFT) | ✗ | ✗ (on-chain) | ✗ | ✗ (NFT) | ~ (PDF) | ✔ (/c/[code]) |
| pt-BR nativo | ✗ | ✗ | ✗ | ✗ (UI em inglês no capítulo SP) | ✗ (ES) | ✗ | ✗ | ✗ | ✔ | ~ (pt-PT) | ✔ | ✔ |

O que a matriz mostra: em operação e certificado o HackaHub já está acima de
todo mundo. As colunas em que ele perde (portfólio público, rubrica ancorada,
papel por membro, desempate e recurso, ranking por mérito, endereço privado)
são as que dão prova e confiança. É aí que fica o backlog.

---

## 3. Padrões a roubar por jornada

Cada item: **o quê** · fonte · **como no HackaHub** (Next 16 + Postgres +
Clerk, identidade Hack Inova: papel, tinta, verde, fios de 1px, Archivo +
JetBrains Mono, sem sombra nem gradiente). O que já existe no código está
marcado **(já existe)** e não entra como trabalho novo.

### 3.1 Landing

A 039 já reescreveu a landing (hero com 2 CTAs, prova do banco, como
funciona, prints de dentro, próximas edições, vitrine de campeões, faixa do
organizador). Daqui entram só os ajustes que as referências mostram.

1. **Número renderizado no HTML, nunca contador animado que começa em 0.** O preview do Hacking.Rio aparece "0+" sem JS [V, print hackingrio.png; a página é preview provisório em noindex, então vale como antiexemplo de técnica, não de produto]. → Na seção 2 da landing (039), números server-side, com data ("até 14/10/2026"), e cada um some se for 0 (já previsto na 039).
2. **Delta de 30 dias quando a base for pequena.** DoraHacks mostra "351K +3,875 nos últimos 30 dias" [V print; o SSR traz 0]. Ressalva da checagem: com base pequena o delta também é pequeno ("+2 hackathons" é o que a própria Dora mostra). → Mostrar delta só se ≥ 10 e só pra "projetos entregues" e "inscrições"; senão mostrar o total. **[hipótese]**
3. **Trajetória de quem voltou.** Colosseum, seção "Earn your place": Unruggable com 4 hackathons até o Grand Prize (menção → menção → 1º de track → Grand Prize) [V colosseum.com/hackathon]. → Bloco na vitrine com 1 caso real por temporada, lido do 029-builder-arc. Só entra quando existir caso de verdade.
4. **Prova no formato "Nome (IES) fez X na edição Y → ver demo".** Hack Club: "Clément (17) from France made AngstromIO" [V hackclub.com]. → Card da vitrine com primeiro nome + inicial, IES, projeto e link de demo, só de quem tem `publicListing` (hoje o flag é por inscrição; ver backlog #14).
5. **Contas abertas da edição.** Hack Club: "Our finances are fully open" [V]. → Na página da edição encerrada: quanto entrou de patrocínio, quanto foi pra prêmio e comida. Opcional por edição. **[hipótese: pode atrair universidade e afastar patrocinador que não quer valor exposto]**
6. **Tabela de temas com total de prêmios.** Devpost: "Machine Learning/AI 82 · $1,603,000" [403, print home.png]. → No `/radar` (não na landing; o radar exige login), top temas com nº de hackathons e soma de prêmio em R$, quando o scraper tiver o valor. Só se o radar tiver volume; com 3 hackathons isso vira prova negativa.
7. **A landing responde antes do cadastro o que hoje só se vê logado.** Como todo o resto exige conta (regra 1), a pergunta que o visitante não consegue responder sozinho vira motivo de não cadastrar. → Bloco "perguntas de quem vai participar" na landing, com respostas lidas do banco da próxima edição aberta (sem edição aberta, o padrão da plataforma): "certificado com X h", "o código é do time", "grátis", "pode vir sem time", "como o júri avalia" (link pra rubrica no teaser). São os mesmos chips de 3.3.6; um componente só, usado na landing e no teaser de `/h/[id]`. Copy afirmativa, sem comparar com ninguém.
8. **O teaser de `/h/[id]` carrega a regra inteira.** O teaser é a única página da edição que o deslogado vê, e é o link que circula no zap. → Além de nome/data/local/prêmio (039), o teaser mostra: critérios com peso (e âncoras, quando existirem, 3.7.1), data do resultado (`resultsAt`, 3.3.5), chips de 3.3.6 e link pra conduta. Lista de inscritos, programação detalhada e endereço continuam só logado/aprovado.

### 3.2 Cadastro e onboarding

**(já existe):** `/bem-vindo` em 3 passos com intents, cidade, instituição,
curso, GitHub e LinkedIn; sem data de nascimento (039).

1. **Inscrição na edição = perfil + só o que falta, com barra "100%" travando o botão.** Devfolio: os campos do perfil vêm preenchidos e não são perguntados de novo; o botão só ativa com "Application Filled - 100%" [V guide.devfolio.co/.../application-tab]. Ressalva: o "menos de 1 minuto" é de um post de blog de 2018, não é medição. → Em `/h/[id]/inscricao`, a edição declara quais campos do perfil exige (camiseta, alergia, curso, GitHub) e o form mostra só o que falta. Hoje o `registration_answers` + `edition_questions` existem; falta o mapeamento campo-do-perfil → requisito da edição.
2. **Consentimentos em caixas separadas, por finalidade.** MLH: CoC obrigatório, compartilhamento com MLH obrigatório, marketing opcional [V guide.mlh.com/.../registrations]. Contraexemplo: o checkbox obrigatório da MLH também cria conta no DEV, o que na LGPD é consentimento atrelado [I, base: LGPD art. 8º §4 e art. 9º §3; validar com advogado]. → Já existem `consents`, `image_consents` e `sponsor_contact_optins`. Conferir que nenhum é pré-marcado (o Devpost pré-marca a newsletter [403, signup.png; pode variar por país]).
3. **Faixa etária em vez de data de nascimento.** MLH pede idade em dropdown "to reduce data risk" [V]. **Correção:** só o onboarding (039) deixou de pedir a data. A inscrição na edição ainda pede data de nascimento completa (`registration_terms.birthDate NOT NULL`, migration 015; `RegistrationForm` calcula `ageOnDay`). → Edição 18+ (`edition_terms.minAge = 18`): trocar a data por declaração "terei 18 anos ou mais em dd/mm" gravada com timestamp. Data completa só quando a edição aceita menor (`minAge < 18`), porque aí a idade decide se precisa de responsável. Exige migration que torne `birthDate` nullable e grave `ageDeclaredAt`. **[validar com advogado se a declaração basta pra 18+]**
4. **IES por lista fechada.** MLH usa `schools.csv` pra não ter "UTD/UTDallas" [V]. → Autocomplete sobre a lista de IES do e-MEC + "sugerir IES" moderado. Isso destrava relatório por faculdade e liga (3.9).
5. **Estado da candidatura honesto.** AI Tinkerers: "Registration is based on fit, not speed" + "Early-career builders and students are often included" [V aitinkerers.org/p/faq]. O próprio FAQ deles admite o limbo ("registered weeks ago but never got a confirmation"). → Na edição com curadoria (032): texto "a seleção é por perfil, não por ordem de chegada", data-limite de resposta e checklist do que ajuda (GitHub, projeto anterior). O `nextStep` já tem "Pedido em análise"; falta a data e o "o que aumenta a chance".
6. **Disponibilidade antes de montar time.** NoCountry pede dedicação e turno (até 2) antes de alocar [V strings i18n de talent.nocountry.tech; string de bundle não prova uso]. → Só faz sentido em edição online longa. Em hackathon presencial de fim de semana, não pedir. **[hipótese]**
7. **Login no lugar da ação.** AI Tinkerers embute o login (passkey ou código por e-mail) no card do evento [V event-sp-d-fold.png]. → Hoje `/h/[id]` deslogado manda pro `/sign-up?redirect_url=`. Testar `<SignIn>` embutido do Clerk em modo código por e-mail. Não está provado que o Clerk prod suporta passkey nem que o fluxo embutido segue sem redirect; testar antes de prometer.

**Evitar:** pedir telefone, data de nascimento e vídeo de apresentação antes de entregar valor (NoCountry); exigir Gmail (Hacking.Rio 2020, Sympla); o "responsável" digitar o CPF dos colegas (IFSULDEMINAS, edital 220/2025).

### 3.3 Página do evento (`/h/[id]`)

**(já existe):** painel "teu próximo passo" com trilho e `nextStep` (039),
prazos, programação + .ics, conduta, dúvidas, telão, prêmios por categoria.

1. **Endereço exato só pra aprovados.** Luma: "Cadastre-se para ver o endereço · São Paulo" [V luma.com/r1iqjxtk; help.luma.com/p/hiding-your-event-location]; AI Tinkerers: "Available after application approval" [V]. → Coluna `hackathons.venuePrivate` (bairro/cidade público; endereço, mapa e instrução de portaria só pra `approved`, no ingresso e no e-mail). A 034 já pede isso ("não copiar" #9).
2. **Facepile "Ana, Bruno e 84 outros".** Luma mostra número e alguns nomes a qualquer visitante; a lista completa só pra aprovados [V help.luma.com/p/event-guest-list]. Que isso converte é **[hipótese]**. → Na lateral de `/h/[id]`, só de inscrições com `publicListing = 1`; mínimo 10 aprovados pra aparecer. Pela regra 1, o teaser deslogado mostra só o número ("86 inscritos"); nomes e avatares só pra quem está logado.
3. **Resumo de quem vai, sem IA.** AI Tinkerers: "Attendees include a CTO at…, interests: Python, SQL" [V]. → Frase determinística a partir de curso/IES/tecnologias dos inscritos com opt-in: "Inscritos de 12 cursos, mais de Eng. Comp. (USP) e ADS (Fatec). Stacks mais citadas: Python, React." Mesmo piso de 10.
4. **Edição encerrada: resultado primeiro + próxima edição.** lablab troca o topo por "This Event Has Finished" + card "NEXT HACKATHON" [V lablab.ai/.../alpaca-...]; Luma avisa que a página do ano anterior continua no Google e rouba inscrição [V help.luma.com/p/event-registration-process]. Os cartões "Inscrições Encerradas" sem saída do Luma e do Devpost são o erro [V prints]. → Edição `finished`: primeira dobra = pódio + "N projetos · M com vídeo" + "Próxima edição: 14 NOV → inscrever". Campo `nextEditionId` (ou a próxima aberta da mesma organização).
5. **Data do resultado prometida e visível.** Contraexemplos com data: Gemini 3/Devpost adiado 3 vezes [403, update não arquivado]; lablab Alpaca "selecting finalists" 40 dias depois [V]; AI Tinkerers SP "Results Coming Soon" 1 mês depois [V]. MLH proíbe resultado depois do evento ("leaves your event feeling unfinished") [V member-event-guidelines]. → Campo `hackathons.resultsAt` (TEXT, UTC como as outras datas) obrigatório pra publicar a edição; sugestão automática = `juryDeadline` (já existe, migration 010) + 2 h; aparece em `EditionDeadlines` como "resultado" e no teaser como "resultado: dd/mm às hh:mm". Passou do prazo sem publicar → selo "resultado atrasado" na página e alerta pro admin.
6. **Bloco "o que o estudante pergunta" acima da dobra.** FAQ da Low Hack: "Terá certificado… constando o número de horas?" e "Quem será o dono do projeto e código?" [V hackathonbrasil.com.br/low-hack]. A resposta oficial condiciona as horas à entrega do projeto. → 4 chips: "Certificado: X h (participante)", "O código é do time" (ou "cessão ao promotor", se a edição declarar), "Grátis", "Pode vir sem time". Horas lidas de `certificate_settings`. A titularidade do código **não existe no banco hoje** (`edition_terms` só tem `minAge` e `dietEnabled`): precisa de `edition_terms.ipPolicy` (`'time'` padrão | `'cessao'`, com texto da cessão). Mesmo componente da landing (3.1.7).
7. **Critério com peso + "como verificamos" por desafio.** lablab traduz o critério por track e diz como confere o uso ("the Evolus team reviews the configuration and usage statistics") [V lablab.ai/.../amd-developer-hackathon-act-iii]. ETHGlobal: card do sponsor com "Qualification Requirements", "Will not qualify" com exemplos, pesos em % e "Preferred feedback" [V ethglobal.com/events/lisbon2026/prizes]. → Ver 3.6.
8. **Mudança de regra em diff.** ETHGlobal Lisbon 2026: "BEFORE: empty repo only / AFTER: any repo you bring" em monoespaçada, com trilhas From Scratch / Extend Open Source / Ship a Feature [V /events/lisbon2026; a página de Mumbai deu 500]. → `<RuleDiff>` no regulamento quando a edição muda regra em relação à anterior. Combina com JetBrains Mono.
9. **Changelog de regra que notifica.** Devpost anuncia mudança como uma linha no topo de um regulamento de ~43 mil caracteres [403]. → Regulamento versionado (`edition_conduct_versions` já existe pra conduta; estender pras regras), com "o que mudou em dd/mm" e aviso aos inscritos.
10. **Prorrogação pública.** DoraHacks mostra "Extended 2025/03/10" em vermelho na timeline [V print dh-sonic-d.png]. → Mudou prazo? A timeline mostra o prazo antigo riscado e o novo, com data da mudança.
11. **Cor da edição.** Luma: a cor do tema tinge a página e os e-mails, com ajuste de contraste [V help.luma.com/p/event-themes-and-customization]. → `hackathons.accentColor` aplicado como `--accent` em `/h/[id]`, ingresso, certificado e e-mail, com checagem de contraste AA. Moldura da plataforma neutra, edição com personalidade (ETHGlobal, Devfolio).
12. **Abas sem conteúdo somem.** TAIKAI já esconde aba vazia (`hasContent:false` no `__NEXT_DATA__`) [V]. → Na edição, esconder bloco sem conteúdo (0 mentores, 0 desafios, sem programação).

**Evitar:** anúncio de terceiro dentro da página do evento (TAIKAI, visto num print mobile; é injetado no cliente e pode ser rotativo); popup do sponsor em toda página (lablab, 4 prints da mesma sessão); popup de newsletter por cima do evento no mobile (Low Hack); informação dentro de imagem (TRT-12 no Canva: o texto renderizado é quase só "Política de Privacidade"; o edital em PDF existe); critério e prêmio "TBD" numa página arquivada (AI Tinkerers SP/DeepMind, evento de abril).

### 3.4 Perfil e portfólio

**(já existe):** `/u/[username]` com carta, trajetória, badges; certificado
em `/c/[code]`.

**Tensão com a regra do dono (não é recomendação de reverter):** a 039
trancou `/u` e `/p` em "cartão mínimo" pra quem não tem conta, por ordem do
dono ("a plataforma inteira a pessoa entra só depois que cadastra"). As
referências com portfólio forte (Devpost, Devfolio, Colosseum) deixam o
projeto inteiro público; as que fecham tudo (AI Tinkerers: teaser cai em
"Members-Only"; TAIKAI: "Sorry, you don't have permissions") perdem SEO,
link no zap e uso como currículo. O que elas mostram é que o problema é a
página **vazia**, não a página com login. Proposta dentro da regra:
**cartão mínimo com prova**, indexável e com OG, que mostra só o que
serve de currículo e nada da comunidade:
- `/p/[teamId]`: título, edição, selo de prêmio homologado, membros com papel
  (3.4.2), links de demo/repo/vídeo, data da entrega. Descrição completa,
  comentários, feedback e "depois do hackathon" ficam atrás do login.
- `/u/[username]`: nome, headline, os 4 números (3.4.1), até 3 projetos
  fixados (3.4.3) com selo, link pro certificado. Feed, posts, carta e
  trajetória completa ficam atrás do login.
- Quem não quer aparecer nem no cartão marca opt-out no perfil.
Abrir a página inteira continua sendo decisão do dono; este estudo não
recomenda.

1. **4 números gerados pela plataforma, não editáveis.** Devfolio: PROJECTS · PRIZES · HACKATHONS · HACKATHONS ORG [V devfolio.co/@swarnimw]. → Topo de `/u/[username]`: edições com check-in, projetos entregues (travados), prêmios, edições organizadas/julgadas. Tudo derivado de `checkins`, `project_submissions`, `prize_winners`, `edition_roles`.
2. **Papel de cada membro no projeto, que sobe pro perfil.** Devpost "CREATED BY" com uma frase por membro [403, project.png]; AI Tinkerers com papel livre no roster [V]; TAIKAI Owner/Member [V]. No Devpost o papel não sobe pro perfil. → Coluna `team_members.role` (≤120 chars), editada por cada membro. Aparece em `/p/[teamId]`, no perfil ("Remédio Certo — backend e integração com API do SUS") e no certificado.
3. **3 projetos fixados.** Devfolio Top Projects [V]. → `members.pinnedTeamIds` (máx. 3).
4. **Badge "demonstrou" separado de "venceu".** MLH dá adesivo "I Demoed" a todos e Winner Pins a vencedores [V member-event-guidelines]. → Badge automático quando o projeto foi travado e apresentado (presença no palco/telão ou nota de jurado registrada).
5. **Perfil como portfólio pra seleção de outros organizadores.** A Low Hack seleciona por "portfólio de projetos anteriores; perfil no LinkedIn" [V regulamento 2026]. → Na curadoria (032), o organizador vê "entregou X de Y edições" e o link do perfil. Botão "usar meu HackaHub como portfólio" fica pra quando outro organizador usar a plataforma. **[hipótese]**
6. **Contato privado só pro organizador da edição.** Devfolio: Contact só o organizador vê [V]. → Telefone e contato de emergência visíveis só pra admin da edição em que a pessoa está inscrita.
7. **Resultado pessoal pós-evento: "não é nota de aprovação".** NoCountry mostra peer review recebido × autoavaliação lado a lado [V strings i18n]. → Complementa o 038: página `/p/[teamId]/feedback` (já existe) + depois, peer review opcional N≥3 (037 #17).

**Evitar:** radar de skills autodeclarado (o #1 da lablab marcou 5/5/5/5) [V]; bio em 3ª pessoa gerada por IA (034); followers e likes como métrica principal (Devpost: n=1 perfil visto, não generalizar); portfólio só do time sem URL individual (NoCountry).

### 3.5 Time

**(já existe):** `teams`, `team_invites`, `looking_for_team` (012), RSVP com fila.

1. **Vaga de time com skill + intro curta + aceite.** TAIKAI "Open Positions": o time abre vaga com skills, o candidato manda intro de até 280 caracteres, o time aceita ou recusa, e o convite expira [i18n; tela não vista]. Colosseum matching: filtros obrigatório × desejável com contagem ao vivo ("247 candidates / 84") e "Compatibility Breakdown" em frases [V colosseum.com/cofounder-matching]. → No 012: `team_positions(teamId, papel, skills[], aberta)` + `position_applications(intro varchar(280), status, expiresAt)`. Contato só depois do aceite mútuo. Frases de compatibilidade determinísticas ("vocês precisam de design e ela é de design").
2. **Montagem pelo organizador com cota por perfil.** TRT-12 fixa 3 Tecnologia + 1 Design/UX + 2 Gestão por time de 6 [V edital SEAP 8/2026, item 4.2]; Low Hack recomenda 2 dev + 1 design + 1 negócios e a comissão encaixa quem está sem time [V regulamento 4.6]; UNISAGRADO exige mín. 2 cursos e dá +5 pontos [V edital]. → Campo "perfil" (Tech/Design/Gestão/Dados) na inscrição; config da edição com cotas e mínimo de cursos; botão "propor times" (agrupa por preferência e completa cotas), o organizador arrasta e publica, o participante aceita. Equipe pré-formada vira preferência, não garantia (TRT-12).
3. **Link de convite único e reutilizável + time solo.** lablab: todo mundo está num time, inclusive solo; um link por time [V help center, aba Teams]. → Conferido: `team_invites` (migration 016) é convite **por membro** (`memberId`, UNIQUE por time), não link. Falta `teams.inviteCode` (rotacionável pelo dono do time; quem abre o link logado e inscrito entra como convite pendente). Inscrição cria time solo automático, o que simplifica "submissão = time".
4. **Regra de time esvaziado escrita.** NoCountry: abaixo de 4 ativos até sexta da semana 1, pede realocação [V strings i18n, não verificado em uso]. Isso é de simulação de 5 semanas. → Pra fim de semana: "membro sem check-in até H+2 do kickoff → o time pode pedir troca ou seguir menor" no regulamento.
5. **Status por integrante + regra da fila.** AI Tinkerers: "Waitlisted members keep their team slot, but have no event seat" [V roster]. → No painel do time, selo aprovado/pendente/fila por pessoa e o aviso fixo.

**Evitar:** obrigar a retirar a candidatura pra entrar num time (Devfolio, só no modo com revisão); um membro sem RSVP travar a entrega do time inteiro (Devfolio; e a 041 achou o mesmo bug no HackaHub com quem cancela ou exclui conta); time 100% aleatório como dogma (NoCountry); formação de time só no Discord (ETHGlobal, MLH).

### 3.6 Submissão

**(já existe, 010):** prazos, rascunho → enviado → travado, `project_submissions`
(snapshot), `submission_events`, `priorWork`, `technologies`, `aiUsage`,
`stageVideoUrl`, `afterNotes`, `project_challenges`, `requireRepo/Video/Slides/AiUsage`.

1. **Aba "Entrega" com o snapshot e "o que mudou depois".** Devpost: STORY | UPDATES | SUBMISSION HISTORY; depois do prazo, a edição só vale no portfólio [V help.devpost.com/article/123]. → Em `/p/[teamId]`: abas História | Entrega (snapshot com "entregue em dd/mm hh:mm, prazo hh:mm", commit SHA se houver) | Depois do hackathon (`afterNotes`). O jurado sempre abre a Entrega.
2. **Template de história em pt-BR já preenchido.** Devpost: Inspiration / What it does / How we built it / Challenges / Accomplishments / What we learned / What's next (visto no editor e na página de projeto; o help 126 só diz que a story "will prompt you with headings") [403/V]. Devfolio pede "Challenges you ran into" como campo próprio [V]. AI Tinkerers pede "what broke or surprised you" [V]. (A frase "quem apaga o template perde informação" é da autora de um post no dev.to, não do Devpost; e o "jurado usa ctrl+F, 5 min por projeto" é anedota de uma pessoa.) → **Parte já existe:** `EntryEditor` preenche a descrição com um `## título` por critério da rubrica ("o modelo segue os critérios do júri"). Falta só: quando a edição não tem rubrica, usar Problema · O que faz · Como construímos; e sempre acrescentar ao fim "O que quebrou" e "Próximos passos". Aviso, sem bloquear, se uma seção ficar vazia.
3. **Dois vídeos com papéis diferentes.** Colosseum: pitch (por quê/quem, 2–3 min) e demo técnico (como, ≤3 min) [V colosseum.com/hackathon FAQ]. "O pitch é o primeiro que o júri vê e PODE decidir a shortlist" [V blog perfecting-your-hackathon-submission]. → Já existe `videoUrl` + `stageVideoUrl` (palco, da organização). Adicionar `demoVideoUrl` opcional por edição; em hackathon presencial curto, só um.
4. **Regras de vídeo como checklist antes de enviar.** ETHGlobal: 2–4 min, ≥720p, recusado no upload; sem acelerar, sem gravar com celular, sem TTS, "não precisa passar de 20 s no backstory" (não é a apresentação inteira) [V /events/prague/info/details]. → Checklist em pt-BR antes do envio. Validação automática de duração exige a YouTube Data API (o oEmbed não traz duração); começar só com o checklist. **[esforço real: P sem validação, M com]**
5. **Desafio de patrocinador estruturado, com limite e justificativa.** ETHGlobal: até 3 prêmios de parceiro, e para cada um o time escreve como integrou + feedback [V /prague/info/details]. TAIKAI mostra o contrário: um projeto marcou 5 bounties de texto livre [V lista do ETH Argentina]. → Em `challenges`: `qualifica[]`, `naoQualifica[]` (com exemplos), `criterios[{pergunta, peso}]`, `feedbackDesejado`, `docs[]`, `maxPorProjeto` na edição (padrão 2). Em `project_challenges`: `comoUsou` e `feedbackProPatrocinador` obrigatórios. Exportar CSV por patrocinador no relatório (já existe `sponsorReport`).
6. **Declaração de IA e de código anterior com consequência escrita.** ETHGlobal: IA permitida com atribuição de arquivos/partes; se usar spec-driven, incluir specs e prompts [V /prague/info/details]. MLH: IA obrigatoriamente permitida em Member Events; não creditar = desclassificação e reporte a cheating@mlh.io [V guide.mlh.com/.../rules-for-your-hackathon]. Colosseum: código anterior permitido se declarado; mentir pode dar desclassificação OU ban OU revogação (são opções, não as três automáticas) [V FAQ]. → `aiUsage` e `priorWork` já existem. Falta: texto da regra pronto no regulamento e o checkbox "incluí specs/prompts no repo".
7. **Campos de entrega do padrão de edital público.** TRT-12: instruções de instalação/execução, credencial "específica e temporária para fins de teste" (proibido senha pessoal), componentes de terceiros com licença, IA declarada, só dados fictícios ou anonimizados [V edital itens 8.3–8.5]. → Campos opcionais por edição: "como rodar", "credencial de teste" (apagada depois do julgamento), "componentes de terceiros + licença", "dados usados: fictícios/públicos/anonimizados".
8. **Validação leve do repo.** DIO: relato de usuário sobre farm com link falso e descrição "teste" [V artigo de comunidade, não da DIO]. lablab: "an empty repo with one final push raises red flags" [V guide]. MLH: um commit único no fim "is NOT a reason to DQ" [V cheating-check]. → Na entrega: GitHub API confere que o repo existe, é público e tem commit no período. Só sinaliza (037 #10).
9. **Vitrine pública × dossiê privado.** Colosseum: projeto público e indexável; respostas de GTM e updates semanais só pro júri (robots.txt: Allow /arena/projects/, Disallow submission e weekly-updates) [V colosseum.com/robots.txt]. → Cada campo da entrega marcado "público" ou "só júri" (credencial de teste, tração, dúvidas ficam privados). `entriesShowContent` já existe por edição; ir pra granularidade por campo.
10. **Gate "só apresenta quem entregou".** TRT-12 11.1.1 [V]. → Hoje `setQueue` (`lib/stage.ts`) aceita qualquer time com `team_projects` cadastrado, mesmo em rascunho. Trocar `listStageCandidates` pra exigir entrega enviada/travada quando a edição tem `submissionDeadline` (edição sem prazo segue no modo antigo).

**Evitar:** entrega por pasta + `.txt` com link do YouTube (Low Hack), pendrive (UNISAGRADO) ou e-mail (Receita) [V editais]; galeria de imagens sem limite (Devpost: 20 imagens, 6 com a mesma legenda) [403]; trilha opcional que vira "All Tracks" em tudo (DoraHacks; n=1, pode ser só a renderização).

### 3.7 Júri e resultado

**(já existe):** `rubric_criteria` com peso, `judge_assignments`, `scores` 1–5
com comentário, `jury_results`, feedback ao time liberável (038), prêmios
por categoria, finalistas, voto da plateia com check-in e `audienceMinVotes`.

1. **Rubrica ancorada por nível.** lablab Rule Book: cada critério com a descrição de 1 a 5 ("Application of Technology nível 1 = demo video is not available… Github is not available"; "Originality 1 = exact copy of existing solutions") [V lablab.ai/hackathon-rules]. É a peça mais roubável que a checagem achou. → `rubric_criteria` ganha `anchors jsonb` ({1,3,5} → texto). A tela do jurado mostra a âncora ao lado da nota; a página da edição publica a rubrica antes da inscrição.
2. **Critério escrito como pergunta.** DoraHacks: "Innovation: Does this project demonstrate an innovative integration with our API?", pesos visíveis "to judges and participants alike", janela fechada [V dorahacks.io/blog/guides/hackathon-judging-plan]. → `label` vira pergunta; validar soma dos pesos = 100 na publicação.
3. **Planejador de júri.** MLH: J = ⌈P·n·t/T⌉, com n = rodadas por projeto (3), t = 4 min; 175 projetos em 120 min = 18 jurados; "1 projeto a cada 4 hackers com check-in"; conjuntos escalonados sem repetição; cada jurado devolve o top 3 (3/2/1) pra normalizar [V guide.mlh.com/.../judging-plan]. → Em `/admin/h/[id]/juri`: calculadora com P (ou check-ins ÷ 4), n, t, T; botão "alocar" escalonado (estende `assignAll`); barra pública "jurados viram 62% dos projetos" no telão.
4. **"Me declaro impedido".** Devpost: "I recuse myself" [V help 103]. → Botão na tela do jurado: pula o projeto, grava o motivo, realoca, e aparece no log do resultado.
5. **Julgamento do patrocinador sem nota.** Devfolio Sponsor Judging: "only mark whether a project is a winner", sem editar depois de enviar [V guide.devfolio.co/docs/guide/sponsor-judging]. → Link do patrocinador lista só os projetos que marcaram o desafio dele e tem "marcar vencedor"; o admin aprova antes de publicar. `edition_sponsor_members` já existe; falta a tela.
6. **Jurado convidado sem conta, com link que expira e é revogável.** DoraHacks: magic link sem login [V judging-judges]. Risco que a checagem apontou: encaminhar o e-mail dá acesso. → Token assinado (jurado, edição, expiração no fim da janela), revogável no admin. O Clerk continua pra quem já tem conta.
7. **Desempate, recurso e homologação escritos.** TRT-12: desempate ordenado por critério e depois sorteio público (11.4); fase recursal e homologação antes de pagar (12.5) [V]. IFSULDEMINAS: recurso em 15 minutos (10.2), resultado em até 15 min depois do último pitch (9.5) [V]. → Config da edição: lista ordenada de critérios de desempate, sorteio com semente publicada, prazo de recurso em horas (0 = sem recurso). Resultado com selo "provisório" e depois "homologado". Penalidades configuráveis (minuto excedido, membro ausente; UNISAGRADO) com motivo visível ao time.
8. **Rodadas por sede: pré-banca local → final.** Receita Federal: 6 polos, top 3 de cada sobe [V manual 2025]; TAIKAI CASSINI: etapa local → Demo Day europeu [V `__NEXT_DATA__`]. → Ver backlog "Sedes".
9. **Fechamento automático da nota no fim da janela + tela "revisar minhas notas".** TAIKAI modo critério envia o carrinho sozinho no fim da etapa [V doc Voting]. → Notas em rascunho; no `juryDeadline` fecham. Jurado lento não trava o resultado.
10. **Anúncio de vencedor em formato de história.** lablab: top 3 com 2–3 frases do porquê de cada um, no LinkedIn [V mural da home]. DoraHacks explica mudança ("em vez de 3º lugar, 3 menções honrosas") [V /sonic-defai-hackathon/winner]. → `prize_winners.why` (≤280, escrito pelo júri) + `results_note` da edição. Publicado na página da edição e no blog no mesmo minuto, nunca só fora.
11. **Checagem de cola só nos finalistas.** MLH cheating-check: commits antes do evento, push depois do prazo, README citando outro evento, vídeo publicado antes [V; o item "perguntar quem fez o quê" precisa ser reconferido na fonte]. → Aba "verificar finalistas" com evidência automática onde der + campo "conversa com o time", status ok/dúvida/desclassificado com motivo (037 #10).
12. **Voto popular só como menção.** Devpost esconde a contagem pública [V help 82]. Devfolio voto quadrático exige carteira e atestação EAS, e a resistência a sybil no ETHIndia veio do Anon Aadhaar (ZK + ID nacional) [V blog]. Ou seja, "voto quadrático sem cripto" não tem referência. → Manter o voto da plateia com check-in (já existe). Voto pareado com justificativa (Hack Club) fica **[hipótese]**: no código atual do Summer of Making a explicação obrigatória está comentada [V vote.rb].
13. **Dados de pagamento do prêmio só pros premiados.** TRT-12: valor dividido entre os 6, CPF + NIS/PIS + conta própria, cadastro no SIGEO em 3 dias úteis, com retenção tributária [V edital item 12]. Contraexemplos: Devpost "up to 60 days" com W-8BEN [V help 114]; lablab até 90 dias e perda do prêmio [V termos Alpaca]. → Formulário privado "receber prêmio" por membro, aberto depois da homologação, criptografado e apagado X dias depois do pagamento; status "dados pendentes → em pagamento → pago em dd/mm" visível ao time; export CSV pro financeiro. **IRRF sobre prêmio em dinheiro e o enquadramento na Lei 5.768/71 precisam de parecer antes de prometer "Pix em 30 dias".**

**Evitar:** estrela 1–5 sem âncora (é o que o HackaHub tem hoje); vencedor arrastado na mão sem nota exposta (Devpost, segundo o help 107; o painel não foi visto); "não damos feedback individual" (Devpost, Colosseum); contestação em comentário público (Devpost, Globot) → fluxo privado de recurso; IA julgando ou recomendando quais projetos o jurado pode pular (DoraHacks "Run AI Judging", "BUIDL Recommendation"); rodada eliminatória durante o evento (a MLH proíbe).

### 3.8 Galeria

**(já existe):** `/projetos` (017) com filtro por edição (`?h=`), "ao vivo"
(`?live=`), busca (`?q=`) e ordenação (`?sort=`); `/h/[id]/projetos`,
`entriesPublic`. Os itens abaixo acrescentam a esses parâmetros, não
criam outra página. A galeria inteira exige login (regra 1).

1. **Contagem "N projetos · M com vídeo" + filtro "tem vídeo".** AI Tinkerers: "9 projects · 8 videos" [V showcase]. No Agents Everywhere SP foram 13 times, 9 projetos, 8 vídeos [V]. → Topo de `/projetos` e `/h/[id]/projetos`.
2. **Filtros de prova.** Devpost: is:winner, has:video, Built With linkado [403, popular.png]; Colosseum: toggle "só premiados", filtro por país/categoria/track, Shuffle, Export Excel [V /arena/projects/explore; o parâmetro de seed na URL não foi provado]. → Chips: Premiados · Com vídeo · Com demo no ar · Stack · Desafio · Edição. Tags de `technologies` clicáveis.
3. **Ordem padrão aleatória estável.** Colosseum Shuffle [V]. → `?seed=` na URL, gerado na 1ª visita; vencedores primeiro só na galeria de edição encerrada. Nunca "mais curtidos de sempre" (o Popular do Devpost é dominado por 2021–22; dizer que foi "farmado" não tem prova).
4. **Destaque além do 1º lugar.** Devpost: 4.499 projetos em 188 páginas, o resto vira cemitério [403]. → Na edição encerrada: pódio, depois menções, vencedores de desafio, escolha da plateia, e só então o resto.
5. **Selo de prêmio em todo card.** Devpost (faixa WINNER), ETHGlobal ("WINNER OF: Uniswap Foundation…") [V oniblock]. DoraHacks erra: o vencedor de US$12.500 não mostra o prêmio na própria página [V build/24044]. → Componente único de card com faixa "1º lugar / Desafio X / Menção", lida de `prize_winners`. Só resultado homologado, nunca autodeclarado.
6. **Export pra patrocinador/recrutador.** Colosseum Export Excel (público) [V]. → Botão "Exportar CSV" só pra patrocinador da edição e admin, respeitando opt-in. Export do próprio evento nunca pago (DoraHacks põe no Premium [S, print de SPA]).

**Evitar:** galeria em ordem alfabética sem resultado (TAIKAI ETH Argentina, onde o julgamento foi offline); galeria organizada só por tecnologia do sponsor (lablab /apps); comentário aberto sem moderação (spam de cassino no projeto campeão de uma trilha da PSE no ETHIndia, e não "1º lugar do ETHIndia"; spam de BD no campeão do Colosseum, n=1).

### 3.9 Comunidade e retenção

**(já existe):** feed, mural da edição (028), badges, XP, carta, radar,
newsletter (`subscribers`), notificações.

1. **Trocar XP por like por pontos de entrega.** Hoje `lib/game.ts` dá `likeReceived: 5` e `post: 10` — exatamente o que a 036 vetou. Evidência de farm: lablab #1 Legend com 21 submissões e o badge Champion travado [V]; AMD League com o #1 tendo 4.750 de 5.350 XP em referral (o prêmio de referral exige curso concluído, então não é "sem trava") [V]; TAIKAI Top 100 com 1 hackathon e ~168k pontos (participantes E jurados; print único) [V]; Devfolio /builders com "SEO backlinks" (40 projetos) e gente com 144 hackathons e 2 projetos [V print]. → XP só por check-in, entrega travada, nota recebida, prêmio, mentoria/júri cumpridos e continuidade. Leaderboard com janela de 6 meses (lablab) e o aviso "ranking não interfere no julgamento".
2. **Hack Inova como calendário seguível.** Luma: todo evento pertence a um calendário; quem se inscreve vira contato; página com linha do tempo por dia, tags, Próximos/Passado, iCal/RSS [V help.luma.com/p/luma-calendar-overview]. ETHGlobal mistura hackathon com café, cowork e happy hour com clube universitário [V /events]. → Página da organização (`/o/[slug]`, que vira também o portfólio do organizador, como TAIKAI "3 Hackathons · 1,032 Participants") com edições + encontros, botão "seguir" e feed .ics. Tipo de evento "encontro" no modelo.
3. **Newsletter fixa com "Última chance".** DoraHacks: seções New / Last Chance / Ongoing / IRL [V dev.to newsletter jan/2026]. AI Tinkerers: "Top AI Demos #48", 1 min de leitura [V]. → Rascunho semanal gerado do radar e das edições (prazo < 7 dias = Última chance) + 3 projetos da semana; o admin revisa e envia (depende do Resend, F2 da 041).
4. **"Me avisa" em edição futura e por cidade.** Devfolio "Remind me" [V]; Hack Club pede e-mail + localização [V hackathons.hackclub.com]. → Botão em edição `upcoming` e no radar por UF.
5. **Continuidade 30/90 dias.** 80 de 100 participantes não continuaram o projeto (estudo SBC/SEMISH, 104 respostas, 12,9% de taxa de resposta, viés de autosseleção) [V]. Entre os motivos (sobre 77 respostas): falta de tempo 26%, time desfeito 16,9%, inviabilidade 14,2%, mau resultado 14,2%, desinteresse 13%. Ou seja, ~27% desistem porque o projeto era fraco; feedback do júri ajuda, mas não resolve tudo. → E-mail D+30 e D+90 "o projeto continua? cole o último commit"; selo "continuou" = time com `repoUrl` público no GitHub que tem commit com data > `submissionDeadline` + 30 dias (checado pela API do GitHub no cron, sem autodeclaração); métrica "% dos times que seguiram" (com data e N) na página da edição encerrada. Série "E depois?" no blog (TAIKAI: Silent Mesh testado na Ucrânia 80 dias depois [V blog]).
6. **Liga universitária por semestre.** MLH: pontos de participação + mérito creditados à escola, troféu de temporada [fonte de 2013 com link morto (404); hoje só se verifica "earning points for their school in the MLH Season rankings" e não há placar público]. → **Não construir agora.** Com 1 organizador e poucas edições por semestre, o placar fica vazio e vira prova negativa. Antes: porta falsa (página "/liga" com contagem de cliques) e conversa com 5 coordenadores.
7. **Embaixador por campus.** DIO Campus Expert: link de indicação + ranking mensal no zap [V]. Luma: URL vira link pessoal de indicação após inscrição [o `?tk=` foi observado no navegador; o help não fala de ranking]. → `?ref=handle` na inscrição + `utm_*`; conta só quem fez check-in; recompensa = certificado de embaixador com horas, não pontos.
8. **Programas curtos entre edições com prazo próximo.** Hack Club: cards com promessa em 1 frase e chip "Ends Oct 31" [V print, página renderizada no cliente]. → Desafio online de aquecimento 2–3 semanas antes da edição presencial (ver 3.10). **[hipótese]**

9. **Comunidade dentro da plataforma (regra 3).** Tirar XP de like/post (#1) não pode esvaziar o feed. As referências fortes em comunidade (Hack Club, AI Tinkerers, lablab) põem o centro no Slack/Discord ou em meetup; o HackaHub decidiu ter feed e mural próprios (028), então o padrão a copiar é o **post atrelado a algo construído**. → (a) Post de "progresso" com `teamId` opcional: aparece no feed e na aba "Depois do hackathon" do projeto (3.6.1), e é o insumo natural do selo "continuou" (3.9.5). (b) Resposta marcada como útil pelo autor em `/h/[id]/duvidas` (o modelo de perguntas e respostas já existe) conta como ajuda na carta do membro, como fato ("respondeu 6 dúvidas"), sem XP. (c) Encontro entre edições (3.9.2) com mural próprio. Nenhum dos três tem referência que prove engajamento: **[hipótese]**; medir posts por membro ativo por semana antes e depois.

**Evitar:** referral pago no mesmo ranking da construção; badges de volume (6 conquistas com 1 projeto: n=1); pausar programa "perpétuo" sem calendário publicado (Colosseum fecha entre janelas, mas publica os ciclos); comunidade inteira no Discord/zap sem nada na plataforma.

### 3.10 Organizador

**(já existe):** `/admin/h/[id]` com 19 abas, completude da edição (030),
formulário custom, candidaturas, avisos, programação, check-in, crachás,
refeições, certificados, incidentes, NPS, `/organizar`.

1. **Checklist "mínimo pra publicar" que bloqueia.** TAIKAI mock "ORGANIZER CHECKLIST" [V]; AI Tinkerers "Minimum Viable Next Event" (data, sala, página, 3–4 demos, organizador) [V guide 90 days]. → A 030 já calcula completude; tornar bloqueante: sem rubrica, data de resultado, termo de PI e prêmios estruturados, não publica.
2. **Revisão de inscrição em dois tempos.** Devfolio: marcar Aceito/Recusado/Espera não notifica; "Send Acceptance Mail" é irreversível e em lote [V review-tab]. → Separar `decision` de `notifiedAt` na revisão (032); envio em lote com prévia.
3. **Lembrar quem começou e não terminou a inscrição.** Devfolio "Send reminder emails" [V overview-tab]. → Botão no painel com contagem.
4. **Funil de inscrição por dia, origem e faculdade.** Devfolio top 5 instituições [V]; Luma Insights com UTM e indicador [V]. → Card em `/admin/h/[id]`: visitas → inscrições → aprovados → check-in → entregas, top origens e top IES.
5. **Seleção configurável com cotas afirmativas.** Low Hack: 150 vagas, 30 afirmativas (mulher, pessoa negra ou indígena, LGBTQIAPN+, PcD), 1 por CPF; se passar, portfólio + LinkedIn + aderência [V regulamento 3.3.1]. Erro dela: lista de 157 nomes completos em PDF público [V]. → Modo de seleção (ordem de chegada / curadoria / cota %) com autodeclaração separada, visível só ao organizador (dado sensível, LGPD art. 5º II: precisa de base legal específica). Status individual, nunca lista pública.
6. **Sedes (multi-polo).** Receita Federal 6 polos com pré-banca [V manual]; Space Apps BR com Local Leads e Sympla próprio [V busca Sympla: 5 sedes só na 1ª página]. → Entidade `sede` (local, capacidade, responsável com admin limitado); inscrição escolhe sede; julgamento em 2 fases; certificado com a sede.
7. **Sandbox de demonstração.** DoraHacks "Hackathon Showroom" (avança fases sem afetar produção) [S, print de SPA]. → **Não pode ser `/demo`**: essa rota já é o proxy do app publicado do time (`app/demo/[id]/[[...path]]`, pública na allowlist). E o `seed:demo` é "nunca em produção" (AGENTS.md). Proposta: `/organizar/demo` apontando pra uma instância separada (banco próprio `hackahub_sandbox`, resetado por cron diário), com botão "avançar fase". Vende pra coordenador sem call. **[esforço real: M, não P]**
8. **Playbook e scorecard pós-edição.** AI Tinkerers: 4 critérios de revisão de inscrição, scorecard de 90 dias com 6 perguntas [V guide]. → Card pós-edição em `/admin/h/[id]` com 4 números de queries existentes: % de check-ins que já tinham check-in numa edição anterior (`checkins`), % de times com entrega enviada (`project_submissions`), NPS da edição (`nps_responses`, 017) e "próxima edição marcada?" (existe edição futura no banco; não há entidade de organização, então hoje = qualquer edição Hack Inova futura). Cada número com N e data.
9. **Gerador de regulamento em PDF.** Todo organizador BR escreve à mão (TRT-12, IF, UNISAGRADO, Low Hack). → **[hipótese]**: órgão público e IF têm jurídico próprio e podem não aceitar PDF de terceiro. A base jurídica (concurso cultural na Lei 5.768/71 art. 3º II, IRRF) está **[a validar com advogado]**. Começar com "resumo em linguagem simples ao lado do PDF que o organizador sobe" e só depois gerar.
10. **Relatório final da edição.** A HB exibe "Atestados de Capacidade Técnica" pra disputar licitação [V]. Ressalva: o atestado é emitido pelo contratante, não pelo organizador. → PDF assinado com inscritos, presentes, times, entregas, critérios, vencedores e horas, pro organizador anexar.
11. **API pública de leitura + versão pra agentes.** TAIKAI: a mesma URL devolve markdown com `Accept: text/markdown`, `/.well-known/api-catalog`, API GraphQL pública e MCP que cobre o ciclo inteiro do participante [V]; AI Tinkerers e NoCountry têm `llms.txt` [V]. → `/llms.txt` + `/h/[id]/regulamento.md` primeiro (P). Não existe entidade "regulamento" hoje: o `.md` é gerado de `hackathons` (datas, local público), `edition_terms`, `rubric_criteria`, `prize_categories`, `challenges` e da versão vigente de `edition_conduct_versions`. As duas rotas entram em `PUBLIC_PAGES` de `lib/access.ts` (são termo, como `/conduta`) e não expõem dado de pessoa. API pública de leitura de edições e resultados depois (M).

**Evitar:** landing de organizador que cai num Notion (Devfolio) ou em "fale no Telegram" (DoraHacks); datas e prêmio que só o suporte muda (Devfolio, DoraHacks) → organizador prorroga, com mudança registrada e exibida; aprovação manual de semanas antes de abrir inscrição (Devfolio, segundo a MLH); export pago ou incompleto.

### 3.11 Patrocinador

**(já existe):** `/empresas` com lead, `edition_sponsors`, convites e membros
de patrocinador, `sponsor_contact_optins` por QR, `sponsorReport`, prêmio
de desafio ligado ao patrocinador.

1. **Patrocinador edita a própria página de desafio.** DoraHacks: convidar o sponsor a editar a bounty [V how-to-create-a-hackathon]. → Com `edition_sponsor_invites`, liberar edição dos campos de desafio de 3.6 até a publicação; o admin aprova.
2. **Feedback de DX obrigatório por desafio escolhido.** ETHGlobal "Preferred feedback" + texto obrigatório na submissão [V]; Coinbase deu "$500: Best Developer Feedback" no ETHIndia [V]. → `feedbackProPatrocinador` (3.6) vira seção do relatório: "o que os times disseram da tua API".
3. **Funil e adoção da stack no relatório.** NoCountry caso Oracle: participação → finalização → job-ready → entrevistas → contratados (mas o mesmo programa aparece com 830, 1.240 e 2.500 participantes e 21 ou 25 países: copiar o formato, não os números) [V /casos-de-exito]. MLH case Twilio (de 2023): 170 eventos, 585 projetos, 2.000+ devs usando o produto [V]. lablab /live: "TECHNOLOGIES being used this round" [V]. → `sponsorReport` com funil real (inscritos → presentes → entregaram → usaram a stack do patrocinador), sem arredondar pra cima. Vender submissão válida e taxa de conclusão, não inscrito (lablab: Alpaca 3.602 → 425, 12%).
4. **Três superfícies vendáveis na edição.** Colosseum: track com pool e nº de vencedores, juiz do patrocinador com nome e cargo, slot de workshop no calendário [V /worldsfair]. → Tabela de cotas em `/empresas`: desafio, jurado de desafio, workshop na programação, relatório.
5. **Formulário com faixa de orçamento e objetivo.** ETHGlobal (<$15k a $100k+; awareness, workshop, prêmios, booth, other) [V /ethonline2025/sponsor]; AI Tinkerers (<US$10k a 250k+, "Discuss in follow-up") + prompt pronto "Prepare this inquiry with AI" [V /sponsor]. → Faixas em R$ no `LeadForm`. As faixas exatas são chute até falarmos com 3 patrocinadores.
6. **Regras do que o patrocínio NÃO compra.** AI Tinkerers: não compra lista de e-mails, admissão, palco nem júri; contato só por QR opt-in [V FAQ]. → Escrever em `/empresas`. Já é o modelo do HackaHub (opt-in por QR).
7. **"Missões" de ativação com missão-escape.** MLH Global Hack Week: "Sign up for a Cursor Pro Account" duas vezes com 1K+ e "Cannot sign up for Cursor Pro" com 300+, ou seja, 1 em 4–7 travou no cadastro do sponsor; o desafio de construção mais feito tem só 300+ [V]. → Só se houver missão com entrega mínima (repo ou print de uso), no máximo 1 missão de cadastro por patrocinador, nunca valendo ponto. Missão com prêmio pode cair em promoção comercial (Lei 5.768/71) **[validar]**.
8. **CTA de patrocínio no hero de cada edição.** ETHGlobal "Interested in partnering?" logo abaixo do CTA principal [V]. → Link discreto "quer patrocinar a próxima? →" na edição.

**Evitar:** dashboard público expondo times mortos (NoCountry companies.nocountry.tech/simulation; a única prova é 1 print, e expor atividade de pessoa no Brasil é problema de LGPD antes de ser de UX); spec work em que 15 times trabalham e o cliente tem acesso a todos os repos sem termo de PI público (NoCountry desafio pago; e a página diz ao mesmo tempo "o time vencedor recebe US$2.000" e "os 3 melhores recebem o incentivo"); default de PI indo pro organizador (FAQ TAIKAI; conferir nos termos vigentes) → padrão do HackaHub: o código é do time, cessão só declarada no aceite.

### 3.12 Jornadas que este estudo não cobriu

A checagem de completude achou jornadas que existem no código mas não
foram comparadas com nenhuma referência. Ficam como lacuna declarada, não
como backlog:

- **Dia do evento do participante** (check-in, avisos, "agora/a seguir",
  dúvidas, refeições, telão, voto). Tudo existe (009, 011, 013); nenhuma
  referência foi olhada pelo celular de quem está no evento. Candidatas:
  página "info" do ETHGlobal (`/events/<x>/info/*`, já aberta pra regras de
  vídeo) e o Event Day da MLH.
- **Mentor, jurado e voluntário como usuário** (candidatura em
  `/h/[id]/candidatura/[kind]`, 007). Só o lado "tela do jurado" foi
  estudado (3.7). Falta: como a referência recruta, prepara e agradece
  mentor (certificado de mentor já existe via `edition_roles`).
- **Recrutador / talento** (`/talento`, `members.openTo`, botão "adicionar
  ao LinkedIn" em `/c/[code]` já existe). Só aparece como "export" em 3.8.6.
- **Organizador externo self-serve**: hoje `/organizar` é formulário de
  lead e não existe entidade de organização. 3.9.2 (`/o/[slug]`) e 3.10
  pressupõem várias organizações; antes disso, decidir se o HackaHub
  continua só da Hack Inova (AGENTS.md) ou abre.
- **Canal de aviso** (e-mail/zap): depende do F2 da 041; nenhuma referência
  de cadência de lembrete foi comparada além do Luma.

Referências não estudadas e relevantes pro público universitário:
**Unstop** (Índia, competições universitárias com certificado; o caso
mais próximo do universitário BR), **HackerEarth**, **Hack Club Scrapbook**
(post de progresso como comunidade; base de 3.9.9), além das brasileiras
já listadas em 4.

---

## 4. Cenário Brasil: quem é concorrente de verdade e as lacunas

Ressalva: este recorte é de páginas públicas e editais. Nenhum organizador
foi ouvido. Kodar, Hackathon CCR, HackBrasil, Campus Party, Startup Weekend,
Febraban Tech e o ecossistema web3 BR (Superteam Brasil, ETHSamba) não
foram estudados.

### Quem disputa o quê

| Player | O que é | Ameaça real pro HackaHub | Fonte |
|---|---|---|---|
| **Status quo** (edital PDF + Google Forms/Even3/Sympla/Canva/Gupy + zap + planilha) | é como IF, órgão público, empresa e liga rodam hoje | **a maior.** É grátis, conhecido e o jurídico já aprovou o formato | editais TRT-12, IFSULDEMINAS 220/2025, UNISAGRADO, Receita (Even3), Itaú (Gupy) [V] |
| **NoCountry** (Argentina) | simulação laboral de 5 semanas + Hackathon ONE Brasil/Latam com Oracle e Alura | **alta no canal instituição/empregabilidade.** 197 brasileiros só no caso Oracle; já roda trilha Brasil separada | nocountry.tech/casos-de-exito, /showcase [V] |
| **AI Tinkerers SP** | meetup mensal curado (~160–180 inscritos por meetup) + hackathons com DeepMind, Claro, ESPM, BMG, Blip, Oracle | **média.** Disputa a mesma galera técnica de SP e os mesmos patrocinadores. Não publica resultado nem critério em dia | saopaulo.aitinkerers.org, /hackathons/h_FnfRJGC4z7Q/results [V] |
| **Luma** | página de evento + lista + calendário seguível; padrão da cena tech de SP (Claude Community, Lovable) | **média como hábito.** Hackathon no Luma vira texto solto, mas as comunidades já têm seguidores lá | luma.com/r1iqjxtk, /yuoid9vr [V] |
| **Hackathon Brasil (HB)** | agência que realiza hackathon pra empresa (Siemens/Mendix, Transpetro, Sebrae) num WordPress | **baixa como produto, média como serviço**: vende o evento pronto | hackathonbrasil.com.br [V] |
| **Devpost / Devfolio / DoraHacks / TAIKAI** | plataformas globais; web3 BR usa algumas (ETH Latam SP 2025 via TAIKAI, só snippet do Sympla) | **média em web3, baixa em universidade.** Sem pt-BR, sem certificado com horas, prêmio em USD/cripto | [S] Sympla; [V] sites |
| **DIO / Rocketseat** | bootcamps com marca de empresa (DIO) e semana temática (NLW) | **baixa direta.** Competem pela atenção do estudante e pelo orçamento de employer branding | dio.me/bootcamp [V]; NLW deu 404 |
| **Shawee** | foi a "plataforma brasileira de hackathon" (R$25 por logado, R$100 mil+ por evento completo, faturou R$400 mil em 2017, ~18 clientes) | **baixa hoje**: site com última modificação em 2020 e Mega Rank fora do ar. Se morreu, pivotou ou foi pros EUA, não foi investigado | projetodraft.com (2018), shawee.io [V] |
| **Hacking.Rio** | movimento com edições grandes em 2018/2020 (números só num preview não publicado) | **desconhecida.** O site analisado é preview provisório em noindex; a próxima edição seria em nov/2027 | hacking.rio [V, HTML com meta noindex] |
| **NASA Space Apps BR** | maior hackathon do ano, 14–15/11/2026, sedes locais com Sympla próprio | **oportunidade, não ameaça**: ninguém agrega as sedes BR | Sympla [V]; astrobiology.com [V] |

### Lacunas que ninguém cobre no Brasil (e o HackaHub já cobre ou quase)

1. **Certificado com carga horária verificável** ligado a presença e entrega (hora complementar e curricularização da extensão, Res. CNE/CES 7/2018). **(já existe)** em `/c/[code]`. É provavelmente o maior motivo pro estudante usar e pra universidade adotar; validar com 2–3 coordenadores (037).
2. **Regra escrita traduzida pro estudante**: PI, horas, IA, desempate, recurso. Hoje fica no PDF em juridiquês.
3. **Resultado com critério, no dia, com feedback.** Os concorrentes estudados atrasam (AI Tinkerers, lablab, Devpost) ou não devolvem nada. **(feedback já existe, 038)**.
4. **Status individual da seleção** no lugar de lista pública em PDF.
5. **Montagem de time por cota de perfil** que hoje é planilha.
6. **Pagamento de prêmio com status** (CPF, PIS, conta, divisão por integrante, IR).
7. **Agregador de hackathons BR com sedes do Space Apps**, Sebrae regional, Senac, prefeituras e hubs (a cauda longa que aparece no próprio print do Sympla: Cidades Sábias, Decola/Senac, Unimed/Sebrae Uberlândia, HackathOrion, Prefeitura de Marau). Esse é o ICP mais provável do HackaHub e não foi estudado. **[hipótese]**

### Jurídico que pesa no produto (não decidir sem advogado)

- **Lei 5.768/71 e concurso cultural:** distribuir prêmio exige autorização, salvo concurso exclusivamente cultural/artístico/científico sem vínculo com compra ou uso de produto. Desafio com "uso obrigatório da stack do patrocinador" pode virar promoção comercial.
- **IRRF sobre prêmio em dinheiro** retido pelo pagador (a checagem cita 30%, Lei 4.506/64 art. 14) e informe de rendimentos. Ganhador pessoa física não emite nota.
- **Menores:** ECA e LGPD art. 14 (consentimento do responsável). F9 da 041 ainda está aberto.
- **Dados sensíveis:** autodeclaração racial e PcD pra cota.
- **PI:** padrão "fica com o time"; cessão não onerosa opcional e explícita (modelo TRT-12 13.5, com direito do time de seguir explorando).

---

## 5. Posicionamento e promessa da landing

Regra: sem falar contra ferramenta ou pessoa. A 039 já tem "Sua comunidade de
hackathon." no hero; as opções abaixo testam uma promessa mais concreta.

**Opção A — prova**
- Headline: **"O que você construiu fica com você."**
- Sub: "Inscrição, time, entrega e resultado da edição num lugar só. No fim, certificado com horas e o projeto no seu portfólio, com o prêmio e o seu papel no time."

**Opção B — o dia do evento**
- Headline: **"Hackathon com regra clara e resultado no mesmo dia."**
- Sub: "Critério publicado antes de você se inscrever, nota e comentário do júri pra todo time e certificado de horas assim que acaba. Em português, no celular."

**Opção C — comunidade**
- Headline: **"Sua próxima edição começa aqui."**
- Sub: "Ache hackathons no Brasil, monte time por papel, entregue o projeto e leve o histórico de uma edição pra outra."

Recomendação: **A** pra quem participa (fala da dor nº 1 que os FAQs mostram:
dono do código e prova) e **B** como linha do bloco do organizador. Testar A
contra o hero atual com o contador de cliques no CTA primário por 2 edições.
Toda frase precisa passar no teste de 3 perguntas do style guide do AI
Tinkerers: o leitor visualiza? é falseável? outra comunidade poderia dizer o
mesmo? [V aitinkerers.org/docs/brand/style_guide.md]. "Resultado no mesmo
dia" só pode ir pro ar se o produto obrigar `resultsAt` (backlog #3).

---

## 6. Backlog priorizado (impacto × esforço)

Conferido no código em `main` @ 4c4871b. **Não entra** o que já existe: RSVP
e fila, check-in offline, crachás, refeições, certificado com horas, feedback
do júri, NPS, opt-in de patrocinador, relatório do patrocinador, snapshot de
entrega, prazos, prêmios por categoria, onboarding, `/organizar`, conduta e
incidentes, modelo da descrição pela rubrica (`EntryEditor`), botão
"adicionar ao LinkedIn" no certificado e filtros de edição/busca/ordem em
`/projetos`. A 041 (auditoria) vem antes de tudo: não faz sentido polir UX
com fuso quebrado e time travado.

Esforço: P (≤1 dia) · M (2–5 dias) · G (>1 semana).

### Agora (alto impacto, baixo esforço)

| # | O quê | Por quê / fonte | Onde | Esf. |
|---|---|---|---|---|
| 1 | **Cartão mínimo com prova** em `/p/[teamId]` e `/u/[username]` (selo, papéis, links, 4 números, fixados; indexável, com OG), dentro da regra de login da 039 (ver 3.4). Abrir a página inteira = decisão do dono, fora deste item | Devpost/Devfolio/Colosseum mostram prova sem login; AIT e TAIKAI perdem SEO com página vazia | as duas páginas, `sitemap.ts` | P |
| 1b | **Bloco "perguntas de quem vai participar" na landing + teaser com regra inteira** (chips, critérios, data do resultado); requer `edition_terms.ipPolicy` | regra 1 do dono; FAQ Low Hack | `/`, `/h/[id]`, migration | P |
| 1c | **Data de nascimento só quando a edição aceita menor**; 18+ = declaração com timestamp | MLH; dado mínimo | `registration_terms`, `RegistrationForm` | P |
| 2 | **Tirar XP de like e post**; XP só por check-in, entrega travada, nota recebida, prêmio, mentoria/júri cumpridos; janela de 6 meses + "não interfere no julgamento" | farm visto em lablab, TAIKAI, Devfolio; 036 | `lib/game.ts`, `/membros` | P |
| 3 | **`resultsAt` obrigatório** + selo "resultado atrasado" + alerta pro admin | atrasos em Devpost, lablab, AIT; MLH proíbe resultado depois | `hackathons`, `/h/[id]`, cron | P |
| 4 | **Edição encerrada: resultado primeiro + "próxima edição"** | lablab, Luma | `/h/[id]` | P |
| 5 | **Papel por membro** (`team_members.role` ≤120) no projeto, perfil e certificado | Devpost, AIT, TAIKAI | migration, `/p`, `/u`, certificado | P |
| 6 | **Rubrica ancorada** (`anchors` 1/3/5) + critério como pergunta + rubrica publicada na edição + soma de pesos = 100 | lablab Rule Book, DoraHacks | `rubric_criteria`, tela do jurado, `/h/[id]` | M |
| 7 | **Endereço só pra aprovados** (`venuePrivate`) | Luma, AIT; 034 | `/h/[id]`, ingresso, e-mail | P |
| 8 | **Chips "o que o estudante pergunta"** (horas, dono do código, custo, precisa de time) | FAQ Low Hack | `/h/[id]` | P |
| 9 | **Completar o modelo da descrição** (já sai da rubrica): fallback sem rubrica + "O que quebrou" e "Próximos passos" sempre | Devpost, Devfolio, AIT | `EntryEditor` | P |
| 10 | **Galeria: "N projetos · M com vídeo", filtros premiado/vídeo/demo/stack/desafio, ordem `?seed=`, selo único** (edição, busca e ordem já existem) | AIT, Colosseum, Devpost | `/projetos`, `/h/[id]/projetos` | M |
| 11 | **`?ref=` + `utm_*` na inscrição** + funil por origem/IES no admin | Luma, Devfolio | `registrations`, admin | P |
| 12 | **`/llms.txt` + regulamento em markdown** gerado das tabelas da edição, as duas rotas na allowlist | AIT, NoCountry, TAIKAI | rota nova, `lib/access.ts` | P |

### Próximo (alto impacto, esforço médio)

| # | O quê | Por quê / fonte | Esf. |
|---|---|---|---|
| 13 | **Desafio estruturado**: qualifica/não qualifica, critérios com peso, feedback desejado, docs, `maxPorProjeto` (padrão 2), "como usou" + "feedback pro patrocinador" obrigatórios; patrocinador edita via convite | ETHGlobal, lablab, DoraHacks; TAIKAI como contraexemplo | M |
| 14 | **Opt-in de listagem por membro** (hoje é só por inscrição) pra facepile, "quem vai" e vitrine "Nome (IES) fez X" | Luma, AIT, Hack Club | P |
| 15 | **Desempate ordenado + sorteio com semente + janela de recurso + provisório/homologado + penalidades** | TRT-12, IF, UNISAGRADO | M |
| 16 | **Planejador de júri** (fórmula, alocação escalonada, progresso no telão) + **"me declaro impedido"** + fechamento automático no `juryDeadline` | MLH, Devpost, TAIKAI | M |
| 17 | **Julgamento do patrocinador sem nota** + jurado por link assinado, expirável e revogável | Devfolio, DoraHacks | M |
| 18 | **Vagas de time** (skill + intro 280 + aceite + expiração) e **montagem pelo organizador com cotas por perfil** | TAIKAI, Colosseum, TRT-12, Low Hack | M |
| 19 | **Inscrição a partir do perfil**: a edição declara campos exigidos, form mostra só o que falta, barra 100% | Devfolio | M |
| 20 | **Revisão em dois tempos** (`decision` ≠ `notifiedAt`), envio em lote, lembrete de inscrição incompleta, seleção com cotas afirmativas e status individual | Devfolio, Low Hack | M |
| 21 | **Aba Entrega no projeto** (snapshot + "o que mudou depois") + visibilidade por campo (público/só júri) | Devpost, Colosseum | M |
| 22 | **Prêmio: dados de pagamento só pros premiados + status por pessoa + CSV pro financeiro** (depois do parecer de IR/Lei 5.768) | TRT-12; contraexemplos Devpost/lablab | M |
| 23 | **`prize_winners.why` + `results_note`** publicados na edição e no blog | lablab, DoraHacks | P |
| 24 | **Cor da edição** (`accentColor`) em página, ingresso, certificado e e-mail com checagem AA | Luma, ETHGlobal | P |
| 25 | **Continuidade D+30/D+90** + selo "continuou" + métrica pública | SBC, TAIKAI | M |

### Depois (validar antes)

| # | O quê | Por quê esperar | Esf. |
|---|---|---|---|
| 26 | **Sedes** (multi-polo com pré-banca) | só com um cliente multi-campus de verdade | G |
| 27 | **Radar das sedes BR do Space Apps** | as inscrições de várias sedes podem fechar antes de 14/11, e não há prova de que alguém usaria um agregador intermediário. Fazer manual em 1 dia ou pular | P |
| 28 | **Página da organização seguível + encontros + newsletter "Última chance"** | depende do Resend em produção (F2) | M |
| 29 | **Liga universitária** | galinha e ovo com 1 organizador; fonte da MLH é de 2013; porta falsa antes | G |
| 30 | **Gerador de regulamento** | jurídico do cliente pode não aceitar; base legal a validar | M |
| 31 | **Relatório final no formato de atestado** | só depois de um cliente público | P |
| 32 | **API pública de leitura** | depois do `llms.txt` mostrar uso | M |
| 33 | **Login embutido no card** (Clerk embutido, código por e-mail/passkey) | testar se o Clerk prod suporta sem redirect | M |
| 34 | **Validação automática da duração do vídeo** | exige YouTube Data API; o checklist resolve 80% | M |
| 35 | **Peer review intra-time N≥3** | 037 #17; dado sensível pra recrutador | M/G |

---

## 7. O que NÃO fazer

Soma da 036 e da 037 com o que estas referências mostraram:

1. **Página pública vazia em projeto e perfil.** O que mata portfólio, SEO e link no zap (AI Tinkerers, TAIKAI) é o visitante não ver prova nenhuma. Dentro da regra de login da 039, o cartão mínimo tem que carregar a prova (3.4); a 039 não precisa ser revertida.
2. **Ranking por volume, like, post, quest ou indicação.** Vira farm em todo lugar estudado.
3. **Contador animado começando em 0** e número de vaidade sem definição. Todo número sai de uma query, com data, da mesma fonte em todas as páginas (Devpost, lablab, NoCountry, ETHGlobal, TAIKAI publicam números que não batem entre si; nos casos da AIT e da ETHGlobal são métricas diferentes, e o certo é rotular).
4. **Resultado sem data**, publicado só fora da plataforma, ou página encerrada com critério "TBD".
5. **Feedback zero** ("não damos feedback individual"). É a lacuna que o HackaHub já ocupa.
6. **IA dando nota, ranqueando candidato ou escolhendo o que o jurado vê** (DoraHacks AI Judging, BUIDL Recommendation).
7. **Token, NFT, voto on-chain, caução em cripto** (Devfolio, ETHGlobal, TAIKAI). Se um dia houver caução, Pix com devolução automática e status visível.
8. **Pay-to-skip** (ETHGlobal Plus fura prazo de inscrição "if you're hacking" e recebe prêmio em 10 dias). Numa comunidade pequena destrói a sensação de justiça.
9. **Anúncio ou popup de terceiro** dentro da página da edição; vender link pago no conteúdo (HB).
10. **Lista de selecionados com nome completo em PDF público** (Low Hack).
11. **Página feita de imagem** (Canva) e regra só em PDF.
12. **Default de PI pro organizador** e **spec work** em que o cliente leva acesso a todos os repos.
13. **Telemetria de presença como nota** (índice de atividade relativo da NoCountry: mede mensagem e minuto em call, não entrega).
14. **Consentimento atrelado** ou caixa pré-marcada.
15. **Dashboard público com atividade de pessoa/time.** Dado por time é privado do time e do organizador.
16. **Copiar mecânica de simulação remota de 5 semanas** (sprints, realocação na semana 1) pra hackathon presencial de fim de semana.
17. **Critérios 100% de startup** (market size, viability, equity; Colosseum) em hackathon universitário.
18. **Copy contra ferramenta ou pessoa** (regra do dono): nada de "sem Forms", "sem grupo de zap", "melhor que o Devpost". As comparações deste estudo ficam aqui dentro.
19. **Tom de hype ou genérico** ("Empowering AI Innovation", "Post-AI society is plastic", "seamless", "unparalleled expertise") e urgência fabricada ("vagas cada vez mais limitadas"). Mostrar capacidade real: "cabem 120, 340 pedidos".
20. **Prometer o que depende de jurídico** (Pix em 30 dias, prêmio de missão, cessão de PI) antes do parecer.
21. **Construir liga, selo ou gerador de edital antes de falar com 5 organizadores** e fazer porta falsa.

---

## 8. Fontes

Fontes primárias abertas pelos estudos e conferidas na checagem. Itens com
403 dependem de print em `scratchpad/refs/<slug>/`.

**Devpost:** devpost.com [403] · devpost.com/hackathons [403] · devpost.com/software/popular [403] · devpost.com/software/globot-341w9q [403] · devpost.com/mahui012 [403] · gemini3.devpost.com (+/project-gallery, /participants, /updates) [403] · amazonappdev2026.devpost.com/rules [403] · secure.devpost.com/users/register [403] · info.devpost.com · info.devpost.com/product/public-hackathons · info.devpost.com/product/devpost-for-teams · help.devpost.com/article/82, 103, 107, 114, 115, 119, 121, 123, 126, 131, 142, 143 · help.devpost.com/category/21-setting-up-your-hackathon-page · dev.to/jacklyn/how-to-make-your-devpost-submissions-not-suck-37i0 · forum.trondao.org/t/tron-grand-hackathon-improving-your-devpost-judge-score/9393

**lablab:** lablab.ai · /ai-hackathons/amd-developer-hackathon-act-iii (+ /live) · /ai-hackathons/amd-lablab-ai-academy-challenge · /ai-hackathons/alpaca-ai-trading-agents-hackathon · /leaderboard · /u/@Morning111 · /u/@mirzayasirabdullahbaig · /hackathon-rules · /guidelines · /guide/how-to-win-an-ai-hackathon · /help-center · /sponsor · /cooperation · /apps · /ai-articles/build-your-ai-startup-hackathon-winner-announcement · surge.lablab.ai/about · producthunt.com/products/lablab-ai/reviews

**Colosseum:** colosseum.com · /hackathon · /eternal · /accelerator · /cofounder-matching · /worldsfair · /frontier · /arena/projects/explore · /arena/hackathon/hall-of-fame · /arena/projects/crowdbrain · /companies/crowdbrain · /analytics · /changelog · /robots.txt · blog.colosseum.com/cofounder-matching · /expanding-the-arena · /how-to-win-a-colosseum-hackathon · /perfecting-your-hackathon-submission

**AI Tinkerers:** aitinkerers.org · /about · /p/faq · /llms.txt · /docs/brand/style_guide.md · /docs/public/guides/organizer_first_90_days?markdown=1 · /docs/public/member-account-help.md · /organize-a-city · /sponsor · /hackathons · /hackathons/h_bR4e1ymrqkc (+ /teams/ht_x8-q1Uk7vEw) · /hackathons/h_FnfRJGC4z7Q/showcase e /results · saopaulo.aitinkerers.org · saopaulo.aitinkerers.org/p/ai-tinkerers-sp-e-claro · post-training.aitinkerers.org

**NoCountry:** nocountry.tech · /llms.txt · /llms-full.txt · /para-empresas/contratar · /para-empresas/validacion-de-producto · /soluciones/subi-tu-desafio · /para-instituciones · /casos-de-exito · /simulacion-laboral/como-funciona · /simulacion-laboral/que-insights-genera · /showcase · /showcase/hackathon-one/equipo-2-brasil · talent.nocountry.tech (strings i18n) · companies.nocountry.tech/simulation [1 print] · forbesargentina.com/innovacion/...n23857 (cita só o CEO; o CTO e a Draper não estão nela)

**ETHGlobal:** ethglobal.com · /events · /events/lisbon2026 (+ /prizes) · /events/ethonline2025/sponsor · /events/prague/info/details · /events/agents/info/details · /events/tokyo/info/start · /rules · /showcase/oniblock-4hnma · /plus · /packs · /about · theblock.co/post/326975 · /events/mumbai [500 na checagem]

**MLH e Hack Club:** mlh.com · /seasons/2027/events · /event-membership · sponsor.mlh.com · /events/prizes · /events/global-hack-week-open-source-90/challenges · guide.mlh.com (registrations, judging-plan, cheating-check, rules-for-your-hackathon, sponsorship-prospectus) · raw.githubusercontent.com/MLH/mlh-policies/main/member-event-guidelines.md e code-of-conduct.md · blog.mlh.com (aquisição do DEV, 18/02/2026) · news.mlh.io/how-scoring-works-09-06-2013 [404] · hackclub.com · /programs · hackathons.hackclub.com · ysws.hackclub.com · hackclub.com/fiscal-sponsorship · github.com/hackclub/summer-of-making (vote.rb, payout.rb) · news.ycombinator.com/item?id=45913663

**Devfolio e DoraHacks:** devfolio.co · /hackathons · /builders · /@swarnimw · /projects/tollchain-3125 · ethindia2024.devfolio.co (+ /prizes, /projects, /quadratic-voting) · ethforall.devfolio.co/leaderboard · guide.devfolio.co (application-tab, review-tab, overview-tab, sponsor-judging, offline-judging, create-join-a-team, project-submission, judging-1, claims, leaderboard, staking) · devfolio.co/blog/designing-a-better-ux-for-hackathons (2018) · devfolio.co/blog/introooducing-quadratic-voting-on-devfolio · devfolio.co/blog/when-india-came-together-to-vote-at-ethindia · dorahacks.io · /hackathon/sonic-defai-hackathon (detail, buidl, winner) · /build/24044 · dorahacks.io/blog/guides (how-to-create-a-hackathon, hackathon-judging-plan, judging-organizers, judging-judges) · dashboard.dorahacks.io/premium [SPA, só print] · dev.to/dorahacks/dorahacks-hackathon-newsletter-2026-january-2odj

**Luma:** help.luma.com/llms.txt · help.luma.com/p/ (event-registration-process, collect-registration-questions, waitlist, payment-require-approval, check-in, event-guest-list, hiding-your-event-location, luma-calendar-overview, submitting-events-to-calendars, send-limits, event-insights, event-referrals, collect-feedback-from-your-event-guests, update-to-reminders-on-luma, featuring-your-event-on-luma, event-themes-and-customization) · luma.com/pricing · luma.com/r1iqjxtk · luma.com/yuoid9vr · luma.com/2bekyxsb

**TAIKAI:** taikai.network/en · /en/hackathons · /en/organize-your-hackathon · /en/ai-program · /en/cassinihackathons/hackathons/space-for-peace-resilience/overview · /en/ethargentina/hackathons/tierra-de-buidlers-2025 · /en/ranking · /en/faq · /.well-known/agent-skills/index.json · /.well-known/api-catalog · layerxlabs.notion.site/Voting-52d86952befb4567a453fb01f865cb60 · garden.taikai.network · taikai.network/blog/the-hackathon-project-that-made-it-to-ukraine

**Brasil:** portal.trt12.jus.br/.../08 - EDITAL SEAP N. 08 - Hackathon PETE+.pdf · portal.ifsuldeminas.edu.br/.../Edital Hackathon - 220 2025.pdf · unisagrado.edu.br/.../editalhackday.pdf · hackathonbrasil.com.br (/low-hack/, regulamento-low-hack-2026-online-V2.pdf, lista de selecionados, /atestados-de-capacidade-tecnica/) · siex.siiu.unifesp.br (manual do 1º Hackathon da Receita Federal) · even3.com.br/1a-hackathon-da-receita-federal · sympla.com.br/eventos?s=hackathon · shawee.io · projetodraft.com/a-shawee-e-a-arte-de-ganhar-dinheiro... · hacking.rio [preview noindex] · dio.me/bootcamp · dio.me/es/articles/relato-do-ranking-da-dio-bug · letsmoney.com.br/noticias/itau-batalha-de-agentes-hackathon-ia · sol.sbc.org.br/index.php/semish/article/download/11312/11175 · revista.feb.unesp.br/gepros/article/view/2809 · camara.leg.br (Lei 5.768/71) · jornal.usp.br/?p=608900

**Internas:** specs/034, 036, 037, 038, 039 e 041 deste repo; código em `main` @ 4c4871b (`lib/game.ts`, `lib/access.ts`, `migrations/001–018`).
