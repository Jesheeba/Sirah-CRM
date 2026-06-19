/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import NotificationBell from "@/components/NotificationBell";
import type { Role } from "@/lib/auth";

export default function TopBar({
  email,
  orgName,
  logoUrl = null,
  role,
  isAdmin,
  isPlatformAdmin = false,
}: {
  email: string;
  orgName: string;
  logoUrl?: string | null;
  role: Role;
  isAdmin: boolean;
  isPlatformAdmin?: boolean;
}) {
  const initials = (email || "?").slice(0, 2).toUpperCase();

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-3">
        {logoUrl && (
          <img
            src={logoUrl}
            alt={orgName}
            className="max-h-7 max-w-[120px] object-contain"
          />
        )}
        <span className="text-sm font-semibold text-slate-700">{orgName}</span>
        <input
          placeholder="Search…"
          className="hidden w-64 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-brand sm:block"
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand sm:inline">
          {role}
        </span>
        {isPlatformAdmin && (
          <Link
            href="/platform"
            className="hidden rounded-lg border border-brand/30 bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand-50/70 sm:inline"
          >
            Platform
          </Link>
        )}
        <NotificationBell />
        {isAdmin && (
          <Link
            href="/settings/users"
            title="Settings"
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            ⚙
          </Link>
        )}
        <span className="hidden text-sm text-slate-500 sm:block">{email}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
          {initials}
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
