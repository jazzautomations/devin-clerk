import { confirmSubscriber } from "@/lib/subscribers";
import { subscribePage } from "@/lib/subscribePage";

// Link de confirmação do e-mail da newsletter. Sem confirmar, nada é enviado.
export async function GET(req: Request) {
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
