import { defineConfig } from "drizzle-kit";

// Génération seule : les migrations sont appliquées par `wrangler d1 migrations apply`, jamais par drizzle-kit.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
});
