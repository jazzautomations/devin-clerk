"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RegisterButton({
  hackathonId,
  registered,
}: {
  hackathonId: string;
  registered: boolean;
}) {
  const router = useRouter();
  const [isRegistered, setIsRegistered] = useState(registered);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/register`, {
        method: isRegistered ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setIsRegistered(data.registered);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={
        isRegistered
          ? "border border-accent/50 bg-accent/10 px-6 py-3 font-mono text-sm font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
          : "bg-accent px-6 py-3 font-mono text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
      }
    >
      {loading
        ? "…"
        : isRegistered
          ? "✓ inscrito — cancelar inscrição"
          : "inscrever-se em 1 clique"}
    </button>
  );
}
