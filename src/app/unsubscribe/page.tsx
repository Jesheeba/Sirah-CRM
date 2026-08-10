import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Unsubscribe — Sirah CRM",
};

interface Props {
  searchParams: Promise<{ t?: string }>;
}

export default async function UnsubscribePage({ searchParams }: Props) {
  const { t } = await searchParams;

  let email: string | null = null;
  let attempted = false;

  if (t) {
    attempted = true;
    const admin = createAdminClient();
    const { data } = await admin.rpc("fn_email_unsubscribe", { p_token: t });
    email = (data as string | null) ?? null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-md text-center">
        <h1 className="mb-4 text-2xl font-bold text-slate-900">Email Preferences</h1>

        {!attempted && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6">
            <p className="text-yellow-800">No unsubscribe link token provided.</p>
          </div>
        )}

        {attempted && !email && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <p className="text-red-800">This link is invalid or has expired.</p>
          </div>
        )}

        {attempted && email && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-6">
            <div className="mb-3 text-4xl text-green-600">✓</div>
            <p className="mb-2 font-semibold text-green-800">You&apos;ve been unsubscribed</p>
            <p className="text-sm text-green-700">
              <code className="font-mono">{email}</code> will no longer receive marketing emails
              from us.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
