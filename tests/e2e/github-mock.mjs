// GitHub falso pro e2e do dossiê (migration 029). O playwright.config sobe
// este servidor e aponta HACKAHUB_GITHUB_API pra ele: o server do app nunca
// fala com api.github.com durante os testes. Datas relativas a "agora",
// porque a janela do evento no spec também é relativa.
//
//   e2e-dossie/reciclado → criado há 400 dias, 6 commits antigos + 1 hoje
//   e2e-dossie/limpo     → criado há 20 h, 5 commits dentro da janela
//   e2e-dossie/grande    → 400 commits (150 hoje, 250 de meses atrás), 4 páginas:
//                          o app lê 1, 2 e 4 e conta a 3 pelos vizinhos
//   e2e-dossie/limite    → 403 de rate limit
//   qualquer outro       → 404 (inexistente ou privado)
import http from "node:http";

const port = Number(process.argv[2] ?? 4100);
const H = 3_600_000;
const D = 24 * H;

function commit(i, ago, message) {
  const date = new Date(Date.now() - ago).toISOString().replace(/\.\d{3}Z$/, "Z");
  const sha = (i.toString(16).padStart(4, "0") + "ab".repeat(18)).slice(0, 40);
  return {
    sha,
    commit: { author: { name: `Autor ${i}`, date }, committer: { date }, message },
    author: { login: `dev${i}` },
  };
}

const REPOS = {
  "e2e-dossie/reciclado": {
    createdAgo: 400 * D,
    commits: [
      commit(7, 2 * H, "ajusta o readme pro evento"),
      ...[0, 1, 2, 3, 4, 5].map((k) => commit(k + 1, (290 + k) * D, `tcc: capítulo ${6 - k}`)),
    ],
  },
  "e2e-dossie/limpo": {
    createdAgo: 20 * H,
    commits: [1, 2, 4, 8, 16].map((h, k) => commit(100 + k, h * H, `passo ${5 - k}`)),
  },
  "e2e-dossie/grande": {
    createdAgo: 500 * D,
    commits: [
      ...Array.from({ length: 150 }, (_, k) => commit(1000 + k, H + k * 60_000, `evento ${150 - k}`)),
      ...Array.from({ length: 250 }, (_, k) => commit(2000 + k, 100 * D + k * H, `antigo ${250 - k}`)),
    ],
  },
};
const PER_PAGE = 100;

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/commits)?$/.exec(url.pathname);
    if (!m) return send(res, 404, { message: "Not Found" });
    const name = `${m[1]}/${m[2]}`;
    if (name === "e2e-dossie/limite") {
      const reset = Math.floor((Date.now() + H) / 1000);
      return send(res, 403, { message: "API rate limit exceeded" }, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(reset),
      });
    }
    const repo = REPOS[name];
    if (!repo) return send(res, 404, { message: "Not Found" });
    if (!m[3]) {
      const created = new Date(Date.now() - repo.createdAgo).toISOString();
      return send(res, 200, {
        full_name: name,
        private: false,
        visibility: "public",
        fork: false,
        default_branch: "main",
        created_at: created,
        pushed_at: new Date().toISOString(),
      });
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const last = Math.ceil(repo.commits.length / PER_PAGE);
    const link =
      last > 1 ? { link: `<http://127.0.0.1:${port}${url.pathname}?per_page=${PER_PAGE}&page=${last}>; rel="last"` } : {};
    return send(res, 200, repo.commits.slice((page - 1) * PER_PAGE, page * PER_PAGE), link);
  })
  .listen(port, "127.0.0.1", () => console.log(`github-mock em ${port}`));
