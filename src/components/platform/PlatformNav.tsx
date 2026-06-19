"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/platform", label: "Dashboard", exact: true },
  { href: "/platform/tenants", label: "Tenants" },
  { href: "/platform/monitoring", label: "Monitoring" },
  { href: "/platform/settings", label: "Settings" },
  { href: "/platform/audit", label: "Audit logs" },
];

export default function PlatformNav() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 md:flex">
      <div className="flex h-14 items-center gap-2 px-5">
        <span className="text-lg font-bold text-white">Platform</span>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
          Admin
        </span>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                active ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-slate-800 p-3">
        <Link
          href="/dashboard"
          className="block rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        >
          ← Back to CRM
        </Link>
      </div>
    </aside>
  );
}
