"use client";

import { ExperimentOutlined, HistoryOutlined, LineChartOutlined, LogoutOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "./ui/Logo";

const LINKS: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/summary", label: "Сводка", icon: <LineChartOutlined /> },
  { href: "/history", label: "История", icon: <HistoryOutlined /> },
  { href: "/experiments", label: "Эксперименты", icon: <ExperimentOutlined /> },
  { href: "/settings", label: "Настройки", icon: <SettingOutlined /> },
];

/** Top bar on desktop; on phones the same links become a bottom tab bar (globals.css), so the header never wraps. */
export function AppHeader({ launched, signOutAction }: { launched: boolean; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={launched ? "/summary" : "/wizard"} style={{ textDecoration: "none" }} aria-label="Импульс — на главную">
          <Logo />
        </Link>
        {launched ? (
          <nav className="app-nav" aria-label="Разделы">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} aria-current={pathname.startsWith(link.href) ? "page" : undefined}>
                <span className="nav-icon" aria-hidden="true">
                  {link.icon}
                </span>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <form action={signOutAction} className="app-header-end">
          <Tooltip title="Выйти из аккаунта">
            <Button htmlType="submit" type="text" icon={<LogoutOutlined aria-hidden="true" />}>
              Выйти
            </Button>
          </Tooltip>
        </form>
      </div>
    </header>
  );
}
