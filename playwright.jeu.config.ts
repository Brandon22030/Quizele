import { defineConfig, devices } from "@playwright/test";

// La planche /dev/styleguide-jeu n'existe qu'en développement : on cible un `astro dev` déjà lancé
// (JEU_BASE_URL), sans webServer.
const baseURL = process.env.JEU_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "tests/e2e/jeu",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false } },
    { name: "bureau", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
