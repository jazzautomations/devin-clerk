// imagem de compartilhamento: cada crawler (WhatsApp, LinkedIn, X) que
// expande o link refazia satori + resvg + queries. 1 h no navegador e 1 dia
// em cache compartilhado é curto o bastante pra nome/data editados aparecerem.
export const OG_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
};
