import { SITE_URL } from "@/lib/seo";

// RFC 9116: onde reportar falha de segurança. Expires precisa ser renovado
// antes de vencer (está no runbook). O contato vem de
// HACKAHUB_SECURITY_CONTACT quando o endereço padrão não for o certo.

export function GET() {
  const body = [
    `Contact: ${process.env.HACKAHUB_SECURITY_CONTACT ?? "mailto:seguranca@jazzautomations.com.br"}`,
    "Expires: 2027-10-14T00:00:00.000Z",
    "Preferred-Languages: pt, en",
    `Canonical: ${SITE_URL}/.well-known/security.txt`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
