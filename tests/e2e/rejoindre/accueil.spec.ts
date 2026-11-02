import { expect, test } from "@playwright/test";
import { anneau, interactifs, mouvement, pret, sansViolation } from "./aide";

test.describe("accueil (écran a)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await pret(page);
  });

  test("structure fidèle à l'écran a : titres, pilules, étapes, appel à animer", async ({ page }) => {
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/QUIZ\s*DES\s*ZÈLES/);
    await expect(page.getByText("QUIZ BIBLIQUES EN DIRECT")).toBeVisible();
    await expect(page.getByText(/ON\s*JOUE/).first()).toBeVisible();

    const titres = await page.getByRole("heading", { level: 2 }).allTextContents();
    expect(titres).toEqual(["Tu as un code ?", "Comment ça marche", "Envie d'animer ?"]);
    const etapes = await page.locator("#comment-ca-marche li h3").allTextContents();
    expect(etapes).toEqual(["Créer", "Partager", "Jouer"]);
    await expect(page.getByText("Pas d'installation, pas de compte pour jouer")).toBeVisible();
    await expect(page.getByPlaceholder("ABC234")).toBeVisible();

    // Ordre vertical de la maquette : héros, pilules, ticket, étapes, appel à animer, pied de page.
    const ordre = await page.evaluate(() => {
      const y = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
      const pilule = [...document.querySelectorAll("span, p")].find((e) => e.textContent?.trim() === "Jouer" && e.children.length === 0)!;
      return [y("h1"), pilule.getBoundingClientRect().top, y("#code-accueil"), y("#comment-ca-marche"), y("footer")];
    });
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
  });

  test("fond jaune soleil, ticket vert forêt, titre en police d'affiche", async ({ page }) => {
    const mesure = await page.evaluate(() => {
      const couleur = (nom: string) => {
        document.body.insertAdjacentHTML("beforeend", `<div class="${nom}"></div>`);
        const s = document.body.lastElementChild!;
        const c = getComputedStyle(s).backgroundColor;
        s.remove();
        return c;
      };
      let ticket: Element | null = document.querySelector("#code-accueil")!.closest("form");
      while (ticket && getComputedStyle(ticket).backgroundColor === "rgba(0, 0, 0, 0)") ticket = ticket.parentElement;
      return {
        fond: getComputedStyle(document.documentElement).backgroundColor,
        jaune: couleur("bg-jaune-soleil"),
        ticket: getComputedStyle(ticket!).backgroundColor,
        foret: couleur("bg-vert-foret"),
        police: getComputedStyle(document.querySelector("h1")!).fontFamily,
      };
    });
    expect(mesure.fond).toBe(mesure.jaune);
    expect(mesure.ticket).toBe(mesure.foret);
    expect(mesure.police).toMatch(/Lilita One|Bangers/);
  });

  test("un seul îlot hydraté : celui du champ code", async ({ page }) => {
    const iles = await page.locator("astro-island").evaluateAll((els) => els.map((e) => e.getAttribute("component-url")));
    expect(iles).toHaveLength(1);
    expect(iles[0]).toContain("CodeAccueil");
  });

  test("sans JavaScript : contenu complet et liens fonctionnels", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#comment-ca-marche li")).toHaveCount(3);
    await page.getByRole("link", { name: "Créer un compte" }).click();
    await expect(page).toHaveURL(/\/connexion/);
    await ctx.close();
  });

  test("pilules décoratives : ni lien, ni bouton, ni dans l'ordre de tabulation", async ({ page }) => {
    for (const nom of ["Jouer", "Apprendre", "Partager"]) {
      const pilule = page.locator("section span, section p").filter({ hasText: new RegExp(`^${nom}$`) }).first();
      await expect(pilule).toBeVisible();
      expect(await pilule.evaluate((el) => !!el.closest("a, button, [tabindex], [role=button], [role=link]"))).toBe(false);
    }
    // Aucune pilule dans le parcours clavier : on tabule jusqu'au champ code sans croiser leur texte.
    const vus: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      vus.push(await page.evaluate(() => (document.activeElement?.textContent ?? "").trim() || document.activeElement?.id || ""));
    }
    expect(vus.join("|")).not.toMatch(/Apprendre|Partager/);
    expect(vus).toContain("code-accueil");
  });

  test("« Envie d'animer ? » mène à /connexion", async ({ page }) => {
    const lien = page.getByRole("link", { name: "Créer un compte" });
    await expect(lien).toHaveAttribute("href", "/connexion");
    await lien.click();
    await expect(page).toHaveURL(/\/connexion$/);
  });

  test("le bouton du header renvoie au champ code", async ({ page }) => {
    const lien = page.getByRole("banner").getByRole("link", { name: "Rejoindre" });
    await expect(lien).toHaveAttribute("href", "#code-accueil");
    await lien.click();
    await expect(page).toHaveURL(/#code-accueil$/);
    // Le défilement peut être animé : on attend qu'il se stabilise.
    await expect
      .poll(() => page.locator("#code-accueil").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= -1 && r.bottom <= window.innerHeight;
      }))
      .toBe(true);
  });

  test("le logo ramène à l'accueil", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Accueil Quizdeszeles" })).toHaveAttribute("href", "/");
  });

  test("saisie : normalisée, bornée à 6, validation vide et incomplète, puis /j/<CODE>", async ({ page }) => {
    const champ = page.getByLabel("Code de la partie");
    const valider = page.getByRole("button", { name: "Rejoindre la partie" });

    await valider.click();
    await expect(page.getByRole("alert")).toHaveText("Saisis le code donné par l'animateur.");
    await expect(champ).toHaveAttribute("aria-invalid", "true");
    expect(await champ.getAttribute("aria-describedby")).toBe(await page.getByRole("alert").getAttribute("id"));

    await champ.fill("abc");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await valider.click();
    await expect(page.getByRole("alert")).toHaveText("Le code fait 6 caractères.");
    await expect(page).toHaveURL(/\/$/);

    await champ.fill("a0o1i-b c_é2x9z-trop-long");
    // 0, O, 1, I et les séparateurs sont retirés ; é devient E ; tronqué à 6.
    await expect(champ).toHaveValue("ABCE2X");
    await champ.press("Enter");
    await expect(page).toHaveURL(/\/j\/ABCE2X$/);
  });

  test("après validation, le bouton passe en chargement (aria-busy) avant la navigation", async ({ page }) => {
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector("form button[aria-busy=true]")) sessionStorage.setItem("occupe", "1");
      }).observe(document, { subtree: true, attributes: true, childList: true });
    });
    await page.route("**/j/ABCDEF", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.goto("/");
    await pret(page);
    await page.getByLabel("Code de la partie").fill("ABCDEF");
    await page.getByRole("button", { name: "Rejoindre la partie" }).click();
    await expect(page).toHaveURL(/\/j\/ABCDEF$/);
    expect(await page.evaluate(() => sessionStorage.getItem("occupe"))).toBe("1");
  });

  test("axe, cibles de 44 px, focus visible, pas de débordement", async ({ page }) => {
    await sansViolation(page);
    const petits = (await interactifs(page)).filter((e) => e.h < 44 || e.l < 44);
    expect(petits).toEqual([]);

    const largeur = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largeur);

    const sansAnneau: string[] = [];
    const cibles = [
      page.getByRole("link", { name: "Accueil Quizdeszeles" }),
      page.getByRole("banner").getByRole("link", { name: "Rejoindre" }),
      page.getByLabel("Code de la partie"),
      page.getByRole("button", { name: "Rejoindre la partie" }),
      page.getByRole("link", { name: "Créer un compte" }),
    ];
    for (const cible of cibles) {
      const o = await anneau(page, cible);
      if (!o.fv || o.style === "none" || o.largeur < 2) sansAnneau.push(await cible.innerText());
    }
    expect(sansAnneau).toEqual([]);
  });

  test("mouvement réduit : aucune animation en cours, axe toujours à 0", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto("/");
    await pret(page);
    expect(await mouvement(page)).toEqual({ keyframes: [], transitionsLongues: 0, animationsEnCours: 0 });
    await sansViolation(page);
    await ctx.close();
  });
});
