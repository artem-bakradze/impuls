import type { Metadata, Viewport } from "next";
import { Golos_Text } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import { TestModeBanner } from "@/components/TestModeBanner";
import { isTestMode, webConfig } from "@/lib/server/config";
import "./globals.css";

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
        <Providers>
          {isTestMode(webConfig()) ? <TestModeBanner /> : null}
          {children}
        </Providers>
      </body>
    </html>
  );
}
