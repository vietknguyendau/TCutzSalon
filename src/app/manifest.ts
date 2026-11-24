import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chair — Salon dashboard",
    short_name: "Chair",
    description: "Keep cutting hair. We'll handle the appointments.",
    start_url: "/app/today",
    display: "standalone",
    background_color: "#fbf8f3",
    theme_color: "#1c1b1a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
