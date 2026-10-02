import type { MetadataRoute } from "next";

// Installable to the home screen (PWA): opens straight into the payer app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KinPrep",
    short_name: "KinPrep",
    description: "They practise daily. You see the proof every Sunday.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#25308A",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
