import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { RegisterServiceWorker } from "@/components/pwa";
import { Manrope } from "next/font/google";
import "./globals.css";

const sans = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "LeadFlow",
  description: "Поиск организаций, демо-сайты и работа с клиентами",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "LeadFlow", statusBarStyle: "default" },
  icons: { apple: "/pwa-icon?size=180" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0c1216" }, { color: "#0c1216" }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className={`${sans.variable} font-sans antialiased`}>{children}<RegisterServiceWorker /></body>
    </html>
  );
}
