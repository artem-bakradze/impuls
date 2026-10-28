import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import { TestModeBanner } from "@/components/TestModeBanner";
import { isTestMode, webConfig } from "@/lib/server/config";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Импульс — реклама для вашего бизнеса",
  description: "Сервис сам запускает и ведёт рекламу в Яндексе",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>
          {isTestMode(webConfig()) ? <TestModeBanner /> : null}
          {children}
        </Providers>
      </body>
    </html>
  );
}
