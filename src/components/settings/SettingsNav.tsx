"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings/branding", label: "Branding" },
  { href: "/settings/organization", label: "Organization" },
  { href: "/settings/users", label: "Users & Roles" },
  { href: "/settings/pipelines", label: "Pipelines" },
  { href: "/settings/custom-fields", label: "Custom Fields" },
  { href: "/settings/workflows", label: "Workflows" },
  { href: "/settings/integrations", label: "Integrations" },
];

export default function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5">
      {ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              active
                ? "bg-brand text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
