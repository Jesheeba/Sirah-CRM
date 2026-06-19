"use client";

import { createContext, useContext } from "react";
import {
  DEFAULT_LABELS,
  MODULE_KEYS,
  type ModuleKey,
} from "@/lib/branding";

/** The subset of branding that client components (nav, topbar) need. */
export interface BrandingContextValue {
  brandName: string | null;
  logoUrl: string | null;
  labels: Record<ModuleKey, string>;
  visibility: Record<ModuleKey, boolean>;
}

const FALLBACK: BrandingContextValue = {
  brandName: null,
  logoUrl: null,
  labels: { ...DEFAULT_LABELS },
  visibility: Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Record<
    ModuleKey,
    boolean
  >,
};

const BrandingContext = createContext<BrandingContextValue>(FALLBACK);

export function BrandingProvider({
  value,
  children,
}: {
  value: BrandingContextValue;
  children: React.ReactNode;
}) {
  return (
    <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
