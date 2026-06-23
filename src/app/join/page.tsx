import { createAdminClient } from "@/lib/supabase/admin";
import JoinForm from "./JoinForm";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const token = (Array.isArray(sp.token) ? sp.token[0] : sp.token) ?? "";

  if (!token) {
    return <InvalidPage message="No invitation token provided." />;
  }

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invitations")
    .select("email, status, expires_at, roles(name)")
    .eq("token", token)
    .maybeSingle();

  if (!inv) return <InvalidPage message="Invitation not found." />;
  if (inv.status === "accepted") return <InvalidPage message="This invitation has already been used. Please sign in." />;
  if (inv.status === "cancelled") return <InvalidPage message="This invitation has been cancelled." />;
  if (new Date((inv as { expires_at: string }).expires_at) < new Date()) {
    return <InvalidPage message="This invitation has expired. Ask your admin to send a new one." />;
  }

  const rolesRaw = (inv as { roles?: { name: string } | { name: string }[] | null }).roles;
  const roleObj = Array.isArray(rolesRaw) ? rolesRaw[0] : rolesRaw;
  const roleName = (roleObj as { name: string } | null | undefined)?.name ?? "team member";

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-bold text-brand">You&apos;re invited!</h1>
        <p className="mb-6 mt-1 text-center text-sm text-slate-500">
          Set up your account to join as a <span className="font-medium text-slate-700">{roleName}</span>.
        </p>
        <JoinForm token={token} email={(inv as { email: string }).email} />
      </div>
    </div>
  );
}

function InvalidPage({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
        <h1 className="text-xl font-bold text-slate-800 mb-2">Invalid Invitation</h1>
        <p className="text-sm text-slate-500">{message}</p>
        <a
          href="/login"
          className="mt-6 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Sign in
        </a>
      </div>
    </div>
  );
}
