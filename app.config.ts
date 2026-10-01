export type Feature = {
  title: string;
  description: string;
};

export const appConfig = {
  name: "HackaHub",
  description:
    "O hub brasileiro de hackathons: um perfil, todas as competições. Monte sua identidade de hacker, inscreva-se em 1 clique e descubra o que tá rolando no Brasil e no mundo.",
  emoji: "⚡",
  accent: "#7c3aed",
  upcomingFeatures: [
    {
      title: "Feed de hackathons",
      description:
        "Descubra os hackathons rolando no Brasil e no mundo numa lista curada, com datas, links e formato.",
    },
    {
      title: "Inscrição em 1 clique",
      description:
        "Use seu perfil pra se inscrever direto nos hackathons parceiros — sem preencher formulário novo toda vez.",
    },
    {
      title: "Perfil público do hacker",
      description:
        "Seu histórico de hackathons, skills e projetos numa página pra compartilhar com a comunidade.",
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
