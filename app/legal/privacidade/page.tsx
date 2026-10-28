import Link from "next/link";
import type { Metadata } from "next";
import { PRIVACY_UPDATED, PRIVACY_VERSION, privacyEmail } from "@/lib/legal";

// LGPD (spec 022, revisada na auditoria 041). Texto honesto sobre o que a
// plataforma coleta e com quem divide. Controlador e encarregado entram
// quando o fundador definir (lista do fundador F8); até lá o canal é o
// HACKAHUB_PRIVACY_EMAIL, quando existir, e o autoatendimento do /perfil.

export const metadata: Metadata = {
  title: "privacidade",
  description:
    "O que o HackaHub coleta, pra quê, com quem divide, por quanto tempo guarda e como você pede acesso ou remoção.",
  alternates: { canonical: "/legal/privacidade" },
};

const h2 = "font-mono text-xs tracking-[0.06em] text-muted uppercase";
const body = "text-sm leading-relaxed text-muted";

/** quem trata dado em nome do HackaHub, e onde */
const OPERADORES: { nome: string; faz: string; onde: string }[] = [
  { nome: "Clerk", faz: "login e cadastro (nome, e-mail, foto)", onde: "Estados Unidos" },
  { nome: "Oracle Cloud", faz: "servidor e banco de dados do site", onde: "Estados Unidos (Chicago)" },
  { nome: "Oracle Object Storage", faz: "cópias de segurança do banco", onde: "Estados Unidos" },
  { nome: "Resend", faz: "envio de e-mail (ingresso, avisos, confirmação)", onde: "Estados Unidos" },
  {
    nome: "Evolution API, sobre o WhatsApp",
    faz: "avisos por WhatsApp, só pra quem marcou essa opção",
    onde: "WhatsApp (Meta), fora do Brasil",
  },
];

