// pretest:e2e — zera o banco dedicado do e2e (data/e2e.db) antes do build,
// pra cada rodada começar só com o bootstrap seed. O servidor do e2e é
// `next start` (build+start, sem dev-mode) porque dois `next dev` no mesmo
// projeto compartilham estado e o segundo nasce com rotas quebradas.
import { rm } from "node:fs/promises";
import { join } from "node:path";

const dir = join(process.cwd(), "data");
for (const suffix of ["", "-shm", "-wal"]) {
  await rm(join(dir, `e2e.db${suffix}`), { force: true });
}
