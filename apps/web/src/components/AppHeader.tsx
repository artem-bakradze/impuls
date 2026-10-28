"use client";

import { Button } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/summary", label: "Сводка" },
  { href: "/history", label: "История" },
  { href: "/experiments", label: "Проверяем" },
  { href: "/settings", label: "Настройки" },
];

export function AppHeader({ launched, signOutAction }: { launched: boolean; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <span className="app-brand">Импульс</span>
        {launched ? (
          <nav className="app-nav" aria-label="Разделы">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <form action={signOutAction}>
          <Button htmlType="submit" type="text">
            Выйти
          </Button>
        </form>
      </div>
    </header>
  );
}
