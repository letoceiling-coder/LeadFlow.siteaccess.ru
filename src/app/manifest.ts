import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LeadFlow — охота",
    short_name: "LeadFlow",
    description: "Поиск клиентов: карточки, сообщения, follow-up и цифры",
    start_url: "/hunt",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f6f6",
    theme_color: "#0f766e",
    lang: "ru",
    icons: [
      { src: "/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon?size=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
