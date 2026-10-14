"use client";

import { useEffect, useState } from "react";

export type DeployPanelDeploy = {
  id: string;
  status: "queued" | "building" | "running" | "failed" | "stopped" | "expired";
  error: string | null;
};

const LABEL: Record<DeployPanelDeploy["status"], string> = {
  queued: "na fila",
  building: "publicando…",
  running: "ao vivo",
  failed: "falhou",
  stopped: "parada",
  expired: "expirada",
};

/** painel do deploy tool — membro do time publica/para a demo do projeto.
 * Só renderiza pelo DeployPanel (servidor), que esconde tudo quando a
 * publicação de demos está desligada. */
export function DeployPanelClient({
  teamId,
  canDeploy,
  hasRepo,
  initialDeploy = null,
}: {
  teamId: number;
  canDeploy: boolean;
  hasRepo: boolean;
  initialDeploy?: DeployPanelDeploy | null;
}) {
  const [deploy, setDeploy] = useState<DeployPanelDeploy | null>(initialDeploy);
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
      <span className="font-mono text-[12px] text-muted">
        {"cadastre o repositório pra publicar a demo"}
      </span>
    );

  const live = deploy?.status === "running";
  const liveUrl = live ? `/demo/${deploy.id}/` : url;

  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
      {liveUrl && (
        <a
          href={liveUrl}
          className="border-[1.5px] border-accent bg-mint px-2 py-1 text-accent transition hover:bg-[#c3ebd5]"
        >
          ● demo ao vivo →
        </a>
      )}
      {deploy && !live && (
        <span className="border-[1.5px] border-line px-2 py-1 text-muted">
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
          className="border-[1.5px] border-line px-2 py-1 transition hover:border-line hover:text-accent disabled:opacity-40"
        >
          {deploy ? "publicar de novo" : "publicar demo"}
        </button>
      )}
      {canDeploy && ["queued", "building", "running"].includes(deploy?.status ?? "") && (
        <button
          onClick={() => act("DELETE")}
          disabled={busy}
          className="border-[1.5px] border-line px-2 py-1 text-muted transition hover:border-red-500/50 hover:text-orange disabled:opacity-40"
        >
          parar
        </button>
      )}
      {err && <span className="text-orange">{err}</span>}
    </div>
  );
}
