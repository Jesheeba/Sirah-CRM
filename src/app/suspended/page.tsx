import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth";

export default async function SuspendedPage() {
  const ctx = await getUserContext();
  // If not actually suspended (or it was lifted), send them back into the app.
  if (!ctx) redirect("/login");
  if (ctx.tenantStatus !== "suspended" || ctx.isPlatformAdmin) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">
          ⏸
        </div>
        <h1 className="text-lg font-bold text-slate-800">Workspace suspended</h1>
        <p className="mt-2 text-sm text-slate-500">
          Access to <span className="font-medium text-slate-700">{ctx.tenantName}</span> is currently
          suspended. Please contact your administrator or our support team to restore access.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
