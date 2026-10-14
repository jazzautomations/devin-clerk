import type { MetadataRoute } from "next";
import { appConfig } from "@/app.config";

// manifest + ícones que o navegador pede sozinho (atalho na tela inicial,
// aba). Sem eles, o pedido caía no layout e virava erro.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.name,
    short_name: appConfig.name,
    description: appConfig.description,
    lang: "pt-BR",
    start_url: "/",
    display: "browser",
    background_color: "#fefefe",
    theme_color: "#fefefe",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
