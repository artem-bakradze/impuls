import type { Metadata, Viewport } from "next";
import { Golos_Text } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import "./globals.css";
import "./workspace.css";

export const dynamic = "force-dynamic";

/** Golos Text (ParaType) is drawn for Cyrillic first; variable weights keep headings tight and body calm. */
const golos = Golos_Text({ subsets: ["cyrillic", "latin"], variable: "--font-golos", display: "swap" });

export const metadata: Metadata = {
  title: "Импульс — реклама для вашего бизнеса",
  description: "Сервис сам запускает и ведёт рекламу в Яндексе",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f6f6f8" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={golos.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
