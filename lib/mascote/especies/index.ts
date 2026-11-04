import type { Especie, EspecieDef } from "@/lib/mascote/tipos";
import cracha from "@/lib/mascote/especies/cracha";
import teclado from "@/lib/mascote/especies/teclado";
import pizza from "@/lib/mascote/especies/pizza";
import servidor from "@/lib/mascote/especies/servidor";
import patinho from "@/lib/mascote/especies/patinho";
import mouse from "@/lib/mascote/especies/mouse";
import cafe from "@/lib/mascote/especies/cafe";
import foguete from "@/lib/mascote/especies/foguete";

// Espécies são dado: o motor (lib/mascote/voxel.ts) só interpreta. Arte
// nova = arquivo novo aqui + o id em ESPECIES (tipos.ts). Mexeu na arte de
// uma espécie que já existe? Suba ARTE_VERSAO em lib/mascote/isometrico.ts
// pra furar o cache imutável do SVG.
export const ESPECIE_DEFS: Record<Especie, EspecieDef> = { cracha, teclado, pizza, servidor, patinho, mouse, cafe, foguete };
