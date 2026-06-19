// Curated country dial codes with the valid national-number length (min/max digits,
// excluding the dial code). Used by PhoneInput to limit/validate phone entry per country.
export interface Country {
  name: string;
  iso2: string;
  dial: string;
  min: number;
  max: number;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { name: "India", iso2: "IN", dial: "91", min: 10, max: 10, flag: "🇮🇳" },
  { name: "United States", iso2: "US", dial: "1", min: 10, max: 10, flag: "🇺🇸" },
  { name: "United Kingdom", iso2: "GB", dial: "44", min: 10, max: 10, flag: "🇬🇧" },
  { name: "Canada", iso2: "CA", dial: "1", min: 10, max: 10, flag: "🇨🇦" },
  { name: "Australia", iso2: "AU", dial: "61", min: 9, max: 9, flag: "🇦🇺" },
  { name: "United Arab Emirates", iso2: "AE", dial: "971", min: 9, max: 9, flag: "🇦🇪" },
  { name: "Saudi Arabia", iso2: "SA", dial: "966", min: 9, max: 9, flag: "🇸🇦" },
  { name: "Singapore", iso2: "SG", dial: "65", min: 8, max: 8, flag: "🇸🇬" },
  { name: "Malaysia", iso2: "MY", dial: "60", min: 9, max: 10, flag: "🇲🇾" },
  { name: "Germany", iso2: "DE", dial: "49", min: 10, max: 11, flag: "🇩🇪" },
  { name: "France", iso2: "FR", dial: "33", min: 9, max: 9, flag: "🇫🇷" },
  { name: "Italy", iso2: "IT", dial: "39", min: 9, max: 10, flag: "🇮🇹" },
  { name: "Spain", iso2: "ES", dial: "34", min: 9, max: 9, flag: "🇪🇸" },
  { name: "Netherlands", iso2: "NL", dial: "31", min: 9, max: 9, flag: "🇳🇱" },
  { name: "Switzerland", iso2: "CH", dial: "41", min: 9, max: 9, flag: "🇨🇭" },
  { name: "Sweden", iso2: "SE", dial: "46", min: 7, max: 9, flag: "🇸🇪" },
  { name: "Ireland", iso2: "IE", dial: "353", min: 9, max: 9, flag: "🇮🇪" },
  { name: "Russia", iso2: "RU", dial: "7", min: 10, max: 10, flag: "🇷🇺" },
  { name: "China", iso2: "CN", dial: "86", min: 11, max: 11, flag: "🇨🇳" },
  { name: "Japan", iso2: "JP", dial: "81", min: 10, max: 10, flag: "🇯🇵" },
  { name: "South Korea", iso2: "KR", dial: "82", min: 9, max: 10, flag: "🇰🇷" },
  { name: "Brazil", iso2: "BR", dial: "55", min: 10, max: 11, flag: "🇧🇷" },
  { name: "Mexico", iso2: "MX", dial: "52", min: 10, max: 10, flag: "🇲🇽" },
  { name: "Argentina", iso2: "AR", dial: "54", min: 10, max: 10, flag: "🇦🇷" },
  { name: "South Africa", iso2: "ZA", dial: "27", min: 9, max: 9, flag: "🇿🇦" },
  { name: "Nigeria", iso2: "NG", dial: "234", min: 10, max: 10, flag: "🇳🇬" },
  { name: "Kenya", iso2: "KE", dial: "254", min: 9, max: 9, flag: "🇰🇪" },
  { name: "Egypt", iso2: "EG", dial: "20", min: 10, max: 10, flag: "🇪🇬" },
  { name: "Pakistan", iso2: "PK", dial: "92", min: 10, max: 10, flag: "🇵🇰" },
  { name: "Bangladesh", iso2: "BD", dial: "880", min: 10, max: 10, flag: "🇧🇩" },
  { name: "Sri Lanka", iso2: "LK", dial: "94", min: 9, max: 9, flag: "🇱🇰" },
  { name: "Nepal", iso2: "NP", dial: "977", min: 10, max: 10, flag: "🇳🇵" },
  { name: "Indonesia", iso2: "ID", dial: "62", min: 9, max: 12, flag: "🇮🇩" },
  { name: "Philippines", iso2: "PH", dial: "63", min: 10, max: 10, flag: "🇵🇭" },
  { name: "Thailand", iso2: "TH", dial: "66", min: 9, max: 9, flag: "🇹🇭" },
  { name: "Vietnam", iso2: "VN", dial: "84", min: 9, max: 10, flag: "🇻🇳" },
  { name: "New Zealand", iso2: "NZ", dial: "64", min: 8, max: 10, flag: "🇳🇿" },
  { name: "Turkey", iso2: "TR", dial: "90", min: 10, max: 10, flag: "🇹🇷" },
  { name: "Poland", iso2: "PL", dial: "48", min: 9, max: 9, flag: "🇵🇱" },
];

export const DEFAULT_COUNTRY = "IN";

export function countryByIso(iso: string): Country {
  return COUNTRIES.find((c) => c.iso2 === iso) ?? COUNTRIES[0];
}

/** National number is the right length for the country. */
export function isValidNationalNumber(iso: string, digits: string): boolean {
  const c = countryByIso(iso);
  return digits.length >= c.min && digits.length <= c.max;
}

/** Combine into a stored international form, e.g. "+91 9876543210". */
export function toInternational(iso: string, digits: string): string {
  if (!digits) return "";
  return `+${countryByIso(iso).dial} ${digits}`;
}
