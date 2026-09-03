"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Events" },
  { href: "/wall", label: "Ambient" },
  { href: "/map", label: "Map" }
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} data-active={pathname === t.href}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
