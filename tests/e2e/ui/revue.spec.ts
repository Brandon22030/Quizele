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
    await expect(toast).toBeHidden({ timeout: 8000 });
  });

  test("une erreur ne se ferme pas automatiquement", async ({ page }) => {
    await page.getByRole("button", { name: "Erreur", exact: true }).click();
    await expect(page.getByText("Erreur durable.")).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(page.getByText("Erreur durable.")).toBeVisible();
  });

  test("le survol suspend la fermeture automatique, la sortie la reprend", async ({ page }) => {
    await page.getByRole("button", { name: "Succès automatique" }).click();
    const toast = page.getByText("Succès éphémère.");
    // La carte joue une animation d'entrée : on attend sa fin pour viser sa position définitive. Le survol est forcé car la barre
    // d'outils de développement Astro peut recouvrir le bas de l'écran.
    const carte = toast.locator("..");
    await carte.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await carte.hover({ position: { x: 6, y: 10 }, force: true });
    await page.waitForTimeout(5000);
    await expect(toast).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(toast).toBeHidden({ timeout: 8000 });
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

test.describe("Squelette sur fond forêt", () => {
  test("le dégradé passe en crème en thème forêt et reste vert forêt en thème jaune", async ({ page }) => {
    const mesurer = async () =>
      page.evaluate(() => {
        const el = document.querySelector("[aria-busy] div") as HTMLElement;
        const sonde = (jeton: string, pct: number) => {
          const d = document.createElement("div");
          d.style.backgroundColor = `color-mix(in oklab, var(--color-${jeton}) ${pct}%, transparent)`;
          document.body.appendChild(d);
          const c = getComputedStyle(d).backgroundColor;
          d.remove();
          return c;
        };
        return { image: getComputedStyle(el).backgroundImage, creme: sonde("creme", 25), foret: sonde("vert-foret", 25) };
      });
    await ouvrir(page, "theme=foret");
    const f = await mesurer();
    expect(f.image).toContain(f.creme);
    expect(f.image).not.toContain(f.foret);
    await ouvrir(page, "");
    const j = await mesurer();
    expect(j.image).toContain(j.foret);
    expect(j.image).not.toContain(j.creme);
  });
});

test.describe("bouton Fermer des toasts : anneau d'au moins 3:1 sur son propre fond", () => {
  for (const theme of ["soleil", "foret"]) {
    for (const [bouton, texte] of [
      ["Succès automatique", "Succès éphémère."],
      ["Erreur", "Erreur durable."],
      ["Information", "Message d'information durable."],
    ] as const) {
      test(`${bouton} (thème ${theme})`, async ({ page }) => {
        await ouvrir(page, `theme=${theme}&cas=toasts`);
        await page.getByRole("button", { name: bouton, exact: true }).click();
        await expect(page.getByText(texte)).toBeVisible();
        const fermer = page.getByRole("button", { name: "Fermer le message" });
        // Le focus clavier suspend aussi la fermeture automatique du toast de succès.
        await fermer.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(fermer).toBeFocused();
        const etat = await fermer.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { anneau: cs.outlineColor, fond: cs.backgroundColor, decalage: parseFloat(cs.outlineOffset), style: cs.outlineStyle };
        });
        expect(etat.style).toBe("solid");
        expect(etat.decalage).toBeLessThan(0);
        expect(etat.anneau).toBe(await couleurJeton(page, "vert-foret"));
        expect(contraste(etat.anneau, etat.fond)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

test("le bouton primaire garde un contour crème sur fond forêt", async ({ page }) => {
  await ouvrir(page, "");
  const bouton = zoneForet(page).getByRole("button", { name: "Primaire sur forêt" });
  expect(await bouton.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await couleurJeton(page, "creme"));
  const jaune = page.locator("main > div:not([data-theme])").getByRole("button", { name: "Rejoindre la partie" });
  expect(await jaune.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await couleurJeton(page, "vert-foret"));
});

test.describe("Dialogue : une fermeture, un seul appel à onClose", () => {
  test.beforeEach(async ({ page }) => ouvrir(page, ""));
  const zone = (page: Page) => page.locator("main > div:not([data-theme])");
  const compte = (page: Page) => zone(page).locator("[data-fermetures]").evaluate((el) => Number(el.getAttribute("data-fermetures")));

  test("Échap (cancel puis close)", async ({ page }) => {
    await zone(page).getByRole("button", { name: "Ouvrir la modale" }).click();
    await page.keyboard.press("Escape");
    await expect(zone(page).getByRole("dialog", { name: "Supprimer ce quiz ?" })).toBeHidden();
    await page.waitForTimeout(300);
    expect(await compte(page)).toBe(1);
  });

  test("bouton Fermer, puis fermeture native sur une seconde ouverture", async ({ page }) => {
    const ouvrirModale = zone(page).getByRole("button", { name: "Ouvrir la modale" });
    const dialogue = zone(page).getByRole("dialog", { name: "Supprimer ce quiz ?" });
    await ouvrirModale.click();
    await dialogue.getByRole("button", { name: "Fermer" }).click();
    await expect(dialogue).toBeHidden();
    await page.waitForTimeout(300);
    expect(await compte(page)).toBe(1);
    await ouvrirModale.click();
    await dialogue.evaluate((d: HTMLDialogElement) => d.close());
    await expect(dialogue).toBeHidden();
    await page.waitForTimeout(300);
    expect(await compte(page)).toBe(2);
  });
});

test.describe("Repli sans JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("un Repli ouvert rendu côté serveur garde l'anneau vert forêt sous <html data-theme=foret>", async ({ page }) => {
    await page.goto(`${URL_GUIDE}?theme=foret&cas=repli`, { waitUntil: "load" });
    const vertForet = await couleurJeton(page, "vert-foret");
    const resume = page.locator("summary", { hasText: "Réglages avancés" });
    await resume.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(resume).toBeFocused();
    expect(await anneau(page)).toBe(vertForet);
  });
});

test.describe("Dialogue : un parent qui refuse la fermeture reste prévenu", () => {
  test.beforeEach(async ({ page }) => ouvrir(page, "cas=refus"));
  const demandes = (page: Page) => page.locator("[data-demandes]").evaluate((el) => Number(el.getAttribute("data-demandes")));

  for (const [nom, fermer] of [
    ["Échap", (page: Page) => page.keyboard.press("Escape")],
    ["bouton Fermer", (page: Page) => page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click()],
    ["clic sur le voile", (page: Page) => page.mouse.click(2, 2)],
  ] as const) {
    test(`${nom} : refus puis acceptation`, async ({ page }) => {
      await page.getByRole("button", { name: "Ouvrir la modale à refus" }).click();
      const dialogue = page.getByRole("dialog", { name: "Modifications non enregistrées" });
      await expect(dialogue).toBeVisible();
      await fermer(page);
      await expect.poll(() => demandes(page)).toBe(1);
      await expect(dialogue).toBeVisible();
      await fermer(page);
      await expect.poll(() => demandes(page)).toBe(2);
      await expect(dialogue).toBeHidden();
    });
  }
});
