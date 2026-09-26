"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    href: "/",
    label: "Trade",
    icon: <path d="M4 17l5-5 4 4 7-8M15 8h5v5" />,
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: <path d="M4 7h16v12H4zM8 7V5h8v2M4 12h16" />,
  },
  {
    href: "/lab",
    label: "Sandwich lab",
    icon: <path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M7.5 14h9" />,
  },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs ${active ? "text-accent" : "text-muted"}`}
                aria-current={active ? "page" : undefined}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {t.icon}
                </svg>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
