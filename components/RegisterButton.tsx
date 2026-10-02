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
  const [reward, setReward] = useState<string | null>(null);

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
        if (data.registered) {
          const parts = [data.xp ? `${data.xp} xp` : null]
            .concat(data.cardSerial ? [`carta №${String(data.cardSerial).padStart(3, "0")} mintada`] : [])
            .concat(data.newBadges?.length ? [`badge nova: ${data.newBadges.join(", ")}`] : [])
            .filter(Boolean);
          setReward(parts.join(" · "));
        } else {
          setReward(null);
        }
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
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
    {reward && (
      <p className="font-mono text-xs text-accent">{"// "}{reward}</p>
    )}
    </div>
  );
}
