import { getDeploy, proxyTarget } from "@/lib/deploys";

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

const HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function tombstone(id: string) {
  const d = getDeploy(id);
  const repo = d?.repoUrl ?? "";
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="background:#0a0a0a;color:#eee;font-family:monospace;display:grid;place-items:center;min-height:100vh"><div>
      <p>// demo ${d?.status ?? "inexistente"}</p>
      ${repo ? `<p><a style="color:#38bdf8" href="${repo}">${repo}</a></p>` : ""}
      <p style="color:#888">demos expiram — o projeto continua no repo</p>
    </div>`,
    { status: 410, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function proxy(req: Request, ctx: Ctx) {
  const { id, path: parts } = await ctx.params;
  const port = proxyTarget(id);
  if (!port) return tombstone(id);

  const url = new URL(req.url);
  const target = `http://127.0.0.1:${port}/${(parts ?? []).join("/")}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of req.headers) if (!HOP.has(k)) headers.set(k, v);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-prefix", `/demo/${id}`);

  const init: RequestInit = { method: req.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(req.method))
    init.body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return tombstone(id);
  }

  const out = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!HOP.has(k)) out.set(k, v);
  });
  // redirects absolutos do container viram /demo/<id>/... de novo
  const loc = upstream.headers.get("location");
  if (loc?.startsWith("/")) out.set("location", `/demo/${id}${loc}`);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
