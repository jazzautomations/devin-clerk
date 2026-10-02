"use client";

import { useEffect, useState } from "react";

type Deploy = {
  id: string;
  status: "queued" | "building" | "running" | "failed" | "stopped" | "expired";
  error: string | null;
};

const LABEL: Record<Deploy["status"], string> = {
  queued: "na fila",
  building: "buildando…",
  running: "ao vivo",
  failed: "falhou",
  stopped: "parada",
  expired: "expirada",
};

/** painel do deploy tool — membro do time publica/para a demo do projeto */
export function DeployPanel({
  teamId,
  canDeploy,
  hasRepo,
  initialDeploy = null,
}: {
  teamId: number;
  canDeploy: boolean;
  hasRepo: boolean;
  initialDeploy?: Deploy | null;
}) {
  const [deploy, setDeploy] = useState<Deploy | null>(initialDeploy);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = () =>
    fetch(`/api/projects/${teamId}/deploy`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) {
          setDeploy(j.deploy);
          setUrl(j.url);
        }
      })
      .catch(() => {});

  useEffect(() => {
    if (canDeploy) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // polling enquanto builda
  useEffect(() => {
    if (!deploy || !["queued", "building"].includes(deploy.status)) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploy?.status]);

  const act = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/projects/${teamId}/deploy`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? "{}" : null,
    });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "erro");
    await refresh();
    setBusy(false);
  };

  if (!deploy && !canDeploy) return null;
  if (!deploy && !hasRepo)
    return (
      <span className="font-mono text-[10px] text-muted">
        {"// sem repo pra deployar"}
      </span>
    );

  const live = deploy?.status === "running";
  const liveUrl = live ? `/demo/${deploy.id}/` : url;

  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[10px]">
      {liveUrl && (
        <a
          href={liveUrl}
          className="border border-accent/50 bg-accent/10 px-2 py-1 text-accent transition hover:bg-accent/20"
        >
          ● demo ao vivo →
        </a>
      )}
      {deploy && !live && (
        <span className="border border-line px-2 py-1 text-muted">
          demo: {LABEL[deploy.status]}
          {deploy.status === "failed" && deploy.error
            ? ` — ${deploy.error.slice(0, 60)}`
            : ""}
        </span>
      )}
      {canDeploy && !live && (
        <button
          onClick={() => act("POST")}
          disabled={busy}
          className="border border-line px-2 py-1 transition hover:border-accent/50 hover:text-accent disabled:opacity-40"
        >
          {deploy ? "re-deploy" : "publicar demo"}
        </button>
      )}
      {canDeploy && ["queued", "building", "running"].includes(deploy?.status ?? "") && (
        <button
          onClick={() => act("DELETE")}
          disabled={busy}
          className="border border-line px-2 py-1 text-muted transition hover:border-red-500/50 hover:text-red-400 disabled:opacity-40"
        >
          parar
        </button>
      )}
      {err && <span className="text-red-400">{err}</span>}
    </div>
  );
}
