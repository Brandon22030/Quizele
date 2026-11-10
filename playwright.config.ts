import { defineConfig, devices } from "@playwright/test";

import { PORT_DEV, PORT_PREVIEW, URL_DEV, URL_PREVIEW } from "./tests/e2e/serveurs";

// Jamais de réutilisation : un serveur déjà présent sur le port viendrait d'un autre worktree et testerait du code obsolète.
const reuseExistingServer = false;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: { baseURL: URL_PREVIEW, trace: "retain-on-failure" },
  // Serveur local uniquement (wrangler dev sur dist) : aucun appel distant.
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${PORT_PREVIEW}`,
      url: URL_PREVIEW,
      reuseExistingServer,
      // Build (jusqu'à environ 4 min machine chargée) puis démarrage de wrangler : la marge évite les faux échecs, une vraie
      // panne (build en erreur, processus mort) reste signalée aussitôt par Playwright sans attendre ce délai.
      timeout: 600_000,
    },
    {
      // --ignore-lock : reste au premier plan (sans lui astro dev 7 se détache en démon quand il détecte un agent)
      // et ignore le verrou d'un autre dev server du même dépôt.
      command: `npx astro dev --port ${PORT_DEV} --ignore-lock`,
      url: `${URL_DEV}/dev/styleguide-base`,
      reuseExistingServer,
      // La première requête compile le dev server Vite à froid ; sous charge, 120 s ne suffisent pas.
      timeout: 300_000,
    },
  ],
  projects: [
    {
      name: "mobile",
      // 390 x 844 : viewport de référence du projet, sans émulation d'un appareil précis.
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false },
    },
    {
      name: "bureau",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
});
