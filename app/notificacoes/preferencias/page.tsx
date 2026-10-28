import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPrefs } from "@/lib/notifications";
import { currentMember } from "@/lib/session";
import { PrefSwitch } from "./PrefSwitch";

export const metadata: Metadata = { title: "preferências de notificação", robots: { index: false } };

// Preferências por grupo (migration 040). Desligar social ou comunidade
// para de gravar a notificação nova; o que já chegou fica na lista. O
// resumo semanal é só por e-mail. Os avisos da inscrição não desligam.

type Row = {
  key: "social" | "comunidade" | "digest" | "essencial";
  title: string;
  channel: string;
  body: string;
};

const ROWS: Row[] = [
  {
    key: "social",
    title: "Gente",
    channel: "no HackaHub",
    body: "Curtidas, comentários, respostas, menções, depoimentos e quem começou a seguir você.",
  },
  {
    key: "comunidade",
    title: "Comunidades",
    channel: "no HackaHub",
    body: "Quem entrou na sua comunidade, avisos de quem organiza e hackathon novo das comunidades que você segue.",
  },
  {
    key: "digest",
    title: "Resumo da semana",
    channel: "por e-mail, às segundas",
    body: "Inscrições que fecham na semana, o que a galera que você segue entregou e projetos novos das suas comunidades. Semana sem novidade não manda nada.",
  },
  {
    key: "essencial",
    title: "Sua inscrição",
    channel: "sempre ligado",
    body: "Aprovação, ingresso, confirmação de presença, time, júri e certificado. Avisos da sua inscrição sempre chegam.",
  },
];

export default async function PreferenciasPage() {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const prefs = await getPrefs(member.id);
  const value = (k: Row["key"]) =>
    k === "essencial" ? true : k === "digest" ? prefs.digest.email : prefs[k].inApp;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 overflow-x-clip px-4 py-12 sm:px-6 sm:py-16" data-testid="prefs-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href="/notificacoes" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← notificações
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">O que chega pra você</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">
          Vale pro que chegar daqui pra frente. O que já está na lista continua lá.
        </p>
      </header>

      <ul className="flex flex-col border-b border-line">
        {ROWS.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-4 border-t border-line py-5" data-testid={`pref-row-${r.key}`}>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-[clamp(1.2rem,2.4vw,1.4rem)] leading-tight font-extrabold tracking-[-0.02em]">{r.title}</h2>
              <p className="font-mono text-[12px] uppercase tracking-[0.06em] text-accent">{r.channel}</p>
              <p className="max-w-[56ch] text-[14px] text-muted">{r.body}</p>
            </div>
            <PrefSwitch
              group={r.key === "essencial" ? undefined : r.key}
              initial={value(r.key)}
              label={`${r.title}, ${r.channel}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
