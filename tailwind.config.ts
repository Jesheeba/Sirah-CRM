import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Channels resolve from CSS variables (defaults in globals.css, overridden
        // per-tenant by src/lib/branding.ts → brandRampStyle). The `<alpha-value>`
        // placeholder keeps `bg-brand/30`, `text-brand`, etc. working.
        brand: {
          DEFAULT: "rgb(var(--brand-700) / <alpha-value>)",
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
