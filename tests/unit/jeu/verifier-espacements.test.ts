import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/verifier-jetons.mjs");
const dossiers: string[] = [];
const css = "@theme inline {\n  --spacing-1: 4px;\n  --spacing-4: 16px;\n  --spacing-chrono: 128px;\n}\n";

function lancer(classes: string) {
  const racine = mkdtempSync(join(tmpdir(), "espacements-"));
  dossiers.push(racine);
  const fichiers = { "src/styles/global.css": css, "src/pages/a.astro": `<p class="${classes}">x</p>` };
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(racine, chemin)), { recursive: true });
    writeFileSync(join(racine, chemin), contenu);
  }
  return spawnSync(process.execPath, [script], { cwd: racine, encoding: "utf8" });
}

afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("lint:jetons - multiples d'espacement", () => {
  it("accepte les multiples déclarés, les jetons nommés, 0 et les fractions", () => {
    const r = lancer("p-4 gap-1 size-chrono m-0 w-1/2 -mt-4 md:px-4 hover:-translate-y-1 text-base");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.each(["size-4.5", "inset-3.5", "h-15.5", "w-37.5", "min-h-17", "size-33", "p-7", "md:gap-9", "-mt-5", "max-w-97.5"])(
    "refuse %s, absent de global.css",
    (classe) => {
      const r = lancer(classe);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("multiple d'espacement non déclaré");
    },
  );

  it("ne confond pas une classe de texte ou de bordure avec un espacement", () => {
    expect(lancer("text-2xl border-trait leading-5 z-10 order-2 rotate-4").status).toBe(0);
  });
});
