# Checklist de Produção — HackaHub

Gate obrigatório antes de mergear qualquer feature (constitution, seção
"Production Checklist Gate"). Marque cada item com evidência, não com "acho
que funciona".

## 1. Qualidade de código

- [ ] `npm run lint` — 0 erros, 0 warnings novos
- [ ] `npm run typecheck` — `tsc --noEmit` limpo
- [ ] `npm run build` — build de produção completa sem erros
- [ ] Sem `any` novo, sem `console.log` de debug, sem código comentado morto

## 2. Auth & segurança (non-negotiable)

- [ ] Toda página de membro passa pelo `proxy.ts` (redirect → Clerk sign-in)
- [ ] Toda API de membro retorna `401 {"error":"Unauthorized"}` deslogado —
  verificar com `curl` sem cookie de sessão
- [ ] `auth()` sempre com `await`; `user.firstName` tratado como `null`
- [ ] `.env.local`, `.clerk/`, chaves e tokens FORA do diff (`git diff` limpo
  de segredos)
- [ ] Nenhuma credencial em log, comentário, ou resposta de API

## 3. Comportamento (smoke test real)

- [ ] `/` → HTTP 200 pública, sem login
- [ ] `/dashboard` deslogado → 307/redirect pra `*.accounts.dev/sign-in`
- [ ] `/api/*` protegida deslogado → 401 JSON
- [ ] Estado vazio de cada lista nova renderiza sem quebrar
- [ ] Links externos abrem em nova aba com `rel="noopener"`

## 4. UI/UX (design system)

- [ ] Só tokens do sistema: `bg-background`, `bg-surface`, `border-line`,
  `text-muted`, `text-accent` — nada de cor hardcoded nova
- [ ] Space Grotesk em headings, Geist no corpo, mono em labels/dados
- [ ] Copy em PT-BR, tom direto, sem lero-lero
- [ ] 390px de largura: `document.scrollWidth === innerWidth` (sem scroll X)
- [ ] Sem emoji em UI de produto (emoji só no `appConfig.emoji`/docs)

## 5. Dados & feature-specífico

- [ ] Feature saiu de `upcomingFeatures` em `app.config.ts` e ganhou link no
  header quando aplicável
- [ ] Spec da feature (`specs/NNN-*/spec.md`) atualizada se o escopo mudou
- [ ] Tasks do `tasks.md` marcadas conforme executadas

## 6. Release

- [ ] Commit(s) com mensagem clara focada no porquê, trailer Devin
- [ ] `git push origin main` no fork `jazzautomations/devin-clerk`
- [ ] Tunnel `npm run share` verificado via `curl` nos 3 endpoints acima
- [ ] Nenhum link trycloudflare em commit ou PR (o link muda a cada restart)

## Pendências de produção real (quando sair do workshop)

- [ ] Clerk: claim do app + instância de produção (`clerk env pull --instance prod`)
- [ ] Deploy: Vercel com env vars de prod
- [ ] Domínio próprio + redirect do accounts.dev pra produção
- [ ] Banco: Supabase/Postgres pra feed, perfis e inscrições
- [ ] Newsletter: provider (Resend/Loops) + consent LGPD
- [ ] LGPD: política de privacidade + base legal pra dados de perfil
