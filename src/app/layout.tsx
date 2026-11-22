import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const sans = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "LeadFlow",
  description: "Поиск организаций, демо-сайты и работа с клиентами",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className={`${sans.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
