import { confirmSubscriber } from "@/lib/subscribers";
import { escHtml, subscribePage } from "@/lib/subscribePage";

// Link de confirmação do e-mail da newsletter. Sem confirmar, nada é enviado.
// O GET só mostra o botão: leitor de e-mail e antivírus abrem os links
// sozinhos, e um GET que confirmasse inscreveria gente sem a pessoa clicar.
// Quem grava a confirmação é o POST.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return subscribePage("Link inválido", "Esse link de confirmação está incompleto.", "", 400);
  const form = `<form method="post" action="/api/subscribe/confirm?token=${encodeURIComponent(escHtml(token))}"><button type="submit">confirmar inscrição</button></form>`;
  return subscribePage("Confirmar inscrição", "Clique abaixo pra receber a newsletter do HackaHub neste e-mail.", form);
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (await confirmSubscriber(token)) {
    return subscribePage("Inscrição confirmada", "Pronto. Você vai receber a newsletter do HackaHub neste e-mail.");
  }
  return subscribePage(
    "Link inválido",
    "Esse link não vale mais. Se você saiu da lista, assine de novo na página inicial.",
    "",
    404,
  );
}
