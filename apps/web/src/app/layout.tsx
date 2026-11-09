import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import "./globals.css";
import "./workspace.css";

export const dynamic = "force-dynamic";

/** Onest is drawn for Cyrillic first; its even figures keep the money and the counts calm in columns. */
const onest = Onest({ subsets: ["cyrillic", "latin"], variable: "--font-onest", display: "swap" });

export const metadata: Metadata = {
  title: "Импульс — реклама для вашего бизнеса",
  description: "Сервис сам запускает и ведёт рекламу в Яндексе",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f2f3f5" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={onest.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
