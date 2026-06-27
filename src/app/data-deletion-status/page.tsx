import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Data Deletion Status — Sirah CRM",
};

interface Props {
  searchParams: Promise<{ id?: string }>;
}

export default async function DataDeletionStatusPage({ searchParams }: Props) {
  const { id } = await searchParams;

  let status: "completed" | "not_found" | "missing" = "missing";

  if (id) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("meta_deletion_requests")
      .select("status, completed_at")
      .eq("code", id)
      .maybeSingle();

    status = data ? "completed" : "not_found";
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">
          Data Deletion Request
        </h1>

        {status === "missing" && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <p className="text-yellow-800">
              No confirmation code provided. Please use the link sent to you by
              Meta after revoking app permissions.
            </p>
          </div>
        )}

        {status === "not_found" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <p className="text-red-800">
              Confirmation code <code className="font-mono text-sm">{id}</code>{" "}
              was not found. If you believe this is an error, contact us at{" "}
              <a
                href="mailto:sirahdigitalemp@gmail.com"
                className="underline"
              >
                sirahdigitalemp@gmail.com
              </a>
              .
            </p>
          </div>
        )}

        {status === "completed" && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <div className="text-green-600 text-4xl mb-3">✓</div>
            <p className="text-green-800 font-semibold mb-2">
              Deletion request confirmed
            </p>
            <p className="text-green-700 text-sm">
              Your Facebook data associated with Sirah CRM has been deleted or
              anonymised. Confirmation code:{" "}
              <code className="font-mono">{id}</code>
            </p>
          </div>
        )}

        <p className="mt-8 text-sm text-slate-500">
          Operated by{" "}
          <a href="https://sirahdigital.in" className="underline">
            Sirah Digital
          </a>
          . View our{" "}
          <a href="/privacy" className="underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
