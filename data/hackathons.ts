import type { Hackathon } from "@/lib/hackathons";

// sessões hack inova — edições da comunidade (o radar externo vem do
// scraper: `uv run --python .venv-scraper/bin/python scripts/scrape_radar.py`)
export const hackathons: Omit<Hackathon, "partner">[] = [
  {
    id: "hack-inova-alphaville-2026",
    name: "Hack Inova Alphaville",
    organizer: "Hack Inova + Unipe",
    startsAt: "2026-11-14T09:00:00-03:00",
    endsAt: "2026-11-15T18:00:00-03:00",
    format: "presencial",
    location: "Alphaville, SP",
    registrationUrl: "https://hackinova.vercel.app",
    registrationDeadline: null,
    tags: ["ia", "comunidade"],
    active: true,
  },
];

// edições passadas — arquivo/histórico da comunidade (dados reais dos sites)
export const pastHackathons: Omit<Hackathon, "partner">[] = [
  {
    id: "hack-inova-unifacens-2026",
    name: "Hackathon Inova AI × Payment Shift",
    organizer: "Hack Inova × Unifacens · apoio Oracle + Enterprise X Ventures",
    startsAt: "2026-08-17T09:00:00-03:00",
    endsAt: "2026-08-17T18:00:00-03:00",
    format: "presencial",
    location: "UniFACENS, Sorocaba",
    registrationUrl: "https://hackinova.vercel.app",
    registrationDeadline: null,
    tags: ["ia", "produtos-digitais"],
    active: true,
  },
  {
    id: "hack-inova-puc-saude-2026",
    name: "Hackathon de IA na Saúde — PUC Consolação",
    organizer: "Hack Inova × Hackathon Shift",
    startsAt: "2026-09-12T09:00:00-03:00",
    endsAt: "2026-09-12T19:00:00-03:00",
    format: "presencial",
    location: "PUC-SP Consolação, São Paulo",
    registrationUrl: "https://hackinova.vercel.app",
    registrationDeadline: null,
    tags: ["ia", "saude", "oracle"],
    active: true,
  },
  {
    id: "hackinova-os-2-anhembi-2026",
    name: "HackInova.OS 2 — IA na Saúde",
    organizer: "Hack Inova",
    startsAt: "2026-09-22T19:00:00-03:00",
    endsAt: "2026-09-25T22:00:00-03:00",
    format: "presencial",
    location: "Anhembi Morumbi · Av. Paulista 2000, São Paulo",
    registrationUrl: "https://hackinova-anhembi.vercel.app",
    registrationDeadline: null,
    tags: ["ia", "saude", "agentes"],
    active: true,
  },
];
