"use client";

import { COUNTRIES, countryByIso } from "@/lib/countries";

/**
 * Country-code phone entry. The country select sets the dial code; the number field
 * accepts digits only and is capped at that country's maximum national length.
 * `value` is the national number (digits only); combine with the country via
 * `toInternational(country, value)` before saving.
 */
export default function PhoneInput({
  country,
  onCountry,
  value,
  onValue,
  placeholder,
}: {
  country: string;
  onCountry: (iso: string) => void;
  value: string;
  onValue: (digits: string) => void;
  placeholder?: string;
}) {
  const c = countryByIso(country);
  return (
    <div className="flex gap-2">
      <select
        value={country}
        onChange={(e) => onCountry(e.target.value)}
        aria-label="Country code"
        className="w-28 shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand"
      >
        {COUNTRIES.map((x) => (
          <option key={x.iso2} value={x.iso2}>
            {x.flag} +{x.dial}
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="numeric"
        value={value}
        onChange={(e) => onValue(e.target.value.replace(/\D/g, "").slice(0, c.max))}
        placeholder={placeholder ?? `${c.min === c.max ? c.max : `${c.min}-${c.max}`}-digit number`}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </div>
  );
}
