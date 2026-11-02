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
  { href: "/settings", label: "Настройки", icon: <SettingOutlined /> },
];

/** Top bar on desktop; on phones the same links become a bottom tab bar (globals.css), so the header never wraps. */
/** Only a simulated business has the screen that explains its decisions (simulation-mode spec). */
const SIMULATION_LINK = { href: "/simulation", label: "Как решает сервис", icon: <ExperimentOutlined /> };

export function AppHeader({ launched, simulated = false, signOutAction }: { launched: boolean; simulated?: boolean; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const links = simulated ? [...LINKS.slice(0, 2), SIMULATION_LINK, ...LINKS.slice(2)] : LINKS;
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={launched ? "/summary" : "/wizard"} style={{ textDecoration: "none" }} aria-label="Импульс — на главную">
          <Logo />
        </Link>
        {launched ? (
          <nav className="app-nav" aria-label="Разделы">
            {links.map((link) => (
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
