"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// frente N #6 — o inscrito liga/desliga a própria exibição na lista
// pública de inscritos da edição (opt-in, revogável a qualquer momento)
export function PublicListingToggle({ hackathonId, initial }: { hackathonId: string; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[13px] leading-snug text-muted">
      <input
        type="checkbox"
        data-testid="public-listing-toggle"
        className="mt-0.5 size-4 shrink-0 accent-[#047a43]"
        checked={on}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.checked;
          setBusy(true);
          const res = await fetch(`/api/hackathons/${hackathonId}/register`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicListing: next }),
          }).catch(() => null);
          if (res?.ok) {
            setOn(next);
            router.refresh();
          }
          setBusy(false);
        }}
      />
      <span>aparecer nesta lista (@usuário e foto)</span>
    </label>
  );
}
