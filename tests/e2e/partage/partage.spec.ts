import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { URL_DEV } from "../serveurs";

const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DOSSIER_CAPTURES = process.env.CAPTURES_PARTAGE;

const CAS = [
  { id: "resultat-portrait", largeur: 1080, hauteur: 1350 },
  { id: "classement-portrait", largeur: 1080, hauteur: 1350 },
  { id: "resultat-paysage", largeur: 1200, hauteur: 630 },
  { id: "classement-paysage", largeur: 1200, hauteur: 630 },
];

test("génère les deux formats de PNG aux bonnes dimensions", async ({ page }) => {
  // Le premier chargement de la page en dev compile le module et télécharge les polices : large marge sous charge.
  test.setTimeout(180_000);
  await page.goto(`${URL_DEV}/dev/partage`);
  await page.getByRole("button", { name: "Générer les images" }).click();
  await expect(page.locator("body[data-pret]")).toHaveAttribute("data-pret", "true", { timeout: 120_000 });

  for (const cas of CAS) {
    const octets = await page.evaluate(async (id) => {
      const img = document.getElementById(id) as HTMLImageElement;
      const reponse = await fetch(img.src);
      return Array.from(new Uint8Array(await reponse.arrayBuffer()));
    }, cas.id);
    expect(octets.slice(0, 8), `${cas.id} : signature PNG`).toEqual(SIGNATURE_PNG);
    // L'en-tête IHDR porte la largeur puis la hauteur en entiers 32 bits gros-boutistes (octets 16 à 23).
    const vue = new DataView(new Uint8Array(octets.slice(16, 24)).buffer);
    expect(vue.getUint32(0), `${cas.id} : largeur`).toBe(cas.largeur);
    expect(vue.getUint32(4), `${cas.id} : hauteur`).toBe(cas.hauteur);
    if (DOSSIER_CAPTURES) {
      mkdirSync(DOSSIER_CAPTURES, { recursive: true });
      writeFileSync(join(DOSSIER_CAPTURES, `qz002-09-${cas.id}.png`), Buffer.from(octets));
    }
  }
});
