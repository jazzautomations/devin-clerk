import Link from "next/link";
import type { Metadata } from "next";

// LGPD básica (spec 022) — texto honesto sobre o que a plataforma coleta de
// fato. Sem juridiquês: curto, direto e revisável pela operação.

export const metadata: Metadata = {
  title: "privacidade",
  description:
    "O que o hackahub coleta (perfil público, e-mail de newsletter e inscrições), por quê, e como pedir remoção — LGPD sem juridiquês.",
  alternates: { canonical: "/legal/privacidade" },
};

export default function PrivacidadePage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// legal"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          privacidade
        </h1>
        <p className="text-muted">
          O que a gente coleta, pra quê, e o que você pode pedir. Sem letra
          miúda: se algo aqui mudar, esta página muda junto.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          o que coletamos
        </h2>
        <ul className="flex list-none flex-col gap-2 text-sm leading-relaxed text-muted">
          <li>
            <span className="text-foreground">Perfil público</span> — quando
            você cria conta: nome de usuário, nome, bio, skills, links
            (GitHub/LinkedIn/site), avatar e headline. É o que aparece em
            `/u/[username]` e no diretório `/talento` se você marcar
            &quot;open to&quot;.
          </li>
          <li>
            <span className="text-foreground">E-mail</span> — usado pra login,
            inscrições em edições e newsletter (se você assinar). Não vendemos
            nem compartilhamos sua base.
          </li>
          <li>
            <span className="text-foreground">Atividade</span> — inscrições em
            hackathons, posts, comentários e likes que você faz no feed.
          </li>
          <li>
            <span className="text-foreground">Contato comercial</span> — se uma
            empresa envia o formulário em `/empresas`, guardamos empresa,
            e-mail, interesse e mensagem como lead pra organização responder.
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          cookies
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Só os necessários pra autenticação (Clerk) — sessão e segurança. Não
          usamos cookie de rastreio, ads ou analytics de terceiro.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          o que é público
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Perfil, posts, projetos de time e resultados de edições (pódio,
          arquivo) são públicos por desenho — é o propósito da plataforma. Seu
          e-mail nunca é exibido publicamente.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          seus direitos (LGPD)
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Você pode pedir acesso, correção ou remoção dos seus dados a qualquer
          momento — inclusive apagar a conta. Resultados de edições passadas
          (nome de time, pódio) são registro histórico do evento e podem
          permanecer mesmo com a remoção do perfil, sem vínculo com você.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs tracking-widest text-muted uppercase">
          contato
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Pra exercer esses direitos ou tirar dúvida, fala com a organização
          pelo formulário em{" "}
          <Link href="/empresas" className="text-accent hover:underline">
            /empresas
          </Link>{" "}
          ou direto nas sessões da comunidade.
        </p>
      </div>

      <p className="border-t border-line pt-6 font-mono text-[10px] text-muted">
        {"// última revisão: out/2026 · "}
        <Link href="/legal/termos" className="hover:text-accent">
          termos de uso →
        </Link>
      </p>
    </section>
  );
}
