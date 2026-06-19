import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sirah CRM",
    short_name: "CRM",
    description: "Multi-tenant Sales CRM",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#071689",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
