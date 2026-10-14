// Cabeçalhos do proxy de demos (app/demo/[id]/[[...path]]/route.ts).
const HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
]);

// O código da demo é de terceiros e roda sob a origem do app: nada da
// sessão de quem visita chega no container, nada do container grava cookie
// no domínio do app, e a página roda em sandbox (origem opaca, sem acesso a
// /api com a sessão). Domínio separado continua obrigatório antes de ligar
// o deploy tool (lib/deploys.ts).
const DROP_REQUEST = new Set(["cookie", "authorization", "proxy-authorization"]);
export const DEMO_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals";

export function demoRequestHeaders(src: Headers): Headers {
  const headers = new Headers();
  for (const [k, v] of src) {
    if (HOP.has(k) || DROP_REQUEST.has(k) || k.startsWith("x-clerk-")) continue;
    headers.set(k, v);
  }
  return headers;
}

export function demoResponseHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((v, k) => {
    if (HOP.has(k) || k === "set-cookie" || k === "content-security-policy") return;
    out.set(k, v);
  });
  out.set("content-security-policy", DEMO_CSP);
  return out;
}

