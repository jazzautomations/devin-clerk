// Página mínima que os links do e-mail da newsletter abrem (confirmar e
// sair). HTML próprio porque é resposta de rota de API, fora do layout.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function subscribePage(title: string, body: string, extra = "", status = 200): Response {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · HackaHub</title>
<style>
body{margin:0;background:#fefefe;color:#0c0c0c;font-family:Archivo,'Helvetica Neue',Arial,sans-serif}
main{max-width:34rem;margin:0 auto;padding:4rem 1rem}
h1{font-size:2rem;letter-spacing:-.03em;margin:0 0 1rem}
p{font-size:1rem;line-height:1.5;color:#474747}
a{color:#047a43;text-decoration:underline;text-underline-offset:4px}
button{min-height:44px;padding:.6rem 1.2rem;border:1.5px solid #0c0c0c;border-radius:6px;background:#0c0c0c;color:#fefefe;font:inherit;font-weight:700;cursor:pointer}
</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p>${extra}<p><a href="/">voltar pro HackaHub</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export { esc as escHtml };
