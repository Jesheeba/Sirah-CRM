"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, fullName, password }),
    });

    const json = await res.json();
    setLoading(false);

    if (!res.ok || !json.ok) {
      setError(json.error ?? "Something went wrong.");
      return;
    }

    router.push("/login?joined=1");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
        <input
          type="email"
          value={email}
          readOnly
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Your full name</label>
        <input
          required
          autoFocus
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Jane Smith"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Choose a password</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Creating account…" : "Create account & join"}
      </button>
    </form>
  );
}
