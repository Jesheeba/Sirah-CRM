import Link from "next/link";

export default function PlatformTopBar({ email }: { email: string }) {
  const initials = (email || "?").slice(0, 2).toUpperCase();
  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
      <span className="text-sm font-semibold text-slate-700">Platform Console</span>
      <div className="flex items-center gap-3">
        {/* Mobile fallback for the dark sidebar */}
        <Link href="/platform/tenants" className="text-sm text-slate-500 hover:underline md:hidden">
          Tenants
        </Link>
        <Link href="/dashboard" className="text-sm text-slate-500 hover:underline">
          Back to CRM
        </Link>
        <span className="hidden text-sm text-slate-500 sm:block">{email}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
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
