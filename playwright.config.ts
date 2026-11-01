import { defineConfig, devices } from "@playwright/test";

const port = 4322;
// Serveur de développement : /dev/styleguide-base n'existe qu'en DEV (404 sur le build).
const portDev = 4323;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  // Serveur local uniquement (wrangler dev sur dist) : aucun appel distant.
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx astro dev --port ${portDev}`,
      url: `http://localhost:${portDev}/dev/styleguide-base`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
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
