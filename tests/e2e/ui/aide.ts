import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { URL_DEV } from "../serveurs";

export const URL_GUIDE = `${URL_DEV}/dev/styleguide-base`;

export const test = base.extend<{ guide: Page }>({
  guide: async ({ page }, use) => {
    const erreurs: string[] = [];
    page.on("pageerror", (e) => erreurs.push(e.message));
    await page.goto(URL_GUIDE, { waitUntil: "networkidle" });
    // Les îlots React doivent être hydratés avant toute interaction.
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await use(page);
    expect(erreurs).toEqual([]);
  },
});
export { expect };

export const zoneJaune = (page: Page): Locator => page.locator("main > div:not([data-theme])");
export const zoneForet = (page: Page): Locator => page.locator("main > div[data-theme=foret]");

/** Couleur résolue d'un jeton, lue depuis la feuille de style (jamais recopiée). */
export async function couleurJeton(page: Page, jeton: string): Promise<string> {
  // Tailwind n'émet que les variables utilisées : on passe par l'utilitaire text-<jeton>, présent dès qu'un composant s'en sert.
  return page.evaluate((nom) => {
    const sonde = document.createElement("div");
    sonde.className = `text-${nom}`;
    document.body.appendChild(sonde);
    const c = getComputedStyle(sonde).color;
    sonde.remove();
    return c;
  }, jeton);
}

export async function largeurTrait(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sonde = document.createElement("div");
    sonde.style.width = "var(--spacing-trait)";
    document.body.appendChild(sonde);
    const w = parseFloat(getComputedStyle(sonde).width);
    sonde.remove();
    return w;
  });
}

export interface Tabulable {
  nom: string;
  foret: boolean;
  dansPapier: boolean;
  boite: { x: number; y: number; width: number; height: number };
  contour: { style: string; largeur: number; couleur: string };
}

/**
 * Parcourt la page à la touche Tab et relève, pour chaque élément atteint, sa boîte tactile et son anneau de focus.
 * Les champs masqués visuellement (interrupteur, radio) montrent leur anneau sur le span voisin : on le mesure là
 * et on prend le libellé parent comme cible tactile.
 */
export async function parcourirTab(page: Page, racine = "body", max = 80): Promise<Tabulable[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const vus: Tabulable[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate((racineSel) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || !document.querySelector(racineSel)?.contains(el)) return null;
      const masque = el.matches("input") && el.getBoundingClientRect().width <= 1;
      const cibleAnneau = masque ? (el.nextElementSibling as HTMLElement) : el;
      const cibleBoite = masque ? (el.closest("label") as HTMLElement) : el;
      const cs = getComputedStyle(cibleAnneau);
      const r = cibleBoite.getBoundingClientRect();
      return {
        panneau: el.getAttribute("role") === "tabpanel",
        nom: el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 40) || el.tagName.toLowerCase(),
        foret: !!el.closest("[data-theme=foret]"),
        dansPapier: !!el.closest("[data-papier]"),
        boite: { x: r.x, y: r.y, width: r.width, height: r.height },
        contour: { style: cs.outlineStyle, largeur: parseFloat(cs.outlineWidth), couleur: cs.outlineColor },
      };
    }, racine);
    if (!info) break;
    if (info.panneau) continue;
    if (vus.some((v) => v.nom === info.nom && JSON.stringify(v.boite) === JSON.stringify(info.boite))) break;
    vus.push({ nom: info.nom, foret: info.foret, dansPapier: info.dansPapier, boite: info.boite, contour: info.contour });
  }
  return vus;
}

/** Luminance relative et rapport de contraste WCAG entre deux couleurs rgb(a). */
export function contraste(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
