import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { Avatar } from "@/components/Avatar";
import { getOpenHackathons, isRegistrationClosed } from "@/lib/hackathons";
import { getOrCreateMember } from "@/lib/members";
import { safeRedirect } from "@/lib/onboarding";
import { getOpenKinds } from "@/lib/roleApplications";
import { getOpenTo } from "@/lib/talent";

// spec 039 — onboarding pós-cadastro. O proxy manda pra cá a primeira
// página logada de quem ainda não tem o cookie de onboarding; aqui o banco
// decide: membro já onboarded só ganha o cookie (/api/onboarding/ok) e
// volta pra onde ia; membro novo vê os 3 passos.

export const metadata: Metadata = { title: "bem-vindo", robots: { index: false } };

export default async function BemVindoPage({ searchParams }: PageProps<"/bem-vindo">) {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: "/bem-vindo" });
  const sp = await searchParams;
  const back = safeRedirect(typeof sp.redirect_url === "string" ? sp.redirect_url : null);

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const member = await getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email,
    imageUrl: user?.imageUrl ?? null,
  });
  if (member.onboardedAt && sp.refazer === undefined) {
    redirect(`/api/onboarding/ok${back ? `?redirect_url=${encodeURIComponent(back)}` : ""}`);
  }

  const now = new Date();
  const open = (await getOpenHackathons(now)).filter((h) => h.hosted);
  const next = open.find((h) => !isRegistrationClosed(h, now)) ?? null;
  let help: { id: string; name: string; kind: "mentor" | "jurado" | "voluntario" } | null = null;
  for (const h of open) {
    const kinds = await getOpenKinds(h.id);
    const kind = kinds.find((k) => k === "mentor") ?? kinds.find((k) => k === "jurado") ?? kinds[0];
    if (kind) {
      help = { id: h.id, name: h.name, kind };
      break;
    }
  }
  const openTo = await getOpenTo(member.id);
  const first = (member.name ?? user?.firstName ?? "").split(" ")[0];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex items-center gap-4 border-b-2 border-line pb-6">
        <Avatar username={member.username} name={member.name} avatarUrl={member.avatarUrl} size="md" />
        <div className="min-w-0">
          <p className="tag">BEM-VINDO</p>
          <h1 className="mt-2 text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
            {first ? `Salve, ${first}.` : "Salve."}
          </h1>
        </div>
      </header>
      <OnboardingWizard
        redirectUrl={back}
        nextEdition={next ? { id: next.id, name: next.name } : null}
        helpEdition={help}
        initial={{
          name: member.name ?? "",
          headline: member.headline ?? "",
          personas: member.personas,
          intents: member.intents ?? [],
          city: member.city ?? "",
          institution: member.institution ?? "",
          course: member.course ?? "",
          github: member.github ?? "",
          linkedin: member.linkedin ?? "",
          openTo,
        }}
      />
    </div>
  );
}
