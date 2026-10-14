import Link from "next/link";
import { NewsletterForm } from "@/components/NewsletterForm";
import { CollectibleCard } from "@/components/CollectibleCard";
import { getCardRarity, getCardSupply } from "@/lib/xp";
import { getOpenHackathons, getPastHackathons } from "@/lib/hackathons";
import { listMembers } from "@/lib/members";
import { getStatsMomentum } from "@/lib/momentum";
import { listPosts } from "@/lib/posts";

// as portas da plataforma — o "mapa do site" no estilo Hack Inova
const portas = [
  {
    k: "01",
    title: "Edições Hack Inova",
    desc: "Cada edição ganha página própria com inscrição em 1 clique. Nada de site novo, nada de Google Forms.",
    foot: "inscrição · times · arquivo",
    href: "/radar",
  },
  {
    k: "02",
    title: "Radar",
    desc: "Hackathons abertos no Brasil e no mundo, raspados das fontes oficiais: Devpost, TAIKAI, MLH, ETHGlobal.",
    foot: "atualizado todo dia",
    href: "/radar",
  },
  {
    k: "03",
    title: "Projetos",
    desc: "O que os times entregaram: repo, demo, slides e colocação. O projeto não morre na premiação.",
    foot: "vitrine · portfólio",
    href: "/projetos",
  },
  {
    k: "04",
    title: "Feed",
    desc: "Demos, bastidores e pedidos de time. Quem constrói posta, quem acompanha descobre.",
    foot: "posts · comentários",
    href: "/feed",
  },
  {
    k: "05",
    title: "Membros",
    desc: "Perfil público com nível, badges, skills e histórico de edições. Teu currículo de hackathon.",
    foot: "ranking · perfis",
    href: "/membros",
  },
] as const;

// jornada do organizador — só o que já roda na plataforma hoje
const jornada = [
  {
    step: "01 · ANÚNCIO",
    title: "Página da edição",
    desc: "Data, local, desafios, prêmio e contagem regressiva num link só.",
  },
  {
    step: "02 · INSCRIÇÃO",
    title: "1 clique, sem Forms",
    desc: "Quem tem perfil se inscreve na hora. Edição curada? Fila de aprovação.",
  },
  {
    step: "03 · EVENTO",
    title: "Times e projetos",
    desc: "Procuro-time, cadastro de time e submissão do projeto pelo próprio inscrito.",
  },
  {
    step: "04 · LEGADO",
    title: "Arquivo e carta",
    desc: "Campeões, repos e fotos ficam. Cada presença vira carta colecionável.",
  },
] as const;

const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit" });
const fmtMes = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const fmtLongo = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function mesCurto(d: Date) {
  return fmtMes.format(d).replace(".", "").toUpperCase();
}

// botão de janela (rodapé do .window) — pixel, tinta ou banda
const goInk =
  "pix mt-auto block border-[1.5px] border-line bg-foreground text-center text-[20px] leading-[1.5] text-band hover:bg-background hover:text-foreground";
const goBand =
  "pix mt-auto block border-[1.5px] border-band bg-band text-center text-[20px] leading-[1.5] text-foreground hover:bg-foreground hover:text-band";

function WindowBar({ title }: { title: string }) {
  return (
    <div className="tbar">
      <span className="title">{title}</span>
      <span className="dots" aria-hidden>
        <b />
        <b />
      </span>
    </div>
  );
}

