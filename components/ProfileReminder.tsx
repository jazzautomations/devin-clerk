import Link from "next/link";
import type { Member } from "@/lib/members";
import { profileCompleteness } from "@/lib/onboarding";

// spec 039 — lembrete discreto de perfil incompleto (dashboard e /perfil).
// Some quando chega a 100%. Sem modal, sem bloqueio.
export function ProfileReminder({ member, href = "/bem-vindo?refazer=1" }: { member: Member; href?: string }) {
  const { percent, missing } = profileCompleteness({
    name: member.name,
    headline: member.headline,
    personas: member.personas,
    city: member.city ?? null,
    github: member.github,
    linkedin: member.linkedin,
    skills: member.skills,
  });
  if (percent >= 100) return null;
  return (
    <div
      data-testid="profile-reminder"
      className="flex flex-col gap-2 border-[1.5px] border-line-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="font-mono text-[13px] font-semibold text-accent tabular-nums">{percent}%</span>
        <span aria-hidden className="relative h-[4px] w-24 shrink-0 bg-chrome">
          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${percent}%` }} />
        </span>
        <p className="min-w-0 truncate text-[14px] text-muted">
          perfil · falta {missing.join(", ")}
        </p>
      </div>
      <Link href={href} className="shrink-0 font-mono text-[13px] text-accent underline-offset-4 hover:underline">
        completar →
      </Link>
    </div>
  );
}
