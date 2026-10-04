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
    href: "/perps",
    label: "Perps",
    icon: <path d="M7 4v16M4 8h6v8H4zM17 4v16M14 6h6v6h-6z" />,
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: <path d="M4 7h16v12H4zM8 7V5h8v2M4 12h16" />,
  },
  {
    href: "/stats",
    label: "Stats",
    icon: <path d="M5 20V11M12 20V5M19 20v-7M3 20h18" />,
  },
  {
    href: "/lab",
    label: "Lab",
    icon: <path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M7.5 14h9" />,
  },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <ul className="pointer-events-auto mx-auto flex max-w-md gap-1 rounded-[1.75rem] border border-line bg-surface/75 p-1.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.55)] backdrop-blur-xl backdrop-saturate-150">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`flex flex-col items-center gap-0.5 rounded-[1.25rem] py-2 text-[11px] font-medium transition-colors ${
                  active ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[22px] w-[22px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.1 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
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
