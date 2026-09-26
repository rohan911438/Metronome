import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Metronome",
    short_name: "Metronome",
    description: "Sandwich-proof trading on Monad: every block is a fair batch auction.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0a14",
    theme_color: "#0c0a14",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
