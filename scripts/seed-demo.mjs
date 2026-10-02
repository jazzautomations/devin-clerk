// Seed de comunidade pra desenvolvimento/demo — povoa o banco dev com
// membros, posts, arquivo e inscrições que parecem a comunidade de
// verdade (em vez do dump de fixtures e2e). Idempotente: INSERT OR IGNORE
// por username/team — pode rodar de novo sem duplicar.
//
// Uso: node scripts/seed-demo.mjs   (ou npm run seed:demo)
// SÓ pra banco de dev/demo — nunca apontar isso pra produção.
import Database from "better-sqlite3";
import { join } from "node:path";

const db = new Database(process.env.HACKAHUB_DB ?? join(process.cwd(), "data", "hackahub.db"));

// colunas que chegam por ALTER guardado nos libs — o seed pode rodar antes
// do server importar tudo, então garante aqui (mesmo pattern dos libs)
const has = (t, c) =>
  db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);
if (!has("members", "openTo")) db.exec("ALTER TABLE members ADD COLUMN openTo TEXT");
if (!has("members", "persona")) db.exec("ALTER TABLE members ADD COLUMN persona TEXT");
if (!has("members", "headline")) db.exec("ALTER TABLE members ADD COLUMN headline TEXT");
if (!has("members", "skills")) db.exec("ALTER TABLE members ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'");
if (!has("members", "bio")) db.exec("ALTER TABLE members ADD COLUMN bio TEXT");
if (!has("members", "xp")) db.exec("ALTER TABLE members ADD COLUMN xp INTEGER NOT NULL DEFAULT 0");
for (const c of ["videoUrl", "logoUrl"]) {
  if (!has("team_projects", c)) db.exec(`ALTER TABLE team_projects ADD COLUMN ${c} TEXT`);
}
if (!has("registrations", "status"))
  db.exec("ALTER TABLE registrations ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
if (!has("challenges", "sponsorId")) db.exec("ALTER TABLE challenges ADD COLUMN sponsorId TEXT");

const ALPHA = "hack-inova-alphaville-2026";
const UNI = "hack-inova-unifacens-2026";
const PUC = "hack-inova-puc-saude-2026";
const ANH = "hackinova-os-2-anhembi-2026";

// o admin real (conta Clerk do dono) — recriado pra getOrCreateMember
// achar por clerkId no próximo login e manter role=admin
const ADMIN = {
  clerkId: "user_3K7B5OSRc0CZB08bGHUPZjkr5zy",
  username: "jazzautomations",
  name: "Jazz Automations",
  email: "jazzautomations@gmail.com",
  role: "admin",
};

const members = [
  { u: "marina.builds", n: "Marina Duarte", p: "dev", xp: 420, h: "full-stack · react/node", b: "3x hackathons, saúde digital", open: "trampo", skills: ["react", "node", "postgres"] },
  { u: "jao.ml", n: "João Vitor Prado", p: "dev", xp: 510, h: "ml/llm · python", b: "NLP aplicado, ex-Visio", open: "cofundador", skills: ["python", "pytorch", "llm"] },
  { u: "vivi.found", n: "Vivian Costa", p: "empreendedor", xp: 460, h: "2x founder · healthtech", b: "vendi a primeira, construindo a segunda", open: "cofundador", skills: ["produto", "gtm", "saúde"] },
  { u: "tais.data", n: "Taís Lima", p: "dev", xp: 330, h: "data eng · ml ops", b: "pipelines que não quebram", open: "trampo", skills: ["python", "spark", "airflow"] },
  { u: "felipe.devops", n: "Felipe Arruda", p: "dev", xp: 290, h: "sre/devops", b: "docker, k8s, uptime", open: null, skills: ["docker", "linux", "ci"] },
  { u: "rafa.front", n: "Rafael Souza", p: "dev", xp: 210, h: "front · a11y", b: "interfaces rápidas e acessíveis", open: "freela", skills: ["react", "css", "a11y"] },
  { u: "luisa.ux", n: "Luísa Prado", p: "design", xp: 240, h: "product designer", b: "design systems, pesquisa", open: "freela", skills: ["figma", "ux research", "design system"] },
  { u: "prof.andre", n: "André Vieira", p: "prof", xp: 340, h: "prof. engenharia · mentor", b: "levo turmas pra hackathon desde 2019", open: "mentoria", skills: ["mentoria", "engenharia", "iot"] },
  { u: "bruno.pm", n: "Bruno Castilho", p: "negocios", xp: 150, h: "pm · fintech", b: "discovery e roadmap", open: null, skills: ["produto", "sql", "fintech"] },
  { u: "carol.bio", n: "Carolina Mota", p: "prof", xp: 120, h: "biomédica · saúde digital", b: "traduzo clínica pra produto", open: "mentoria", skills: ["saúde", "regulatório", "dados"] },
  { u: "caique.mobil", n: "Caique Ramos", p: "dev", xp: 380, h: "mobile · flutter/go", b: "apps que aguentam o tranco", open: null, skills: ["flutter", "go", "firebase"] },
  { u: "dra.fonseca", n: "Renata Fonseca", p: "prof", xp: 180, h: "médica · dados clínicos", b: "jornada do paciente é meu tema", open: "mentoria", skills: ["medicina", "dados", "protocolos"] },
  { u: "pedro.vc", n: "Pedro Albuquerque", p: "investidor", xp: 90, h: "pre-seed · saúde/fintech", b: "procuro times que shippam", open: null, skills: ["investimento", "dealflow"] },
  { u: "amanda.mkt", n: "Amanda Reis", p: "marca", xp: 75, h: "growth · comunidade tech", b: "employer branding e evento", open: null, skills: ["growth", "conteúdo", "eventos"] },
];

const insMember = db.prepare(
  `INSERT OR IGNORE INTO members (clerkId, username, name, email, role, persona, headline, bio, skills, xp, openTo)
   VALUES (@clerkId, @u, @n, @email, @role, @p, @h, @b, @skills, @xp, @open)`,
);
const insReg = db.prepare(
  `INSERT OR IGNORE INTO registrations (memberId, hackathonId, status, createdAt)
   VALUES (?, ?, 'approved', datetime('now', ?))`,
);
const insCard = db.prepare(
  `INSERT OR IGNORE INTO member_cards (memberId, hackathonId, serial, awardedAt)
   VALUES (?, ?, ?, datetime('now', ?))`,
);
const insBadge = db.prepare(
  `INSERT OR IGNORE INTO member_badges (memberId, badgeId, awardedAt) VALUES (?, ?, datetime('now', ?))`,
);
const insPost = db.prepare(
  `INSERT OR IGNORE INTO posts (memberId, body, link, hackathonId, createdAt)
   VALUES (?, ?, ?, ?, datetime('now', ?))`,
);
const insComment = db.prepare(
  `INSERT OR IGNORE INTO post_comments (postId, memberId, body, createdAt) VALUES (?, ?, ?, datetime('now', ?))`,
);
const insLike = db.prepare(
  `INSERT OR IGNORE INTO likes (postId, memberId) VALUES (?, ?)`,
);
const insLft = db.prepare(
  `INSERT OR IGNORE INTO looking_for_team (memberId, hackathonId, skills, need, note)
   VALUES (?, ?, ?, ?, ?)`,
);
const insTeam = db.prepare(
  `INSERT OR IGNORE INTO teams (hackathonId, name, placement) VALUES (?, ?, ?)`,
);
const insTm = db.prepare(
  `INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)`,
);
const insProj = db.prepare(
  `INSERT OR IGNORE INTO team_projects (teamId, title, description, repoUrl, demoUrl, videoUrl)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const insSponsor = db.prepare(
  `INSERT OR IGNORE INTO sponsors (id, name, url, tier) VALUES (?, ?, ?, ?)`,
);
const insVote = db.prepare(
  `INSERT OR IGNORE INTO votes (memberId, teamId) VALUES (?, ?)`,
);

const mid = (u) =>
  db.prepare("SELECT id FROM members WHERE username = ?").get(u)?.id;
const tid = (h, name) =>
  db.prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?").get(h, name)?.id;

db.transaction(() => {
  // admin real primeiro — mantém role=admin pela recriação via clerkId
  insMember.run({
    clerkId: ADMIN.clerkId, u: ADMIN.username, n: ADMIN.name,
    email: ADMIN.email, role: ADMIN.role, p: "organizador",
    h: "hack inova crew", b: "organização hackahub",
    skills: "[]", xp: 500, open: null,
  });

  for (const m of members) {
    insMember.run({
      clerkId: `demo_${m.u}`, u: m.u, n: m.n,
      email: `${m.u}@hackahub.dev`, role: "member", p: m.p,
      h: m.h, b: m.b, skills: JSON.stringify(m.skills), xp: m.xp, open: m.open,
    });
    insBadge.run(mid(m.u), "pioneiro", "-20 days");
  }
  insBadge.run(mid("jazzautomations"), "organizador", "-30 days");

  // inscrições aprovadas — alphaville é a próxima sessão
  const alphaRegs = ["marina.builds", "jao.ml", "vivi.found", "tais.data", "felipe.devops", "rafa.front", "luisa.ux", "caique.mobil", "bruno.pm", "jazzautomations"];
  alphaRegs.forEach((u, i) => {
    insReg.run(mid(u), ALPHA, `-${18 - i} days`);
    insCard.run(mid(u), ALPHA, i + 1, `-${18 - i} days`);
    insBadge.run(mid(u), "debut", `-${18 - i} days`);
  });

  // arquivo das edições passadas — times com membros reais do seed
  const archive = [
    [UNI, "VitaLink", 2, ["tais.data", "jao.ml"], { t: "VitaLink", d: "monitoramento de sinais vitais com alerta pra equipe de enfermagem", r: "https://github.com/hackahub/vitalink" }],
    [UNI, "PulsePay", 3, ["rafa.front", "bruno.pm"], { t: "PulsePay", d: "pagamento de plantão por biometria — sem fila no RH", r: "https://github.com/hackahub/pulsepay" }],
    [PUC, "Limiar", 1, ["vivi.found", "carol.bio", "felipe.devops"], { t: "Limiar", d: "triagem inteligente de PA — modelo de risco em 90s", r: "https://github.com/hackahub/limiar", v: "https://youtube.com/watch?v=limiar-pitch" }],
    [PUC, "Fila Zero", 2, ["marina.builds", "luisa.ux"], { t: "Fila Zero", d: "prevê evasão de consulta e reocupa o horário", r: "https://github.com/hackahub/filazero" }],
    [PUC, "Pronto.AI", 3, ["jao.ml", "caique.mobil"], { t: "Pronto.AI", d: "copiloto de anamnese pro plantonista", r: "https://github.com/hackahub/prontoai" }],
    [ANH, "Atlas Urbana", 1, ["amanda.mkt", "rafa.front", "prof.andre"], { t: "Atlas Urbana", d: "mapa vivo de oportunidade pro comércio de bairro", r: "https://github.com/hackahub/atlasurbana" }],
    [ANH, "Turno Certo", 2, ["felipe.devops", "tais.data"], { t: "Turno Certo", d: "escala de turno justa pra operação 24/7", r: "https://github.com/hackahub/turnocerto" }],
  ];
  for (const [h, team, place, us, proj] of archive) {
    insTeam.run(h, team, place);
    const id = tid(h, team);
    for (const u of us) insTm.run(id, u);
    insProj.run(id, proj.t, proj.d, proj.r, proj.demo ?? null, proj.v ?? null);
    for (const u of us) {
      insReg.run(mid(u), h, "-40 days");
      insBadge.run(mid(u), "debut", "-40 days");
    }
  }
  insBadge.run(mid("vivi.found"), "veterano", "-40 days");
  insBadge.run(mid("marina.builds"), "veterano", "-40 days");

  // mural + feed — conteúdo que parece a comunidade falando
  const posts = [
    ["jazzautomations", "radar atualizado: 70+ hackathons abertos no brasil e no mundo, raspado das fontes oficiais. faltou algum? // indica um hackathon na página do radar", null, null, "-2 days"],
    ["jazzautomations", "recap da unifacens saiu no blog — o one day hospital foi apresentado na oracle sp depois do evento. é isso que a plataforma existe pra guardar.", "/blog", null, "-4 days"],
    ["vivi.found", "fechamos o limiar em 36h na puc — triagem de PA com modelo de risco. procurando quem manja de regulatório pra levar adiante", null, null, "-12 days"],
    ["jao.ml", "testei o deploy tool com o pronto.ai: repo → url pública em menos de 2 min. a demo ficou viva pro pitch, não morreu no github", null, null, "-9 days"],
    ["luisa.ux", "designers: a trilha de ux nos hackathons de saúde tá subestimada. fila zero ganhou 2º basicamente na jornada", null, null, "-7 days"],
    ["prof.andre", "levando 3 turmas pro alphaville. quem quiser mentor de bancada durante o evento, me marca", null, null, "-3 days"],
    ["marina.builds", "mural — chegando de campinas pro alphaville, tem carona saindo sexta de manhã?", null, ALPHA, "-1 days"],
    ["tais.data", "alguém fecha time pra alphaville? tenho dados + ml, falta front e alguém de produto", null, ALPHA, "-20 hours"],
    ["pedro.vc", "vou no alphaville ver os pitches. times com demo viva sobem muito no meu caderno", null, ALPHA, "-6 hours"],
    ["bruno.pm", "desafio da edição é ia na saúde de novo ou abre escopo? montando backlog de ideias", null, ALPHA, "-2 hours"],
  ];
  for (const [u, body, link, h, at] of posts) insPost.run(mid(u), body, link, h, at);

  const pid = (bodyLike) =>
    db.prepare("SELECT id FROM posts WHERE body LIKE ?").get(`%${bodyLike}%`)?.id;
  const comments = [
    ["radar atualizado", "amanda.mkt", "manda o link do devpost que eu rodo curadoria semanal"],
    ["deploy tool", "felipe.devops", "container isolado com read-only — agora sim dá pra abrir demo pública sem medo"],
    ["deploy tool", "jazzautomations", "ttl de 72h + kill switch no admin. abuso a gente corta na hora"],
    ["fecha time", "rafa.front", "eu topo o front — te chamo no perfil"],
    ["desafio da edição", "jazzautomations", "ia na saúde confirmado, patrocínio fechando essa semana"],
    ["recap da unifacens", "caique.mobil", "o demo day na oracle foi absurdo. próxima edição eu to dentro"],
  ];
  for (const [key, u, body] of comments) insComment.run(pid(key), mid(u), body, "-5 hours");

  // likes espalhados — prova social leve
  const likePairs = [
    ["deploy tool", ["vivi.found", "marina.builds", "felipe.devops", "rafa.front"]],
    ["recap da unifacens", ["jao.ml", "tais.data", "prof.andre"]],
    ["fecha time", ["luisa.ux", "bruno.pm"]],
    ["radar atualizado", ["vivi.found", "amanda.mkt", "pedro.vc"]],
  ];
  for (const [key, us] of likePairs) for (const u of us) insLike.run(pid(key), mid(u));

  // procuro time
  insLft.run(mid("tais.data"), ALPHA, "python, ml, dados", "front + produto", "time quase fechado, falta quem desenhe a jornada");
  insLft.run(mid("bruno.pm"), ALPHA, "produto, pitch, sql", "devs", "ideia validada com 2 hospitais, falta quem construa");
  insLft.run(mid("caique.mobil"), ALPHA, "flutter, go", "ml", "app mobile pronto, preciso de modelo");

  // sponsors reais das edições + link nos challenges
  insSponsor.run("oracle", "Oracle", "https://www.oracle.com", "master");
  insSponsor.run("enterprise-x", "Enterprise X Ventures", "https://www.enterprisex.vc", "sponsor");
  db.prepare("UPDATE challenges SET sponsorId = 'oracle' WHERE sponsor LIKE 'Oracle%'").run();
  db.prepare("UPDATE challenges SET sponsorId = 'enterprise-x' WHERE sponsor LIKE '%Enterprise%'").run();

  // escolha do povo — alguns votos nos projetos do arquivo
  for (const [h, name] of [[UNI, "VitaLink"], [PUC, "Limiar"], [PUC, "Fila Zero"], [ANH, "Atlas Urbana"]]) {
    const id = tid(h, name);
    for (const u of ["marina.builds", "jao.ml", "rafa.front", "jazzautomations"]) insVote.run(mid(u), id);
  }
})();

console.log("seed ok:", {
  members: db.prepare("SELECT COUNT(*) n FROM members").get().n,
  posts: db.prepare("SELECT COUNT(*) n FROM posts").get().n,
  teams: db.prepare("SELECT COUNT(*) n FROM teams").get().n,
  regs: db.prepare("SELECT COUNT(*) n FROM registrations").get().n,
});
