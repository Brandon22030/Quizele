import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  test: {
    projects: [
      {
        // Le Worker testé est le bundle Astro (dist/server) : les modules virtuels d'Astro
        // n'existent pas hors build, d'où le `npm run build` dans le script `test`.
        // Bindings D1, DO et R2 simulés par miniflare ; vars factices héritées de wrangler.jsonc.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./dist/server/wrangler.json" },
            miniflare: {
              bindings: {
                PLAYER_TOKEN_SECRET: "secret-de-test-joueur-32-caracteres-minimum",
                BETTER_AUTH_SECRET: "secret-de-test-auth-32-caracteres-minimum",
              },
            },
          }),
        ],
        test: { name: "worker", include: ["tests/worker/**/*.test.ts"] },
      },
      {
        test: { name: "unit", environment: "node", include: ["tests/unit/**/*.test.ts"] },
      },
    ],
  },
});
