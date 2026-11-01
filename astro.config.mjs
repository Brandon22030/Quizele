import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  // Aucune image à transformer : évite le binding Cloudflare Images.
  adapter: cloudflare({ imageService: "passthrough" }),
  integrations: [react()],
  // Better Auth gère ses propres cookies : on évite les sessions Astro (KV, cohérence éventuelle).
  session: false,
  vite: {
    plugins: [tailwindcss()],
    // Config inline : empêche Vite de charger l'ancien postcss.config.mjs de Next (supprimé en QZ-002-18).
    css: { postcss: { plugins: [] } },
  },
});
