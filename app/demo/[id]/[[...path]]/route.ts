import { getDeploy, proxyTarget } from "@/lib/deploys";
import { DEMO_CSP, demoRequestHeaders, demoResponseHeaders } from "@/lib/demoProxy";

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

async function tombstone(id: string) {
  const d = await getDeploy(id);
  const repo = d?.repoUrl ?? "";
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="background:#0a0a0a;color:#eee;font-family:monospace;display:grid;place-items:center;min-height:100vh"><div>
      <p>// demo ${d?.status ?? "inexistente"}</p>
      ${repo ? `<p><a style="color:#38bdf8" href="${repo}">${repo}</a></p>` : ""}
      <p style="color:#888">demos expiram — o projeto continua no repo</p>
    </div>`,
    { status: 410, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": DEMO_CSP } },
  );
}

async function proxy(req: Request, ctx: Ctx) {
  const { id, path: parts } = await ctx.params;
  const port = await proxyTarget(id);
  if (!port) return tombstone(id);

  const url = new URL(req.url);
  const target = `http://127.0.0.1:${port}/${(parts ?? []).join("/")}${url.search}`;

  const headers = demoRequestHeaders(req.headers);
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

  const out = demoResponseHeaders(upstream.headers);
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
