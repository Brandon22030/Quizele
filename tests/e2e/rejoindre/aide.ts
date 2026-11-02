import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type Route } from "@playwright/test";

export async function pret(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

export async function sansViolation(page: Page) {
  const resultat = await new AxeBuilder({ page }).analyze();
  expect(resultat.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
}

export const reponseJson = (status: number, body: unknown) => (route: Route) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Éléments interactifs visibles, avec leur boîte : base des tests de cible tactile et de focus. */
export async function interactifs(page: Page) {
  return page.evaluate(() => {
    const visibles = [...document.querySelectorAll<HTMLElement>("a[href], button, input, summary, [tabindex]:not([tabindex='-1'])")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    });
    return visibles.map((el) => {
      const r = el.getBoundingClientRect();
      return { nom: el.getAttribute("aria-label") || el.getAttribute("id") || (el.textContent ?? "").trim().slice(0, 30) || el.tagName, l: r.width, h: r.height };
    });
  });
}

/** Anneau de focus d'un élément atteint « au clavier » : une touche est pressée avant focus() pour activer :focus-visible. */
export async function anneau(page: Page, cible: Locator) {
  await page.keyboard.press("Shift");
  await cible.focus();
  return cible.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fv: el.matches(":focus-visible"), style: cs.outlineStyle, largeur: parseFloat(cs.outlineWidth) };
  });
}

/** Animations CSS en cours et durée maximale des transitions (0,01 ms toléré : c'est la neutralisation du projet). */
export async function mouvement(page: Page) {
  return page.evaluate(() => {
    const toutes = document.getAnimations();
    return {
      keyframes: [...new Set([...document.querySelectorAll("*")].map((e) => getComputedStyle(e).animationName).filter((n) => n !== "none"))],
      transitionsLongues: toutes.filter((a) => a instanceof CSSTransition && Number(a.effect?.getTiming().duration ?? 0) > 1).length,
      animationsEnCours: toutes.filter((a) => a instanceof CSSAnimation && a.playState === "running").length,
    };
  });
}
