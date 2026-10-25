import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HouseholdHQ",
    short_name: "HouseholdHQ",
    description: "Manage your household finances together.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f7f5",
    theme_color: "#0f766e",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
