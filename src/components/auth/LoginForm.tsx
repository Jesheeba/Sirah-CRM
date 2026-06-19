"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export interface LoginFormProps {
  brandName: string | null;
  logoUrl: string | null;
  welcomeMessage: string | null;
  companyDescription: string | null;
}

export default function LoginForm({
  brandName,
  logoUrl,
  welcomeMessage,
  companyDescription,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={brandName ?? "Logo"}
            className="mx-auto max-h-12 max-w-[200px] object-contain"
          />
        ) : (
          <h1 className="text-2xl font-bold text-brand">{brandName ?? "CRM"}</h1>
        )}
        {welcomeMessage ? (
          <p className="mt-3 text-sm font-medium text-slate-700">{welcomeMessage}</p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>
        )}
        {companyDescription && (
          <p className="mt-1 text-xs text-slate-400">{companyDescription}</p>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        New here?{" "}
        <Link href="/signup" className="font-medium text-brand hover:underline">
          Create an organization
        </Link>
      </p>
    </div>
  );
}
