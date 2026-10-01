import { auth, currentUser } from "@clerk/nextjs/server";
import { appConfig } from "@/app.config";
import { FeatureCard } from "@/components/FeatureCard";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  const user = await currentUser();
  const name =
    user?.firstName ?? user?.primaryEmailAddress?.emailAddress.split("@")[0];
  const [nextFeature] = appConfig.upcomingFeatures;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// early access"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Salve{name ? `, ${name}` : ""}.
        </h1>
        <p className="max-w-xl text-lg text-muted">
          O {appConfig.name} tá chegando. Tu já tá na lista — olha o que vem
          por aí:
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {appConfig.upcomingFeatures.map((feature, index) => (
          <FeatureCard key={feature.title} feature={feature} index={index} />
        ))}
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
