"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRole } from "@/components/RoleProvider";
import { useBranding } from "@/components/branding/BrandingProvider";
import type { ModuleKey } from "@/lib/branding";

// `key` ties each item to its branding label + visibility flag.
const ACTIVE: { href: string; key: ModuleKey }[] = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/leads", key: "leads" },
  { href: "/contacts", key: "contacts" },
  { href: "/accounts", key: "accounts" },
  { href: "/deals", key: "deals" },
  { href: "/products", key: "products" },
  { href: "/quotations", key: "quotations" },
  { href: "/email", key: "email" },
  { href: "/whatsapp", key: "whatsapp" },
  { href: "/tasks", key: "tasks" },
  { href: "/calendar", key: "calendar" },
  { href: "/reports", key: "reports" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const role = useRole();
  const { brandName, logoUrl, labels, visibility } = useBranding();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex h-14 items-center px-5">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={brandName ?? "Logo"}
            className="max-h-8 max-w-[160px] object-contain"
          />
        ) : (
          <span className="truncate text-lg font-bold text-brand">
            {brandName ?? "CRM"}
          </span>
        )}
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {ACTIVE.filter((item) => visibility[item.key]).map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                active ? "bg-brand-50 text-brand" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {labels[item.key]}
            </Link>
          );
        })}

        {role === "Admin" && (
          <>
            <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Admin
            </div>
            <Link
              href="/import"
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                pathname.startsWith("/import")
                  ? "bg-brand-50 text-brand"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Data Import
            </Link>
            <Link
              href="/settings"
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                pathname.startsWith("/settings")
                  ? "bg-brand-50 text-brand"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Settings
            </Link>
          </>
        )}
      </nav>
    </aside>
  );
}
