import { SignIn } from "@clerk/nextjs";
import { appConfig } from "@/app.config";

export default function SignInPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center px-6 py-16">
      <SignIn appearance={{ variables: { colorPrimary: appConfig.accent } }} />
    </section>
  );
}
