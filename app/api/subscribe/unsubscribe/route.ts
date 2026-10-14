import { unsubscribe } from "@/lib/subscribers";
import { escHtml, subscribePage } from "@/lib/subscribePage";

// Sair da newsletter. O GET só mostra o botão: leitor de e-mail e antivírus
// abrem os links sozinhos, e um GET que apaga tiraria gente da lista sem
// querer. O POST apaga (também atende o "cancelar inscrição" de um clique
// do Gmail, RFC 8058, que manda POST pra mesma URL).
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return subscribePage("Link inválido", "Esse link de saída está incompleto.", "", 400);
  const form = `<form method="post" action="/api/subscribe/unsubscribe?token=${encodeURIComponent(escHtml(token))}"><button type="submit">sair da newsletter</button></form>`;
  return subscribePage("Sair da newsletter", "Confirme abaixo e seu e-mail sai da lista na hora.", form);
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return subscribePage("Link inválido", "Esse link de saída está incompleto.", "", 400);
  await unsubscribe(token);
  // token desconhecido = já saiu antes; a resposta é a mesma
  return subscribePage("Você saiu da newsletter", "Seu e-mail foi apagado da lista. Nada mais vai ser enviado.");
}
