import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("socle : page placeholder", () => {
  test("fond jaune soleil, Baloo 2 chargée, aucune violation axe", async ({ page }, info) => {
    const reponse = await page.goto("/");
    expect(reponse?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    // Jeton lu depuis la feuille de style, jamais recopié dans le test.
    const { fond, jeton } = await page.evaluate(() => {
      const sonde = document.createElement("div");
      sonde.style.backgroundColor = "var(--color-jaune-soleil)";
      document.body.appendChild(sonde);
      const jeton = getComputedStyle(sonde).backgroundColor;
      sonde.remove();
      return { fond: getComputedStyle(document.documentElement).backgroundColor, jeton };
    });
    expect(jeton).not.toBe("rgba(0, 0, 0, 0)");
    expect(fond).toBe(jeton);

    // check() renvoie true si aucune police ne correspond : on exige une FontFace réellement chargée.
    const baloo = await page.evaluate(async () => {
      await document.fonts.load('16px "Baloo 2"');
      return [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Baloo 2" && f.status === "loaded").length;
    });
    expect(baloo).toBeGreaterThan(0);
    const police = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(police).toContain("Baloo 2");

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);

    if (info.project.name === "mobile") {
      expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
  });

  test("route inconnue : 404", async ({ request }) => {
    expect((await request.get("/inexistant")).status()).toBe(404);
  });
});
