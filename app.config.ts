export type Feature = {
  title: string;
  description: string;
};

export const appConfig = {
  name: "HackaHub",
  description:
    "A rede social dos hackathons no Brasil: devs, empreendedores, investidores, professores e marcas no mesmo feed. Um perfil, todas as competições — inscreva-se em 1 clique e descubra o que tá rolando no Brasil e no mundo.",
  emoji: "⚡",
  accent: "#a3e635",
  upcomingFeatures: [
    {
      title: "Deploy em 1 comando",
      description:
        "Suba o repo do teu time em container público direto da plataforma — sem mexer em nginx nem porta.",
    },
    {
      title: "Newsletter semanal",
      description:
        "Curadoria dos hackathons abertos, deadlines e o que tá em alta no cenário, direto no seu e-mail.",
    },
    {
      title: "Votação da comunidade",
      description:
        "Membros votam nas próximas features e formatos de evento que a plataforma deve ter.",
    },
    {
      title: "Desafios patrocinados",
      description:
        "Empresas postam desafios e vagas pra quem se destacou nos hackathons — modelo tipo Unstop/Devpost.",
    },
    {
      title: "Trilhas de preparação",
      description:
        "Conteúdo gratuito e pago focado em hackathon: MVP em 24h, pitch, IA sob pressão — nicho que Rocketseat/Alura não cobre.",
    },
  ] satisfies Feature[],
};
