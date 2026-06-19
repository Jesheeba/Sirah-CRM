"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

interface ImageUploadFieldProps {
  tenantId: string;
  kind: "logo" | "favicon" | "login-bg";
  label: string;
  value: string;
  onChange: (url: string) => void;
  accept?: string;
  hint?: string;
  maxBytes?: number;
}

function fileExt(file: File): string {
  const fromName = file.name.includes(".")
    ? file.name.split(".").pop()!.toLowerCase()
    : "";
  const ext = fromName || file.type.split("/")[1] || "png";
  return ext.replace(/[^a-z0-9]/g, "") || "png";
}

export default function ImageUploadField({
  tenantId,
  kind,
  label,
  value,
  onChange,
  accept = "image/*",
  hint,
  maxBytes = DEFAULT_MAX_BYTES,
}: ImageUploadFieldProps) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file later.
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    setError(null);
    if (!file.type.startsWith("image/")) {
      return setError("Please choose an image file.");
    }
    if (file.size > maxBytes) {
      return setError(`Image must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    }

    setBusy(true);
    const path = `${tenantId}/${kind}-${crypto.randomUUID()}.${fileExt(file)}`;
    const { error: upErr } = await supabase.storage
      .from("branding")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setBusy(false);
      return setError(upErr.message);
    }
    const { data } = supabase.storage.from("branding").getPublicUrl(path);
    setBusy(false);
    onChange(data.publicUrl);
  }

  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-slate-400">{label}</label>

      {value.trim() && (
        <img
          src={value}
          alt={`${label} preview`}
          className="mt-1 max-h-12 max-w-[200px] rounded border border-slate-100 object-contain"
        />
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={busy}
        onChange={onPick}
        className="mt-1 block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:opacity-90 disabled:opacity-50"
      />

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="…or paste an image URL"
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
      />

      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {busy && <p className="mt-1 text-xs text-slate-500">Uploading…</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
