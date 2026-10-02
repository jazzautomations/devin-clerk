import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { appConfig } from "@/app.config";
import { FeatureCard } from "@/components/FeatureCard";
import { HackathonFeed } from "@/components/HackathonFeed";
import { getTags, getUpcomingHackathons } from "@/lib/hackathons";
import { getOrCreateMember } from "@/lib/members";
import { getRegistrationIds } from "@/lib/registrations";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const member = getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email,
  });
  const name = user?.firstName ?? member.name ?? email.split("@")[0];
  const now = new Date();
  const hackathons = getUpcomingHackathons(now);
  const tags = getTags(hackathons);
  const registeredIds = getRegistrationIds(member.id);
  const [nextFeature] = appConfig.upcomingFeatures;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// feed"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Salve{name ? `, ${name}` : ""}.
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Hackathons abertos — os da comunidade com inscrição em 1 clique, e o
          resto do mundo curado embaixo.{" "}
          <Link href={`/u/${member.username}`} className="text-accent hover:underline">
            teu perfil público →
          </Link>
        </p>
      </div>

      <HackathonFeed
        hackathons={hackathons}
        tags={tags}
        now={now.toISOString()}
        registeredIds={registeredIds}
      />

      <div className="flex flex-col gap-4">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          vindo por aí
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {appConfig.upcomingFeatures.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>

      {nextFeature && (
        <div className="border border-dashed border-accent/40 bg-accent/5 px-5 py-4 font-mono text-xs text-muted">
          <span className="text-accent">$ keep_building:</span> open Devin and
          ask it to &ldquo;Build &lsquo;{nextFeature.title}&rsquo; from the
          Coming soon page.&rdquo;
        </div>
      )}
    </section>
  );
}
