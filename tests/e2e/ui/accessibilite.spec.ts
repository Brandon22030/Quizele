import AxeBuilder from "@axe-core/playwright";
import { couleurJeton, expect, largeurTrait, parcourirTab, test, zoneForet, zoneJaune } from "./aide";

test.describe("cibles tactiles et focus visible", () => {
  test("tout élément tabulable : 44 px minimum et anneau de focus du bon thème", async ({ guide }) => {
    const elements = await parcourirTab(guide, "main");
    expect(elements.length).toBeGreaterThan(20);
    const trait = await largeurTrait(guide);
    const vertForet = await couleurJeton(guide, "vert-foret");
    const jaune = await couleurJeton(guide, "jaune-soleil");

    const petits = elements.filter((e) => e.boite.height < 44 || e.boite.width < 44).map((e) => `${e.nom} ${Math.round(e.boite.width)}x${Math.round(e.boite.height)}`);
    expect(petits, "cibles de moins de 44 px").toEqual([]);

    const sansAnneau = elements
      .filter((e) => e.contour.style !== "solid" || Math.abs(e.contour.largeur - trait) > 0.01)
      .map((e) => `${e.nom} ${e.contour.style} ${e.contour.largeur}`);
    expect(sansAnneau, "anneau absent ou de mauvaise largeur").toEqual([]);

    const mauvaiseCouleur = elements
      .filter((e) => e.contour.couleur !== (e.foret && !e.dansPapier ? jaune : vertForet))
      .map((e) => `${e.nom} (${e.foret ? "forêt" : "jaune"}) ${e.contour.couleur}`);
    expect(mauvaiseCouleur, "couleur d'anneau").toEqual([]);
    expect(elements.some((e) => e.foret)).toBe(true);
    expect(elements.some((e) => !e.foret)).toBe(true);
  });

  test("avec dialogue ouvert : cibles de 44 px et anneau vert forêt dans le papier sous thème forêt", async ({ guide }) => {
    const z = zoneForet(guide);
    await z.getByRole("button", { name: "Ouvrir la feuille" }).click();
    const dialogue = z.getByRole("dialog", { name: "Tes questions" });
    await expect(dialogue).toBeVisible();
    await dialogue.getByRole("button", { name: "Fermer" }).focus();
    await guide.keyboard.press("Shift+Tab");
    const elements = await parcourirTab(guide, "dialog[open]");
    expect(elements.length).toBeGreaterThanOrEqual(2);
    const vertForet = await couleurJeton(guide, "vert-foret");
    for (const e of elements) {
      expect(e.dansPapier).toBe(true);
      expect(e.contour.couleur, e.nom).toBe(vertForet);
      expect(e.boite.height, e.nom).toBeGreaterThanOrEqual(44);
    }
  });

  test("zone cliquable des switch et radios : libellé entier, pas seulement le glisseur", async ({ guide }) => {
    for (const z of [zoneJaune(guide), zoneForet(guide)]) {
      for (const role of ["switch", "radio"] as const) {
        const entrees = z.getByRole(role);
        for (let i = 0; i < (await entrees.count()); i++) {
          const boite = (await entrees.nth(i).locator("xpath=ancestor::label").boundingBox())!;
          expect(boite.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });
});

for (const reduit of [false, true]) {
  test.describe(`axe, mouvement ${reduit ? "réduit" : "normal"}`, () => {
    test.use({ reducedMotion: reduit ? "reduce" : "no-preference" });

    test("0 violation (page, feuille ouverte, modale ouverte, erreur de champ)", async ({ guide }) => {
      const axe = async () => (await new AxeBuilder({ page: guide }).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      expect(await axe()).toEqual([]);

      await zoneJaune(guide).getByLabel("Ton pseudo").focus();
      await zoneJaune(guide).getByLabel("Ton pseudo").blur();
      await zoneForet(guide).getByLabel("Ton pseudo").focus();
      await zoneForet(guide).getByLabel("Ton pseudo").blur();
      await expect(guide.getByRole("alert").filter({ hasText: "Choisis un pseudo" })).toHaveCount(2);
      expect(await axe()).toEqual([]);

      for (const z of [zoneJaune(guide), zoneForet(guide)]) {
        await z.getByRole("button", { name: "Ouvrir la feuille" }).click();
        await expect(z.getByRole("dialog")).toBeVisible();
        expect(await axe()).toEqual([]);
        await guide.keyboard.press("Escape");
        await z.getByRole("button", { name: "Ouvrir la modale" }).click();
        await expect(z.getByRole("dialog")).toBeVisible();
        expect(await axe()).toEqual([]);
        await guide.keyboard.press("Escape");
      }

      await zoneJaune(guide).getByRole("button", { name: /Menu du compte/ }).click();
      expect(await axe()).toEqual([]);
    });

    test("animations : présentes en mouvement normal, absentes en mouvement réduit", async ({ guide }) => {
      const animations = await guide.evaluate(() => {
        const noms = new Set<string>();
        for (const el of document.querySelectorAll("*")) {
          const n = getComputedStyle(el).animationName;
          if (n !== "none") noms.add(n);
        }
        return { noms: [...noms], enCours: document.getAnimations().filter((a) => a.playState === "running").length };
      });
      if (reduit) {
        expect(animations.noms).toEqual([]);
        expect(animations.enCours).toBe(0);
      } else {
        expect(animations.noms.length).toBeGreaterThan(0);
      }
    });

    test("animations du toast et de la transition des boutons coupées en mouvement réduit", async ({ guide }) => {
      await zoneJaune(guide).getByRole("button", { name: "Afficher un message" }).click();
      // Le rôle status appartient à la région : on cible le toast lui-même, qui porte l'animation.
      const toast = guide.getByText("Enregistré.").locator("..");
      await expect(toast).toBeVisible();
      const etat = await toast.evaluate((el) => ({ anim: getComputedStyle(el).animationName }));
      if (reduit) expect(etat.anim).toBe("none");
      else expect(etat.anim).not.toBe("none");
      const duree = await zoneJaune(guide).getByRole("button", { name: "Soleil sur forêt" }).count();
      expect(duree).toBe(0);
      const transition = await zoneJaune(guide).getByRole("button", { name: "Rejoindre la partie" }).evaluate((el) => getComputedStyle(el).transitionDuration);
      if (reduit) expect(parseFloat(transition)).toBeLessThan(0.001);
    });
  });
}

test("pas de débordement horizontal, dialogue ouvert compris", async ({ guide }) => {
  const largeur = guide.viewportSize()!.width;
  expect(await guide.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largeur);
  await zoneJaune(guide).getByRole("button", { name: "Ouvrir la feuille" }).click();
  expect(await guide.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largeur);
  const debordeurs = await guide.evaluate(() => {
    const l = document.documentElement.clientWidth;
    return [...document.querySelectorAll("main *")]
      .filter((e) => !e.closest("dialog:not([open])") && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > l + 1)
      .map((e) => e.tagName + "." + String(e.className).slice(0, 40));
  });
  expect(debordeurs).toEqual([]);
});
