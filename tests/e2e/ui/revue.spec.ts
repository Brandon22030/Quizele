import { expect, test, type Page } from "@playwright/test";
import { contraste, couleurJeton, URL_GUIDE, zoneForet } from "./aide";

async function ouvrir(page: Page, requete: string): Promise<void> {
  await page.goto(`${URL_GUIDE}?${requete}`, { waitUntil: "networkidle" });
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

const anneau = (page: Page) => page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineColor);

test.describe("thème forêt porté par <html data-theme=foret>", () => {
  test.beforeEach(async ({ page }) => ouvrir(page, "theme=foret&cas=repli"));

  test("l'anneau de focus reste vert forêt sur le papier crème d'une Modal, jaune hors papier", async ({ page }) => {
    const vertForet = await couleurJeton(page, "vert-foret");
    const jaune = await couleurJeton(page, "jaune-soleil");
    const declencheur = page.getByRole("button", { name: "Ouvrir la modale" }).first();
    await declencheur.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(declencheur).toBeFocused();
    expect(await anneau(page)).toBe(jaune);

    await declencheur.click();
    const dialogue = page.getByRole("dialog", { name: "Supprimer ce quiz ?" }).first();
    await expect(dialogue).toBeVisible();
    await dialogue.getByRole("button", { name: "Fermer" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await anneau(page)).toBe(vertForet);
    const creme = await couleurJeton(page, "creme");
    expect(contraste(await anneau(page), creme)).toBeGreaterThanOrEqual(3);
  });

  test("le focus dans le panneau de MenuCompte est vert forêt", async ({ page }) => {
    const vertForet = await couleurJeton(page, "vert-foret");
    await page.getByRole("button", { name: /Menu du compte/ }).first().click();
    const deconnexion = page.getByRole("button", { name: "Se déconnecter" }).first();
    await deconnexion.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(deconnexion).toBeFocused();
    expect(await anneau(page)).toBe(vertForet);
  });

  test("Repli ouvert : aide de FormField et description d'Interrupteur lisibles sur le papier crème", async ({ page }) => {
    const creme = await couleurJeton(page, "creme");
    const mousse = await couleurJeton(page, "vert-mousse");
    for (const texte of ["Visible par les joueurs.", "Pour éviter de copier sur le voisin."]) {
      const el = page.getByText(texte).first();
      await expect(el).toBeVisible();
      const couleur = await el.evaluate((n) => getComputedStyle(n).color);
      expect(couleur).toBe(mousse);
      expect(contraste(couleur, creme)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("le focus du résumé d'un Repli ouvert est vert forêt", async ({ page }) => {
    const vertForet = await couleurJeton(page, "vert-foret");
    const resume = page.locator("summary", { hasText: "Réglages avancés" });
    await resume.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await anneau(page)).toBe(vertForet);
  });
});

test.describe("fond forêt : contours visibles", () => {
  test.beforeEach(async ({ page }) => ouvrir(page, "cas=repli"));

  test("bouton désactivé, option cochée et Pilule forêt ont un contour crème", async ({ page }) => {
    const creme = await couleurJeton(page, "creme");
    const z = zoneForet(page);
    const contour = (loc: ReturnType<typeof z.locator>) => loc.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(await contour(z.getByRole("button", { name: "Inactif sur forêt" }))).toBe(creme);
    expect(await contour(z.locator("span", { hasText: /^Forêt$/ }).first())).toBe(creme);
    const coche = z.getByRole("radio", { checked: true }).first();
    expect(await coche.evaluate((el) => getComputedStyle(el.nextElementSibling as Element).borderTopColor)).toBe(creme);
  });

  test("le bouton désactivé a un fond crème et un texte vert mousse lisible", async ({ page }) => {
    const bouton = zoneForet(page).getByRole("button", { name: "Inactif sur forêt" });
    const etat = await bouton.evaluate((el) => ({ fond: getComputedStyle(el).backgroundColor, texte: getComputedStyle(el).color }));
    expect(etat.fond).toBe(await couleurJeton(page, "creme"));
    expect(contraste(etat.texte, etat.fond)).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("Toast", () => {
  test.beforeEach(async ({ page }) => ouvrir(page, "cas=toasts"));

  test("se ferme seul malgré des rendus fréquents du parent (minuteur non relancé)", async ({ page }) => {
    await page.getByRole("button", { name: "Succès automatique" }).click();
    const toast = page.getByText("Succès éphémère.");
    await expect(toast).toBeVisible();
    await expect(toast).toBeHidden({ timeout: 5000 });
  });

  test("une erreur ne se ferme pas automatiquement", async ({ page }) => {
    await page.getByRole("button", { name: "Erreur", exact: true }).click();
    await expect(page.getByText("Erreur durable.")).toBeVisible();
    await page.waitForTimeout(3200);
    await expect(page.getByText("Erreur durable.")).toBeVisible();
  });

  test("le survol suspend la fermeture automatique, la sortie la reprend", async ({ page }) => {
    await page.getByRole("button", { name: "Succès automatique" }).click();
    const toast = page.getByText("Succès éphémère.");
    // L'élément survolé est la carte du toast ; on vise son bord gauche, hors de la barre d'outils de développement Astro.
    const carte = (await toast.locator("..").boundingBox())!;
    await page.mouse.move(carte.x + 6, carte.y + carte.height / 2);
    await page.waitForTimeout(3200);
    await expect(toast).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(toast).toBeHidden({ timeout: 5000 });
  });

  test("les régions status et alert existent avant tout message, l'erreur est annoncée dans la région alert", async ({ page }) => {
    await expect(page.getByRole("status")).not.toHaveCount(0);
    expect(await page.locator('[role=alert]:empty, [role=status]:empty').count()).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Erreur", exact: true }).click();
    await expect(page.locator('[role=alert]', { hasText: "Erreur durable." }).first()).toBeVisible();
    await expect(page.getByText("Erreur durable.").first()).not.toHaveAttribute("role", /.+/);
  });
});

test.describe("Dialogue", () => {
  test.beforeEach(async ({ page }) => ouvrir(page, ""));

  test("un glissement démarré dans le contenu et relâché sur le voile ne ferme pas", async ({ page }) => {
    await page.locator("main > div:not([data-theme])").getByRole("button", { name: "Ouvrir la modale" }).click();
    const dialogue = page.getByRole("dialog", { name: "Supprimer ce quiz ?" }).first();
    const titre = (await dialogue.getByRole("heading").boundingBox())!;
    await page.mouse.move(titre.x + 4, titre.y + 4);
    await page.mouse.down();
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await expect(dialogue).toBeVisible();
  });

  test("une fermeture native resynchronise l'état : le dialogue se rouvre au clic suivant", async ({ page }) => {
    const zone = page.locator("main > div:not([data-theme])");
    const declencheur = zone.getByRole("button", { name: "Ouvrir la modale" });
    await declencheur.click();
    const dialogue = zone.getByRole("dialog", { name: "Supprimer ce quiz ?" });
    await expect(dialogue).toBeVisible();
    await dialogue.evaluate((d: HTMLDialogElement) => d.close());
    await expect(dialogue).toBeHidden();
    await declencheur.click();
    await expect(dialogue).toBeVisible();
  });
});
