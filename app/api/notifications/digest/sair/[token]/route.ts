import { stopDigest, verifyDigestToken } from "@/lib/digest";
import { escHtml, subscribePage } from "@/lib/subscribePage";

// "Parar de receber" do resumo semanal (link assinado, sem login). O GET só
// mostra o botão: leitor de e-mail e antivírus abrem os links sozinhos, e um
// GET que desliga tiraria gente do resumo sem querer (mesmo motivo do
// /api/subscribe/unsubscribe). O POST desliga e também atende o "cancelar
// inscrição" de um clique do Gmail, que manda POST pro List-Unsubscribe.
// Token que não confere: 404.

type Ctx = { params: Promise<{ token: string }> };

const invalid = () =>
  subscribePage("Link inválido", "Esse link não confere. O resumo dá pra ajustar nas preferências de notificação.", "", 404);

export async function GET(_req: Request, { params }: Ctx) {
  const token = (await params).token;
  if (verifyDigestToken(token) === null) return invalid();
  const form = `<form method="post" action="/api/notifications/digest/sair/${encodeURIComponent(escHtml(token))}"><button type="submit">parar de receber</button></form>`;
  return subscribePage(
    "Parar o resumo semanal",
    "Confirme abaixo e o e-mail de segunda para de chegar. Os avisos da sua inscrição continuam.",
    form,
  );
}

export async function POST(_req: Request, { params }: Ctx) {
  const id = verifyDigestToken((await params).token);
  if (id === null || !(await stopDigest(id))) return invalid();
  return subscribePage(
    "Pronto, o resumo parou",
    "O e-mail de segunda não chega mais. Pra religar, abra as preferências de notificação no HackaHub.",
  );
}
