"use client";

import { LineChartOutlined, LogoutOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Modal, Tooltip } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "./ui/Logo";

type NavLink = { href: string; label: string; icon: ReactNode };

/** Two sections in both modes: a simulation is played on «Реклама» itself (simulation-mode spec). */
const ADS: NavLink = { href: "/summary", label: "Реклама", icon: <LineChartOutlined /> };
const SETTINGS: NavLink = { href: "/settings", label: "Настройки", icon: <SettingOutlined /> };

/** What a demo's owner is told before leaving it (auth spec «Демо-вход»): a demo lives only in this browser's session. */
export const DEMO_EXIT_WARNING = "Если выйти, вернуться в это демо не получится";

/**
 * Top bar on desktop; on phones the same links become a bottom tab bar (globals.css), so the header never wraps. In a
 * demo «Выйти» asks first: there is no other way back into it.
 */
export function AppHeader({ launched, demo, signOutAction }: { launched: boolean; demo: boolean; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const links = [ADS, SETTINGS];
  const [modal, modalHolder] = Modal.useModal();
  const confirmDemoExit = () =>
    void modal.confirm({
      title: "Выйти из демо?",
      content: `${DEMO_EXIT_WARNING}.`,
      okText: "Выйти",
      cancelText: "Остаться",
      onOk: () => signOutAction(),
    });
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={launched ? "/summary" : "/wizard"} style={{ textDecoration: "none" }} aria-label="Импульс — на главную">
          <Logo />
        </Link>
        {launched ? (
          <nav className="app-nav" aria-label="Разделы">
            {links.map((link) => (
              <Link key={link.href} href={link.href} aria-current={pathname.startsWith(link.href) || (link === ADS && pathname.startsWith("/history")) ? "page" : undefined}>
                <span className="nav-icon" aria-hidden="true">
                  {link.icon}
                </span>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
        {demo ? (
          <div className="app-header-end">
            {modalHolder}
            <Tooltip title="Выйти из демо">
              <Button type="text" icon={<LogoutOutlined aria-hidden="true" />} onClick={confirmDemoExit}>
                Выйти
              </Button>
            </Tooltip>
          </div>
        ) : (
          <form action={signOutAction} className="app-header-end">
            <Tooltip title="Выйти из аккаунта">
              <Button htmlType="submit" type="text" icon={<LogoutOutlined aria-hidden="true" />}>
                Выйти
              </Button>
            </Tooltip>
          </form>
        )}
      </div>
    </header>
  );
}
