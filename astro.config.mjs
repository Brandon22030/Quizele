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
  // Déjà la valeur par défaut d'Astro 7, posée explicitement : la session tient dans un cookie et les actions
  // acceptent du FormData, qu'un autre site peut poster sans preflight. Ce contrôle refuse ces envois (403).
  security: { checkOrigin: true },
  vite: {
    plugins: [tailwindcss()],
    // Config inline : empêche Vite de charger l'ancien postcss.config.mjs de Next (supprimé en QZ-002-18).
    css: { postcss: { plugins: [] } },
    // Pré-bundle explicite : sans lui, l'optimisation à froid de Vite recharge la page en cours de route
    // (« Invalid hook call », import dynamique de button.tsx en échec).
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "motion/react",
        "clsx",
        "tailwind-merge",
        "partysocket",
        "@base-ui/react",
        "lucide-react",
        "qrcode.react",
      ],
    },
  },
});
