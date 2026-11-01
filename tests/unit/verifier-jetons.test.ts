import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/verifier-jetons.mjs");
const dossiers: string[] = [];

// Le script lit `src/` du répertoire courant : on l'exécute dans un projet jetable.
function lancer(fichiers: Record<string, string>) {
  const racine = mkdtempSync(join(tmpdir(), "jetons-"));
  dossiers.push(racine);
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(racine, chemin)), { recursive: true });
    writeFileSync(join(racine, chemin), contenu);
  }
  return spawnSync(process.execPath, [script], { cwd: racine, encoding: "utf8" });
}

afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("lint:jetons", () => {
  it("passe sur un projet propre", () => {
    const r = lancer({ "src/pages/a.astro": '<p class="text-base bg-vert-foret">ok</p>' });
    expect(r.status).toBe(0);
  });

  it.each([
    ["taille arbitraire", "src/pages/a.astro", '<p class="text-[13px]">x</p>'],
    ["couleur arbitraire", "src/pages/a.astro", '<p class="bg-[#123456]">x</p>'],
    ["variante arbitraire", "src/pages/a.astro", '<p class="md:p-[7px]">x</p>'],
    ["hexadécimale hors global.css", "src/pages/a.astro", "<style>p { color: #fff; }</style>"],
    ["rgb() hors global.css", "src/pages/a.astro", "<style>p { color: rgb(1 2 3); }</style>"],
    ["Date.now dans islands", "src/islands/x/a.tsx", "export const t = () => Date.now();"],
    ["Date.now dans components", "src/components/ui/a.tsx", "export const t = () => Date.now();"],
  ])("échoue : %s", (_nom, chemin, contenu) => {
    const r = lancer({ [chemin]: contenu });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("violation");
  });

  it("autorise Date.now dans clock.ts et hors islands/components", () => {
    const r = lancer({
      "src/shared/clock.ts": "export const t = () => Date.now();",
      "src/server/a.ts": "export const t = () => Date.now();",
    });
    expect(r.status).toBe(0);
  });

  it("autorise couleurs et hexadécimaux dans global.css", () => {
    const r = lancer({ "src/styles/global.css": "@theme { --color-a: #ffd400; --c: rgb(1 2 3); }" });
    expect(r.status).toBe(0);
  });

  it("ne confond pas un tableau indexé avec une classe arbitraire", () => {
    const r = lancer({ "src/pages/a.ts": "const x = tab[0]; const y = a.b[1];" });
    expect(r.status).toBe(0);
  });
});
