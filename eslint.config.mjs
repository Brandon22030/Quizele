import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";

// Le code serveur détient les bonnes réponses : aucun fichier destiné au navigateur ne doit l'importer.
const serverImportPatterns = [
  {
    group: ["**/server/**", "@/server/**", "src/server/**"],
    message: "src/server est réservé au Worker : ne pas l'importer depuis le code client ou partagé.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".astro/**",
      ".wrangler/**",
      "node_modules/**",
      "worker-configuration.d.ts",
      "playwright-report/**",
      "test-results/**",
      // Ancien code Next/Supabase, supprimé en QZ-002-18.
      "app/**",
      "lib/**",
      "components/**",
      "types/**",
      "sql/**",
      "middleware.ts",
      "next.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/islands/**", "src/components/**", "src/client/**", "src/shared/**"],
    rules: { "no-restricted-imports": ["error", { patterns: serverImportPatterns }] },
  },
);
