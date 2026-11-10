import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { URL_DEV } from "../serveurs";

// Serveur de développement partagé avec tests/e2e/ui (voir playwright.config.ts) : la planche n'existe qu'en DEV.
const URL = `${URL_DEV}/dev/styleguide-jeu`;

async function ouvrir(page: Page) {
  await page.goto(URL);
  await hydrate(page);
}

// Îlot Astro hydraté : l'attribut `ssr` disparaît de <astro-island> une fois React monté.
async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
}

const cases = (page: Page) => page.locator("#code").getByRole("textbox");

test.describe("Chrono", () => {
  test("couleurs calme / mangue / piment et « Temps écoulé » à zéro", async ({ page }) => {
    await ouvrir(page);
    const timers = page.locator("#chrono").getByRole("timer");
    const couleur = async (i: number) => timers.nth(i).locator("span.forme-explosion").evaluate((el) => getComputedStyle(el).backgroundColor);
    const jeton = (nom: string) =>
      page.evaluate((n) => {
        const s = document.createElement("div");
        s.className = `bg-${n}`;
        document.body.appendChild(s);
        const c = getComputedStyle(s).backgroundColor;
        s.remove();
        return c;
      }, nom);
    expect(await couleur(0)).toBe(await jeton("creme"));
    expect(await couleur(1)).toBe(await jeton("mangue"));
    expect(await couleur(2)).toBe(await jeton("piment"));
    await expect(timers.nth(0)).toHaveAttribute("aria-label", "14 secondes restantes");
    await expect(timers.nth(3)).toHaveAttribute("aria-label", "Temps écoulé");
    await expect(timers.nth(3)).toContainText("Temps écoulé");
  });

  test("chrono en direct : expire à 12 s, une annonce par palier seulement", async ({ page }) => {
    await page.clock.install();
    await page.goto(URL);
    await hydrate(page);
    const live = page.locator("#chrono").getByRole("timer").nth(4);
    const statut = live.getByRole("status");
    const textes = new Set<string>();
    let changements = 0;
    let dernier = "";
    for (let s = 0; s < 14; s++) {
      const t = (await statut.textContent()) ?? "";
      if (t !== dernier) {
        changements++;
        dernier = t;
        textes.add(t);
      }
      await page.clock.runFor(1000);
    }
    // 12 s -> annonces à 12, 10, 5, 0 : jamais une par seconde.
    expect(changements).toBeLessThanOrEqual(4);
    expect(dernier).toBe("Temps écoulé");
    await expect(live).toHaveAttribute("aria-label", "Temps écoulé");
  });

  test("tremblement présent sous 5 s, absent sous prefers-reduced-motion", async ({ page }) => {
    await ouvrir(page);
    const critique = page.locator("#chrono").getByRole("timer").nth(2).locator(".forme-explosion").first();
    await expect(critique).toHaveClass(/animate-tremble/);
    const anim = () => critique.evaluate((el) => getComputedStyle(el).animationName);
    expect(await anim()).not.toBe("none");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await hydrate(page);
    const apres = page.locator("#chrono").getByRole("timer").nth(2).locator(".forme-explosion").first();
    await expect(apres).not.toHaveClass(/animate-tremble/);
    expect(await apres.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});

test.describe("AnswerTile", () => {
  test("clavier : Tab, Entrée, Espace, aria-pressed et focus visible", async ({ page }) => {
    await ouvrir(page);
    const groupe = page.locator("#ecran-d").getByRole("group", { name: "Réponses" });
    const tuiles = groupe.getByRole("button");
    await expect(tuiles).toHaveCount(4);
    await expect(tuiles.nth(1)).toHaveAttribute("aria-pressed", "true");
    await tuiles.nth(0).focus();
    await page.keyboard.press("Enter");
    await expect(tuiles.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(tuiles.nth(1)).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Tab");
    await expect(tuiles.nth(1)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(tuiles.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(tuiles.nth(0)).toHaveAttribute("aria-pressed", "false");
    // Focus visible : un contour ou une ombre non nuls au focus clavier.
    const visible = await tuiles.nth(1).evaluate((el) => {
      const s = getComputedStyle(el);
      return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
    });
    expect(visible).toBe(true);
  });

  test("cibles tactiles d'au moins 44 px", async ({ page }) => {
    await ouvrir(page);
    const interactifs = page.locator("main").locator("button:visible, a[href]:visible, input:visible");
    const n = await interactifs.count();
    expect(n).toBeGreaterThan(8);
    const trop: string[] = [];
    for (let i = 0; i < n; i++) {
      const el = interactifs.nth(i);
      const box = await el.boundingBox();
      if (!box) continue;
      if (box.height < 44 || box.width < 44) trop.push(`${await el.evaluate((e) => e.outerHTML.slice(0, 80))} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    expect(trop).toEqual([]);
  });

  test("juste / taReponse non focusables, désactivée désactivée", async ({ page }) => {
    await ouvrir(page);
    const tuiles = page.locator("#tuiles").getByRole("group", { name: "États des tuiles" });
    await expect(tuiles.getByRole("button")).toHaveCount(3);
    await expect(tuiles.getByRole("button", { name: /Désactivée/ })).toBeDisabled();
    for (const nom of ["Juste", "Ta réponse"]) {
      const bloc = tuiles.locator("div", { hasText: new RegExp(`^.*${nom}`) }).last();
      expect(await bloc.evaluate((el) => el.tagName)).toBe("DIV");
      expect(await bloc.evaluate((el) => el.tabIndex)).toBe(-1);
    }
    // Aucun élément focusable dans les écrans de correction.
    await expect(page.locator("#ecran-e1 button, #ecran-e1 [tabindex='0']").filter({ hasNotText: /Continuer/ })).toHaveCount(0);
  });
});

test("choix multiple : « Valider la sélection » désactivé sans sélection", async ({ page }) => {
  await ouvrir(page);
  const zone = page.locator("#ecran-d2");
  const valider = zone.getByRole("button", { name: "Valider la sélection" });
  await expect(valider).toBeDisabled();
  await zone.getByRole("button", { name: /Matthieu/ }).click();
  await expect(valider).toBeEnabled();
  await expect(zone.getByText("1 réponse sélectionnée.")).toBeVisible();
  await zone.getByRole("button", { name: /Luc/ }).click();
  await expect(zone.getByText("2 réponses sélectionnées.")).toBeVisible();
  await zone.getByRole("button", { name: /Matthieu/ }).click();
  await zone.getByRole("button", { name: /Luc/ }).click();
  await expect(valider).toBeDisabled();
});

test.describe("CodeCases", () => {
  async function valeur(page: Page) {
    return (await cases(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join("");
  }
  const coller = (page: Page, index: number, texte: string) =>
    cases(page).nth(index).evaluate((el, t) => {
      const dt = new DataTransfer();
      dt.setData("text", t);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, texte);

  test("six cases, une seule dans l'ordre de tabulation", async ({ page }) => {
    await ouvrir(page);
    await expect(cases(page)).toHaveCount(6);
    const tabs = await cases(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).tabIndex));
    expect(tabs.filter((t) => t === 0)).toHaveLength(1);
  });

  test("collage : minuscules et accents normalisés, 6 caractères maximum", async ({ page }) => {
    await ouvrir(page);
    await coller(page, 0, " éK7q-2mz99 ");
    expect(await valeur(page)).toBe("EK7Q2M");
    await coller(page, 0, "abcdef");
    expect(await valeur(page)).toBe("ABCDEF");
    for (const c of await cases(page).all()) expect(await c.evaluate((e) => getComputedStyle(e).textTransform)).toBe("uppercase");
  });

  test("collage vide ou sans caractère valide : code inchangé", async ({ page }) => {
    await ouvrir(page);
    await coller(page, 0, "ABCDEF");
    await coller(page, 0, "!!! --- ???");
    expect(await valeur(page)).toBe("ABCDEF");
  });

  test("saisie clavier, retour arrière et flèches", async ({ page }) => {
    await ouvrir(page);
    await coller(page, 0, "ABCDEF");
    await cases(page).nth(5).focus();
    await page.keyboard.press("Backspace");
    expect(await valeur(page)).toBe("ABCDE");
    await page.keyboard.press("Backspace");
    expect(await valeur(page)).toBe("ABCD");
    await expect(cases(page).nth(4)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(cases(page).nth(3)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(cases(page).nth(4)).toBeFocused();
    await cases(page).nth(0).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(cases(page).nth(0)).toBeFocused();
    await cases(page).nth(5).focus();
    await page.keyboard.press("ArrowRight");
    await expect(cases(page).nth(5)).toBeFocused();
    // Saisie d'une minuscule accentuée dans la première case vide.
    await cases(page).nth(0).focus();
    await page.keyboard.press("Backspace");
    await page.keyboard.type("é");
    expect((await valeur(page))[0]).toBe("E");
  });

  test("focus jaune sur la case active", async ({ page }) => {
    await ouvrir(page);
    await cases(page).nth(1).focus();
    const [fond, jaune] = await Promise.all([
      cases(page).nth(1).evaluate((e) => getComputedStyle(e).backgroundColor),
      page.evaluate(() => {
        const s = document.createElement("div");
        s.style.backgroundColor = "var(--color-jaune-soleil)";
        document.body.appendChild(s);
        const c = getComputedStyle(s).backgroundColor;
        s.remove();
        return c;
      }),
    ]);
    expect(fond).toBe(jaune);
  });

  // Le code serveur (generateGameCode, QZ-002-03) exclut 0, O, 1 et I : la saisie doit les refuser ou le commentaire
  // « même alphabet que le code serveur » est faux.
  test("caractères interdits par l'alphabet serveur (0, O, 1, I)", async ({ page }) => {
    await ouvrir(page);
    await coller(page, 0, "0O1IAB");
    expect(await valeur(page)).not.toMatch(/[01OI]/);
  });
});

test("correction masquée : aucun indice de justesse dans le DOM", async ({ page }) => {
  await ouvrir(page);
  const zone = page.locator("#masquee");
  const html = (await zone.locator("> div").innerHTML()).toLowerCase();
  for (const mot of ["juste", "bonne", "faux", "pas cette fois", "bien joué", "vert-eclat", "piment", "bg-vert-nuit"]) {
    expect(html, `indice « ${mot} »`).not.toContain(mot);
  }
  expect(html).not.toMatch(/\bcorrect\b|taréponse|data-correct|aria-invalid/);
  await expect(zone.getByText("Réponse enregistrée")).toBeVisible();
  await expect(zone.locator("[aria-invalid], [data-correct]")).toHaveCount(0);
});

test("verdict : jamais « Faux » seul comme titre", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#ecran-e1").getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  await expect(page.locator("#ecran-e2").getByRole("heading", { name: /PAS CETTE\s*FOIS !/ })).toBeVisible();
  for (const h of await page.getByRole("heading").all()) {
    expect(((await h.textContent()) ?? "").trim().toLowerCase()).not.toBe("faux");
  }
  // Le message de la correction « pas cette fois » ne doit pas non plus ouvrir sur « Faux ».
  const message = await page.locator("#ecran-e2 section > p").innerText();
  expect(message).not.toMatch(/^\s*faux\b/i);
});

test("statuts terminaux et connexion", async ({ page }) => {
  await ouvrir(page);
  const z = page.locator("#statuts");
  await expect(z.getByText("Connexion…", { exact: true })).toBeVisible();
  await expect(z.getByText("Connexion perdue, reprise en cours…")).toBeVisible();
  await expect(z.getByRole("heading", { name: "Tu as été retiré de la partie" })).toBeVisible();
  await expect(z.getByRole("heading", { name: "Partie terminée" })).toBeVisible();
  await expect(z.getByRole("heading", { name: "Lien invalide" })).toBeVisible();
  await expect(z.getByRole("link", { name: "Saisir un code" })).toHaveCount(3);
  await expect(z.getByRole("alert")).toHaveCount(3);
});

for (const reduced of [false, true]) {
  test(`axe : 0 violation, sans débordement horizontal (reduced-motion ${reduced})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.clock.install();
    await ouvrir(page);
    // Animations figées : un contraste ne doit pas être mesuré en plein fondu.
    await page.clock.runFor(3000);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`)).toEqual([]);
    const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(debord).toBeLessThanOrEqual(0);
  });
}

test("chrono en direct : une seule expiration par horloge, relancer repart de 12 s", async ({ page }) => {
  await page.clock.install();
  await page.goto(URL);
  await hydrate(page);
  const zone = page.locator("#chrono");
  const live = zone.getByRole("timer").nth(4);
  const relancer = zone.getByRole("button", { name: "Relancer le chrono" });
  await expect(relancer).toHaveCount(0);
  await page.clock.runFor(13_000);
  await expect(live).toHaveAttribute("aria-label", "Temps écoulé");
  await expect(relancer).toHaveCount(1);
  // Le temps continue de passer : aucun second déclenchement ne doit faire réapparaître ou dupliquer quoi que ce soit.
  await page.clock.runFor(30_000);
  await expect(relancer).toHaveCount(1);
  await relancer.click();
  await expect(relancer).toHaveCount(0);
  await expect(live).toHaveAttribute("aria-label", /secondes? restantes?/);
  await page.clock.runFor(13_000);
  await expect(live).toHaveAttribute("aria-label", "Temps écoulé");
  await expect(relancer).toHaveCount(1);
});

test("correction masquée : aucune pilule de score dans l'en-tête", async ({ page }) => {
  await ouvrir(page);
  const zone = page.locator("#masquee");
  await expect(zone.getByText(/Question 3 sur 10/)).toBeVisible();
  await expect(zone.getByText(/juste/i)).toHaveCount(0);
  await expect(zone.getByText("Ton score")).toHaveCount(0);
  // Contrôle : l'écran de question, lui, affiche bien le score.
  await expect(page.locator("#ecran-d").getByText("2 justes")).toHaveCount(1);
});

test("statuts : la région status est présente dès le départ et reçoit le texte sans être recréée", async ({ page }) => {
  await ouvrir(page);
  const regions = page.locator("#statuts [role=status]");
  await expect(regions).toHaveCount(5);
  await expect(regions.nth(0)).toContainText("Connexion…");
  await expect(regions.nth(1)).toContainText("Connexion perdue");
  // Statuts terminaux : région vide, l'alerte est à part.
  for (const i of [2, 3, 4]) await expect(regions.nth(i)).toHaveText("");
});

test("clavier Android : un change vide efface la case, sans keydown Backspace", async ({ page }) => {
  await ouvrir(page);
  const cases = page.locator("#code").getByRole("textbox");
  await cases.nth(0).evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text", "K7Q2M3");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(cases.nth(1)).toHaveValue("7");
  await cases.nth(1).fill("");
  const v = async () => (await cases.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join("");
  await expect.poll(v).toBe("KQ2M3");
  await cases.nth(4).fill("");
  await expect.poll(v).toBe("KQ2M");
});

test("alphabet : saisie clavier de 0, O, 1, I ignorée", async ({ page }) => {
  await ouvrir(page);
  const cases = page.locator("#code").getByRole("textbox");
  const v = async () => (await cases.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join("");
  // Le code de la planche est prérempli : on le vide d'abord.
  await cases.nth(4).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
  await expect.poll(v).toBe("");
  await cases.nth(0).focus();
  await page.keyboard.type("K0O1I7");
  await expect.poll(v).toBe("K7");
});
