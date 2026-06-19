"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBranding } from "@/components/branding/BrandingProvider";
import type { ModuleKey } from "@/lib/branding";

// `key` resolves the branding label + visibility; dashboard always shows as "Home".
const items: { href: string; key: ModuleKey; icon: string; fixedLabel?: string }[] = [
  { href: "/dashboard", key: "dashboard", icon: "🏠", fixedLabel: "Home" },
  { href: "/leads", key: "leads", icon: "👥" },
  { href: "/deals", key: "deals", icon: "📊" },
  { href: "/tasks", key: "tasks", icon: "✅" },
];

export default function MobileNav() {
  const pathname = usePathname();
  const { labels, visibility } = useBranding();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white md:hidden">
      {items
        .filter((i) => visibility[i.key])
        .map((i) => {
          const active = pathname.startsWith(i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${
                active ? "text-brand" : "text-slate-500"
              }`}
            >
              <span className="text-base leading-none">{i.icon}</span>
              {i.fixedLabel ?? labels[i.key]}
            </Link>
          );
        })}
    </nav>
  );
}
