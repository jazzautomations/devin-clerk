import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateMember, type Member } from "@/lib/members";

/** membro logado (materializa no primeiro acesso) ou null deslogado */
export async function currentMember(): Promise<Member | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  return getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    imageUrl: user?.imageUrl ?? null,
  });
}
