import { SignUp } from "@clerk/nextjs";
import { appConfig } from "@/app.config";

export default function SignUpPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center px-6 py-16">
      <SignUp appearance={{ variables: { colorPrimary: appConfig.accent } }} />
    </section>
  );
}