export default function PrivacidadePage() {
  const email = privacyEmail();
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 [&>*]:max-w-3xl">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"legal"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          Privacidade
        </h1>
        <p className="text-muted">
          O que a gente coleta, pra quê, com quem divide e o que você pode pedir.
          Se algo aqui mudar, esta página muda junto e a versão sobe.
        </p>
        <p className="font-mono text-[12px] text-muted" data-testid="privacy-version">
          versão {PRIVACY_VERSION} · {PRIVACY_UPDATED}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={h2}>o que coletamos</h2>
        <ul className={`flex list-none flex-col gap-2 ${body}`}>
          <li>
            <span className="text-foreground">Perfil público</span>: quando
            você cria conta, guardamos nome de usuário, nome, bio, skills, links
            (GitHub, LinkedIn, site), foto e título. É o que aparece em
            /u/seu-usuario e, se você se marcar como disponível para
            emprego, sociedade, freela ou mentoria, no diretório{" "}
            <Link href="/talento" className="link-inline">
              /talento
            </Link>
            .
          </li>
          <li>
            <span className="text-foreground">E-mail</span>: usado pro login,
            pras inscrições em edições e pra newsletter, se você assinar. A
            newsletter só sai depois que você confirma pelo link do e-mail, e
            todo envio traz o link pra sair.
          </li>
          <li>
            <span className="text-foreground">Telefone e WhatsApp</span>:
            opcionais. Só servem pra mandar os avisos das edições pelo WhatsApp,
            em mensagem individual, pra quem marcou essa opção no perfil. Dá pra
            desmarcar quando quiser.
          </li>
          <li>
            <span className="text-foreground">Atividade</span>: inscrições em
            hackathons, posts, comentários e curtidas que você faz no feed.
          </li>
          <li>
            <span className="text-foreground">Termos da inscrição numa edição</span>:
            data de nascimento (só pra checar a idade mínima; a organização vê a
            idade no dia do evento, não a data), nome e e-mail do responsável
            quando a edição aceita menor, versão do código de conduta aceita,
            restrição alimentar e alergias quando a edição pergunta, e o
            histórico de autorização e revogação do uso de imagem. Tudo isso é
            apagado se você cancelar a inscrição ou excluir a conta.
          </li>
          <li>
            <span className="text-foreground">Participação no evento</span>:
            check-in, avaliação do júri do seu time, voto do público, pesquisa
            de satisfação e certificados emitidos.
          </li>
          <li>
            <span className="text-foreground">Relatos de conduta</span>: relato
            anônimo não guarda nome nem IP. Se você excluir a conta, os relatos
            que fez ficam sem autor e sem o contato informado, mas não são
            apagados, porque podem envolver outras pessoas.
          </li>
          <li>
            <span className="text-foreground">Contato comercial</span>: se uma
            empresa envia o formulário em{" "}
            <Link href="/empresas" className="link-inline">
              /empresas
            </Link>
            , guardamos empresa, e-mail, interesse e mensagem pra organização
            responder.
          </li>
          <li data-testid="privacidade-apoio">
            <span className="text-foreground">Apoio a uma comunidade</span>: o
            formulário &quot;quero apoiar esta comunidade&quot;, na página de
            cada comunidade, manda empresa, e-mail, tipo de apoio e mensagem pro
            dono e pros organizadores daquela comunidade, que são pessoas de
            fora da equipe do HackaHub. Eles veem esses dados no painel da
            comunidade pra responder. Apagar a comunidade apaga os pedidos.
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3" id="patrocinador">
        <h2 className={h2}>contato com patrocinador</h2>
        <p className={body}>
          Não vendemos sua base. Um patrocinador só recebe seu nome, e-mail,
          LinkedIn, GitHub e projeto quando você autoriza na página dele, no
          estande da edição. Você vê o que vai antes de aceitar. Pra revogar,
          use a seção &quot;Contato com marcas&quot; do{" "}
          <Link href="/perfil#marcas" className="link-inline">
            seu perfil
          </Link>
          : seus dados saem do relatório da marca na hora.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={h2}>quem trata seus dados com a gente</h2>
        <p className={body}>
          Esses serviços guardam ou enviam dados em nome do HackaHub, só pra
          fazer o que está descrito ao lado:
        </p>
        <ul className={`flex list-none flex-col border-t border-line ${body}`} data-testid="operadores">
          {OPERADORES.map((o) => (
            <li key={o.nome} className="flex flex-col gap-0.5 border-b border-line py-2.5">
              <span className="font-semibold text-foreground">{o.nome}</span>
              <span>
                {o.faz} · {o.onde}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={h2}>dados fora do Brasil</h2>
        <p className={body}>
          O servidor, as cópias de segurança, o login e o envio de e-mail ficam
          nos Estados Unidos. A transferência acontece porque é onde esses
          serviços funcionam, e cada um trata o dado só pra finalidade acima.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={h2}>por quanto tempo guardamos</h2>
        <ul className={`flex list-none flex-col gap-2 ${body}`}>
          <li>Perfil e atividade: enquanto a conta existir.</li>
          <li>
            Termos da inscrição: até você cancelar a inscrição ou excluir a
            conta.
          </li>
          <li>Newsletter: até você sair pelo link de qualquer envio.</li>
          <li>
            Cópias de segurança: 14 dias no servidor e 60 dias no
            armazenamento externo. Depois disso, o que você apagou some também
            delas.
          </li>
          <li>
            Resultados de edições passadas (nome do time, pódio, notas) ficam
            como registro histórico do evento, sem vínculo com você depois que
            a conta é excluída.
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={h2}>cookies</h2>
        <p className={body}>
          Só os necessários pra autenticação (Clerk): sessão e segurança. Não
          usamos cookie de rastreio, de anúncio ou de análise de terceiro.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={h2}>o que é público</h2>
        <p className={body}>
          Perfil, posts, projetos de time e resultados de edições (pódio,
          arquivo) são públicos, porque esse é o propósito da plataforma. Seu
          e-mail e seu telefone nunca são exibidos. Ter inscrição numa edição
          não põe você na lista pública de inscritos: a página da edição mostra
          só o total, e seu @ aparece na lista apenas se você marcar essa opção
          (dá pra desmarcar quando quiser).
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={h2}>seus direitos (LGPD)</h2>
        <p className={body}>
          Você pode pedir acesso, correção ou remoção dos seus dados a qualquer
          momento, inclusive apagar a conta. No{" "}
          <Link href="/perfil" className="link-inline">
            seu perfil
          </Link>{" "}
          você baixa tudo o que o HackaHub guarda sobre você e exclui a conta
          sozinho, na hora.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={h2}>contato</h2>
        <p className={body} data-testid="privacy-contact">
          {email ? (
            <>
              Pra outros pedidos sobre seus dados, escreva para{" "}
              <a href={`mailto:${email}`} className="link-inline">
                {email}
              </a>
              .
            </>
          ) : (
            <>
              Pra outros pedidos sobre seus dados, fale com a organização pelo
              formulário em{" "}
              <Link href="/empresas#contato" className="link-inline">
                /empresas
              </Link>{" "}
              e escreva &quot;privacidade&quot; na mensagem.
            </>
          )}
        </p>
      </div>

      <p className="border-t border-line pt-6 font-mono text-[12px] text-muted">
        {`versão ${PRIVACY_VERSION} · ${PRIVACY_UPDATED} · `}
        <Link href="/legal/termos" className="link-inline">
          termos de uso
        </Link>
      </p>
    </section>
  );
}
