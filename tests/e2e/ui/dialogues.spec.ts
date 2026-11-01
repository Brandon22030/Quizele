import type { Locator, Page } from "@playwright/test";
import { couleurJeton, expect, test, zoneForet, zoneJaune } from "./aide";

const cas = [
  { nom: "Feuille", ouvrir: "Ouvrir la feuille", titre: "Tes questions" },
  { nom: "Modal", ouvrir: "Ouvrir la modale", titre: "Supprimer ce quiz ?" },
] as const;

const dansDialogue = (page: Page) => page.evaluate(() => !!document.activeElement?.closest("dialog[open]"));
// Un dialogue modal natif laisse le focus sortir vers l'interface du navigateur (activeElement retombe alors sur body) puis le
// ramène dans le dialogue : le piège tient si aucun élément de la page derrière n'est jamais atteint.
const piegeIntact = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a === document.body || !!a?.closest("dialog[open]");
  });

for (const [nomZone, zone] of [
  ["fond jaune", zoneJaune],
  ["fond forêt", zoneForet],
] as const) {
  for (const c of cas) {
    test.describe(`${c.nom} (${nomZone})`, () => {
      let declencheur: Locator;
      let dialogue: Locator;
      test.beforeEach(async ({ guide }) => {
        declencheur = zone(guide).getByRole("button", { name: c.ouvrir });
        dialogue = zone(guide).getByRole("dialog", { name: c.titre });
      });

      test("fermé par défaut, s'ouvre en modal avec le titre comme nom accessible", async ({ guide }) => {
        await expect(dialogue).toBeHidden();
        await declencheur.click();
        await expect(dialogue).toBeVisible();
        expect(await dialogue.evaluate((d: HTMLDialogElement) => d.matches(":modal"))).toBe(true);
        expect(await dansDialogue(guide)).toBe(true);
      });

      test("focus piégé avec Tab et Maj+Tab", async ({ guide }) => {
        await declencheur.click();
        await expect(dialogue).toBeVisible();
        const nbTabulables = await dialogue.evaluate(
          (d) => d.querySelectorAll("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])").length,
        );
        expect(nbTabulables).toBeGreaterThanOrEqual(2);
        const visites = new Set<string>();
        for (let i = 0; i < nbTabulables * 3 + 2; i++) {
          await guide.keyboard.press("Tab");
          expect(await piegeIntact(guide), `Tab ${i + 1}`).toBe(true);
          visites.add(await guide.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 30) ?? ""));
        }
        for (let i = 0; i < nbTabulables * 3 + 2; i++) {
          await guide.keyboard.press("Shift+Tab");
          expect(await piegeIntact(guide), `Maj+Tab ${i + 1}`).toBe(true);
        }
        // Le cycle repasse bien par chaque élément du dialogue (Fermer inclus).
        expect(visites.has("Fermer")).toBe(true);
        expect(visites.size).toBeGreaterThanOrEqual(nbTabulables);
      });

      test("le reste de la page est inerte", async ({ guide }) => {
        await declencheur.click();
        const surPage = await guide.evaluate(() => {
          const autre = document.querySelector<HTMLElement>("main h1");
          const bouton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.closest("dialog"));
          bouton?.focus();
          return { focusSurPage: !document.activeElement?.closest("dialog[open]") && document.activeElement !== document.body, h1: !!autre };
        });
        expect(surPage.focusSurPage).toBe(false);
      });

      test("Échap ferme et rend le focus au déclencheur", async ({ guide }) => {
        await declencheur.click();
        await expect(dialogue).toBeVisible();
        await guide.keyboard.press("Escape");
        await expect(dialogue).toBeHidden();
        await expect(declencheur).toBeFocused();
        // Réouvrable après fermeture.
        await declencheur.click();
        await expect(dialogue).toBeVisible();
      });

      test("le bouton Fermer ferme et rend le focus", async () => {
        await declencheur.click();
        await dialogue.getByRole("button", { name: "Fermer" }).click();
        await expect(dialogue).toBeHidden();
        await expect(declencheur).toBeFocused();
      });

      test("clic sur le fond ferme, clic dans le contenu non", async ({ guide }) => {
        await declencheur.click();
        await expect(dialogue).toBeVisible();
        await dialogue.getByRole("heading").click();
        await expect(dialogue).toBeVisible();
        const boite = (await dialogue.boundingBox())!;
        const vue = guide.viewportSize()!;
        // Point du fond le plus éloigné de la boîte du dialogue.
        const x = boite.x > 10 ? 4 : vue.width - 4;
        const y = boite.y > 10 ? 4 : vue.height - 4;
        await guide.mouse.click(boite.y > 10 || boite.x > 10 ? x : 4, y);
        await expect(dialogue).toBeHidden();
        await expect(declencheur).toBeFocused();
      });

      test("anneau de focus vert forêt sur papier crème, même sous thème forêt", async ({ guide }) => {
        await declencheur.click();
        await expect(dialogue).toBeVisible();
        const vertForet = await couleurJeton(guide, "vert-foret");
        const creme = await couleurJeton(guide, "creme");
        const style = await dialogue.evaluate((d) => {
          const cs = getComputedStyle(d);
          return { fond: cs.backgroundColor, texte: cs.color };
        });
        expect(style).toEqual({ fond: creme, texte: vertForet });
        const bouton = dialogue.getByRole("button", { name: "Fermer" });
        await bouton.focus();
        await guide.keyboard.press("Shift+Tab");
        await guide.keyboard.press("Tab");
        await expect(bouton).toBeFocused();
        const anneau = await bouton.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { style: cs.outlineStyle, couleur: cs.outlineColor, matches: el.matches(":focus-visible") };
        });
        expect(anneau.matches).toBe(true);
        expect(anneau.style).toBe("solid");
        expect(anneau.couleur).toBe(vertForet);
      });
    });
  }
}

test("Feuille : ancrée en bas, pleine largeur ; Modal : centrée", async ({ guide }) => {
  const vue = guide.viewportSize()!;
  const z = zoneJaune(guide);
  await z.getByRole("button", { name: "Ouvrir la feuille" }).click();
  const feuille = z.getByRole("dialog", { name: "Tes questions" });
  const f = (await feuille.boundingBox())!;
  expect(Math.round(f.y + f.height)).toBe(vue.height);
  expect(Math.round(f.width)).toBe(vue.width);
  await guide.keyboard.press("Escape");
  await z.getByRole("button", { name: "Ouvrir la modale" }).click();
  const m = (await z.getByRole("dialog", { name: "Supprimer ce quiz ?" }).boundingBox())!;
  expect(Math.abs(m.x + m.width / 2 - vue.width / 2)).toBeLessThan(2);
  expect(Math.abs(m.y + m.height / 2 - vue.height / 2)).toBeLessThan(2);
});

test("le défilement de la page n'est pas verrouillé par le dialogue (non prévu, constat)", async ({ guide }) => {
  await zoneJaune(guide).getByRole("button", { name: "Ouvrir la modale" }).click();
  const overflow = await guide.evaluate(() => [getComputedStyle(document.body).overflow, getComputedStyle(document.documentElement).overflow]);
  expect(overflow).toEqual(["visible", "visible"]);
});