export default async function Home() {
  const now = new Date();
  const upcoming = await getOpenHackathons(now);
  const sessoes = upcoming.filter((h) => h.partner);
  const arquivo = await getPastHackathons(now);
  const memberCount = (await listMembers(100)).length;
  const postCount = (await listPosts(100)).length;
  // "+N · 30d" (spec 027): só onde há timestamp real — "edições no arquivo"
  // não tem data de entrada, então nunca mostra momentum
  const momentum = await getStatsMomentum(now);

  const stats = [
    { n: memberCount, label: "membros", delta: momentum.members },
    { n: upcoming.length, label: "hackathons abertos", delta: momentum.events },
    { n: arquivo.length, label: "edições no arquivo", delta: 0 },
    { n: postCount, label: "posts no feed", delta: momentum.posts },
  ];
  // leque do hero: as edições de verdade (arquivo + próximas), até 3
  const heroCards = [...arquivo, ...sessoes].slice(0, 3);
  const heroMeta = await Promise.all(
    heroCards.map(async (h) => ({
      rarity: await getCardRarity(h.id),
      supply: await getCardSupply(h.id),
    })),
  );

  const proxima = sessoes[0];
  const proximaData = proxima ? new Date(proxima.startsAt) : null;
  const letreiro = [...upcoming, ...arquivo].map((h) => h.name).slice(0, 18);

  return (
    <div className="-mb-24 overflow-x-clip">
      {/* faixa de evento — a próxima edição sempre no topo */}
      {proxima && proximaData && (
        <Link href={`/h/${proxima.id}`} className="strip block hover:underline">
          <span className="mx-auto flex max-w-6xl flex-wrap justify-between gap-x-6 gap-y-0.5 px-4 py-1.5 sm:px-6">
            <span>
              PRÓXIMA EDIÇÃO · {fmtDia.format(proximaData)} {mesCurto(proximaData)} ·{" "}
              {proxima.name.toUpperCase()}
            </span>
            <span>INSCRIÇÃO AQUI, SEM FORMS ▸</span>
          </span>
        </Link>
      )}

      {/* hero */}
      <div className="relative">
        <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
        <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.25fr_1fr]">
          <div className="min-w-0">
            <p className="tag">HACKAHUB · HACK INOVA</p>
            <h1 className="mt-6 text-[clamp(2.6rem,8.4vw,6.3rem)] leading-[0.9] font-extrabold tracking-[-0.045em]">
              Hackathon sem Forms
              <br />
              <span className="text-accent">e sem grupo de zap.</span>
            </h1>
            <p className="mt-7 max-w-[54ch] text-[clamp(1rem,1.5vw,1.2rem)] leading-relaxed text-[#1e1e1e]">
              <strong className="font-bold">A plataforma da Hack Inova.</strong>{" "}
              Cada edição ganha página própria, inscrição em 1 clique, times,
              projetos e arquivo. Quem participa sai com perfil, portfólio e a
              carta da edição.
            </p>
            <div className="mt-9 flex flex-wrap gap-x-10 gap-y-4 text-[clamp(1.25rem,3vw,2rem)]">
              <Link
                href={proxima ? `/h/${proxima.id}` : "/radar"}
                className="cta-link go"
              >
                {proxima ? "Próxima edição ↗" : "Ver edições ↗"}
              </Link>
              <Link href="/radar" className="cta-link">
                Explorar o radar
              </Link>
            </div>
            <div className="mt-8 inline-flex max-w-full items-center gap-2.5 border-[1.5px] border-line py-1.5 pr-3 pl-2 text-[13px] font-medium">
              <b className="pix shrink-0 border-[1.5px] border-line bg-band px-1.5 text-[16px] leading-[1.35] font-normal">
                AO VIVO
              </b>
              <span>{upcoming.length}{" "}
                {upcoming.length === 1 ? "hackathon" : "hackathons"} com inscrição aberta no radar.</span>
            </div>
          </div>

          {/* leque de cartas — arte real gerada por edição, raridade real */}
          <div className="relative hidden h-[440px] lg:block" aria-hidden>
            {heroCards.map((h, i) => (
              <div
                key={h.id}
                className="absolute top-1/2 w-56"
                style={{
                  left: `${i * 30}%`,
                  transform: `translateY(-50%) rotate(${(i - 1) * 7}deg) translateY(${Math.abs(i - 1) * 16}px)`,
                  zIndex: i === 1 ? 3 : 1,
                }}
              >
                <CollectibleCard
                  hackathonId={h.id}
                  name={h.name}
                  startsAt={h.startsAt}
                  location={h.location}
                  rarity={heroMeta[i].rarity}
                  supply={heroMeta[i].supply}
                />
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* números que provam que vive */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <dl className="ink-grid grid-cols-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col px-4 py-4 sm:px-5">
              <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">
                {s.label}
              </dt>
              <dd className="pix mt-1 text-[clamp(2.6rem,6vw,3.6rem)] leading-[0.85]">
                {s.n}
              </dd>
              {s.delta > 0 && (
                <dd className="mt-2 self-start bg-mint px-1.5 font-mono text-[12px] text-accent">
                  {`+${s.delta} · 30d`}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </section>

      {/* a próxima edição como "data grande", igual ao site da Hack Inova */}
      {proxima && proximaData && (
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
          <p className="font-mono text-[13px] font-medium text-muted">
            [01] próxima edição
          </p>
          <h2 className="mt-4 text-[clamp(2.6rem,9vw,7rem)] leading-[0.88] font-black tracking-[-0.045em]">
            {fmtDia.format(proximaData)} {mesCurto(proximaData)}.
            <br />
            <span className="text-accent">{proxima.location ?? "Online"}.</span>
          </h2>
          <p className="mt-5 font-mono text-[13px] font-medium">
            *{fmtLongo.format(proximaData)} · {proxima.name} · {proxima.organizer}{" "}
            —{" "}
            <Link
              href={`/h/${proxima.id}`}
              className="text-accent underline underline-offset-4"
            >
              (ver edição)
            </Link>
          </p>
        </section>
      )}

      {/* mesa: janelas com o estado da plataforma */}
      <section className="desk" aria-label="Mesa da comunidade">
        <div className="mx-auto grid max-w-[1360px] gap-4 px-4 pt-5 pb-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-16">
          <p className="tag justify-self-start sm:col-span-2 lg:col-span-4">
            HACKAHUB.OS — MESA DA COMUNIDADE
          </p>

          <div className="window hard">
            <WindowBar title="EDICAO.cal" />
            {proxima && proximaData ? (
              <div className="tbody">
                <div className="pix text-[50px] leading-[0.8]">
                  {fmtDia.format(proximaData)}.{mesCurto(proximaData)}
                </div>
                <p className="mt-2 mb-2.5 text-[13.5px] leading-snug">
                  <strong className="font-bold">{proxima.name}</strong>
                  <br />
                  {proxima.location ?? "online"} · {proxima.format}
                </p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {proxima.tags.slice(0, 3).map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </div>
                <Link href={`/h/${proxima.id}`} className={goInk}>
                  VER EDIÇÃO
                </Link>
              </div>
            ) : (
              <div className="tbody">
                <div className="pix text-[50px] leading-[0.8]">EM BREVE</div>
                <p className="mt-2 mb-3 text-[13.5px]">
                  A próxima edição da Hack Inova abre inscrição aqui.
                </p>
              </div>
            )}
          </div>

          <div className="window dark hard">
            <WindowBar title="INSCRICAO.exe" />
            <div className="tbody">
              <div className="text-[11px]">SEM GOOGLE FORMS</div>
              <div className="pix text-[50px] leading-[0.8]">1 CLIQUE</div>
              <p className="mt-2 mb-3 text-[13.5px] leading-snug text-mint">
                Teu perfil é tua ficha. Inscreveu, ganhou a carta da edição e
                entrou na lista do organizador.
              </p>
              <Link href="/dashboard" className={goBand}>
                CRIAR PERFIL
              </Link>
            </div>
          </div>

          <div className="window hard">
            <WindowBar title="RADAR.live" />
            <div className="tbody">
              <div className="pix text-[50px] leading-[0.8]">{upcoming.length}</div>
              <p className="mt-2 mb-2.5 text-[13.5px] leading-snug">
                hackathons com inscrição aberta, do Brasil e do mundo, numa
                lista só.
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                <span className="chip">devpost</span>
                <span className="chip">taikai</span>
                <span className="chip">mlh</span>
              </div>
              <Link href="/radar" className={goInk}>
                ABRIR RADAR
              </Link>
            </div>
          </div>

          <div className="window dark hard">
            <WindowBar title="COMUNIDADE.db" />
            <div className="tbody">
              <div className="text-[11px]">QUEM CONSTRÓI</div>
              <div className="pix text-[50px] leading-[0.8]">{memberCount}</div>
              <p className="mt-2 mb-3 text-[13.5px] leading-snug text-mint">
                membros com perfil público, nível e histórico de edições.
              </p>
              <Link href="/membros" className={goBand}>
                VER MEMBROS
              </Link>
            </div>
          </div>

          {arquivo.length > 0 && (
            <div className="window paper hard sm:col-span-2 lg:col-span-4">
              <WindowBar title="ARQUIVO.zip — edições encerradas" />
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3">
                {arquivo.slice(0, 6).map((h) => (
                  <li key={h.id} className="border-b border-line-soft">
                    <Link
                      href={`/h/${h.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-mint"
                    >
                      <span className="pix shrink-0 bg-foreground px-1.5 text-[18px] text-band">
                        {mesCurto(new Date(h.startsAt))}
                      </span>
                      <span className="min-w-0 truncate font-sans text-[14px] font-semibold">
                        {h.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* a rede: as portas de entrada */}
      <section className="mx-auto max-w-6xl px-4 pt-20 sm:px-6">
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <h2 className="max-w-[16ch] text-[clamp(2rem,4.5vw,3.25rem)] leading-none font-extrabold tracking-[-0.04em]">
            Um perfil, todos os hackathons.
          </h2>
          <p className="max-w-[44ch] text-[16px] text-muted">
            A rede nasce de quem já está aqui porque precisou se inscrever.
            Cada porta resolve uma coisa.
          </p>
        </div>
        <div className="ink-grid sm:grid-cols-2 lg:grid-cols-3">
          {portas.map((p) => (
            <Link
              key={p.k}
              href={p.href}
              className="flex min-h-[200px] flex-col gap-2 p-5 transition-colors hover:bg-mint!"
            >
              <span className="tag self-start">{p.k}</span>
              <h3 className="mt-1 text-[1.4rem] font-extrabold tracking-[-0.02em]">
                {p.title} <span className="text-accent">→</span>
              </h3>
              <p className="text-[15px] leading-normal text-[#1e1e1e]">{p.desc}</p>
              <span className="mt-auto font-mono text-[12.5px] text-muted">
                {p.foot}
              </span>
            </Link>
          ))}
          {/* porta comercial — participante nunca paga; quem paga é a marca */}
          <Link
            href="/empresas"
            className="flex min-h-[200px] flex-col gap-2 bg-foreground! p-5 text-background transition-colors hover:bg-[#1c1c1c]!"
          >
            <span className="tag self-start bg-band! text-foreground!">06</span>
            <h3 className="mt-1 text-[1.4rem] font-extrabold tracking-[-0.02em]">
              Pra marcas <span className="text-band">→</span>
            </h3>
            <p className="text-[15px] leading-normal text-mint">
              Sua marca lança um desafio patrocinado numa edição e conhece quem
              entregou.
            </p>
            <span className="mt-auto font-mono text-[12.5px] text-[#b8cdc0]">
              desafio · sponsorship · talento
            </span>
          </Link>
        </div>
      </section>

      {/* jornada do organizador — faixa escura */}
      <section className="mt-20 bg-foreground py-12 text-background">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <h2 className="max-w-[24ch] text-[28px] leading-tight font-extrabold tracking-[-0.03em]">
              Do anúncio ao arquivo, a edição inteira num lugar só.
            </h2>
            <p className="max-w-[40ch] text-[14px] text-[#b8cdc0]">
              Em construção: formulário próprio da edição, avisos por e-mail e
              zap, check-in por QR e júri com rubrica.
            </p>
          </div>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {jornada.map((j) => (
              <li key={j.step} className="border-t border-[#5e7869] pt-4">
                <span className="font-mono text-[12px] font-medium text-[#b8cdc0]">
                  {j.step}
                </span>
                <h3 className="mt-2 mb-1 text-[19px] font-bold">{j.title}</h3>
                <p className="text-[13.5px] leading-snug text-[#b8cdc0]">{j.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* letreiro de prova — nomes reais das edições e do radar */}
      {letreiro.length > 0 && (
        <div className="proof border-t-0!" aria-hidden>
          <div className="track">
            {[...letreiro, ...letreiro].map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>
        </div>
      )}

      {/* newsletter */}
      <section className="bg-mint">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.1fr] md:items-end">
          <div>
            <p className="tag">NEWSLETTER</p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold tracking-[-0.04em]">
              Toda semana, o que tá aberto.
            </h2>
            <p className="mt-3 max-w-[46ch] text-[15px] text-[#2b2b2b]">
              Hackathons abertos, deadlines e o que tá em alta no cenário.
              Curadoria de quem vive isso. Sem spam.
            </p>
          </div>
          <NewsletterForm />
        </div>
      </section>
    </div>
  );
}
