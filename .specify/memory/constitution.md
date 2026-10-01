<!--
Sync Impact Report — temporary review material, remove before commit.
- Version change: none → 1.0.0 (initial ratification)
- Principles ratified: Spec-Driven Increments; Community-First Monetization;
  Auth & Data Integrity; One-Session Scope; No Slop UI
- Added sections: Tech Baseline; Production Checklist Gate
- TODOs: none
-->

# HackaHub Constitution

## Core Principles

### I. Spec-Driven Increments

Every feature ships as one spec → plan → tasks → implement cycle inside this
repository. No "big rewrite" branches. A feature enters `upcomingFeatures` in
`app.config.ts` when specced and leaves the list when shipped, linked from the
header.

### II. Community-First Monetization

Participants NEVER pay to discover or join a hackathon. Revenue streams come
from sponsors, companies posting challenges, and paid preparation content —
the user-facing core (profile, feed, registration) stays free.

### III. Auth & Data Integrity (NON-NEGOTIABLE)

Every member-only page MUST be protected via `proxy.ts` route matching; every
member-only API route MUST return `401 {"error":"Unauthorized"}` when signed
out rather than redirecting. `auth()` is always awaited. Clerk keys live only
in `.env.local` (dev) or deployment env (prod) — never printed, logged, or
committed. `.clerk/` and `.env*` (except `.env.example`) stay out of git.

### IV. One-Session Scope

Each feature must be small enough for a single Devin session. If a spec can't
be built and verified in one session, split it. Prefer boring, working code
over ambitious half-features — "sem fuleiragem".

### V. No Slop UI

Consistent design system only: the dark terminal tokens in `globals.css`
(`background`, `surface`, `line`, `muted`, `accent`), Space Grotesk for
display, Geist for body, Geist Mono for labels. No generic gradients, no
emoji heroes, no rounded-pill CTAs. PT-BR copy throughout.

## Tech Baseline

Next.js 16 App Router + TypeScript + Tailwind v4 + Clerk (`@clerk/nextjs`,
keyless dev mode, claimable instance). Middleware file is `proxy.ts` —
`middleware.ts` is not used. Branding and the roadmap list live in
`app.config.ts`, not in components. Data features default to Postgres via a
plain SQL/ORM-free adapter unless a spec says otherwise; newsletter is
Resend-ready but not required for the MVP.

## Production Checklist Gate

A feature is NOT done until `PRODUCTION.md` checks pass for its scope:
`npm run lint`, `npm run typecheck`, `npm run build` clean; `/` returns 200,
`/dashboard` redirects to Clerk sign-in, `/api/roadmap` returns 401 signed
out; no secrets in the diff; mobile width (390px) has no horizontal scroll.

## Governance

- Amendments happen by editing this file in a commit; bump
  `CONSTITUTION_VERSION` per semver (MAJOR: principle removed/redefined,
  MINOR: new principle/section, PATCH: wording).
- `RATIFICATION_DATE` is fixed at first adoption; `LAST_AMENDED_DATE` tracks
  the last change.
- Every spec and plan MUST be checked against these principles before
  implementation; violations need an explicit Complexity Tracking note in
  the plan.

**Version**: 1.0.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-01
