import { expect, test, type Page } from "@playwright/test";
import { anneau, interactifs, mouvement, pret, reponseJson, sansApercuServeur, sansViolation } from "./aide";

test.beforeEach(async ({ page }) => sansApercuServeur(page));

const cases = (page: Page) => page.getByRole("group", { name: "Code de la partie" }).getByRole("textbox");
const valeurCode = async (page: Page) => (await cases(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join("");
const pseudo = (page: Page) => page.getByLabel("Pseudo");
const envoyer = (page: Page) => page.getByRole("button", { name: /^(Rejoindre|Inscription en cours)$/ });

async function ouvrir(page: Page, chemin: string) {
  await page.goto(chemin);
  await pret(page);
}

test.describe("/j/<code> : code prérempli", () => {
  for (const [url, attendu] of [
    ["/j/ABCDEF", "ABCDEF"],
    ["/j/abcdef", "ABCDEF"],
    ["/j/a%20b-c_d.e%C3%A9", "ABCDEE"],
    ["/j/a0o1i2", "A2"],
    ["/j/K7Q", "K7Q"],
    ["/j/%F0%9F%98%80", ""],
    ["/j/ABCDEFGH", "ABCDEF"],
  ] as const) {
    test(`${url} -> « ${attendu} »`, async ({ page }) => {
      await ouvrir(page, url);
      await expect(cases(page)).toHaveCount(6);
      expect(await valeurCode(page)).toBe(attendu);
    });
  }

  test("code complet : le focus va au pseudo ; code incomplet : à la première case", async ({ page }) => {
    await ouvrir(page, "/j/ABCDEF");
    await expect(pseudo(page)).toBeFocused();
    await ouvrir(page, "/j/AB");
    await expect(cases(page).first()).toBeFocused();
  });

  test("code absent ou incomplet : état vide avec aide, rien n'est envoyé", async ({ page }) => {
    let appels = 0;
    await page.route("**/api/parties/**", (r) => (appels++, r.abort()));
    await ouvrir(page, "/j/K7Q");
    await expect(page.getByText("Tu peux aussi coller le code entier.")).toBeVisible();
    await ouvrir(page, "/j/%F0%9F%98%80");
    await expect(page.getByText("Le code est affiché sur l'écran de l'animateur.")).toBeVisible();
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page.getByText("Le code fait 6 caractères.")).toBeVisible();
    expect(appels).toBe(0);
  });

  test("on peut compléter le code à la main, coller le code entier, puis s'inscrire", async ({ page }) => {
    await page.route("**/api/parties/K7Q2MB/joueurs", reponseJson(201, { playerId: "p9", token: "t9" }));
    await page.route("**/j/K7Q2MB/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await ouvrir(page, "/j/K7Q");
    await cases(page).nth(3).focus();
    await page.keyboard.type("2mb");
    expect(await valeurCode(page)).toBe("K7Q2MB");
    await cases(page).first().focus();
    await cases(page).first().evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text", "zzz-abc234");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    expect(await valeurCode(page)).toBe("ZZZABC");
  });
});

test.describe("/j/<code> : pseudo", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/parties/ABCDEF/joueurs", (r) => {
      (page as unknown as { __appels: number }).__appels = ((page as unknown as { __appels?: number }).__appels ?? 0) + 1;
      return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ playerId: "p1", token: "tok" }) });
    });
    await page.route("**/j/ABCDEF/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await ouvrir(page, "/j/ABCDEF");
  });
  const appels = (page: Page) => (page as unknown as { __appels?: number }).__appels ?? 0;

  test("vide ou espaces : message, aria-invalid, aucune requête", async ({ page }) => {
    await envoyer(page).click();
    const alerte = page.getByRole("alert").filter({ hasText: "Ce pseudo n'est pas valide" });
    await expect(alerte).toBeVisible();
    await expect(pseudo(page)).toHaveAttribute("aria-invalid", "true");
    await expect(pseudo(page)).toHaveAccessibleDescription(/Ce pseudo n'est pas valide.*20 caractères maximum/);
    await pseudo(page).fill("    ");
    await envoyer(page).click();
    await expect(alerte).toBeVisible();
    expect(appels(page)).toBe(0);
  });

  test("l'erreur disparaît quand on retape", async ({ page }) => {
    await envoyer(page).click();
    await pseudo(page).fill("L");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(pseudo(page)).not.toHaveAttribute("aria-invalid", "true");
  });

  test("21 caractères : refusé, 20 : accepté", async ({ page }) => {
    await pseudo(page).fill("a".repeat(21));
    await envoyer(page).click();
    await expect(page.getByText("Ce pseudo n'est pas valide")).toBeVisible();
    expect(appels(page)).toBe(0);
    await pseudo(page).fill("a".repeat(20));
    await envoyer(page).click();
    await expect(page).toHaveURL(/\/jouer$/);
    expect(appels(page)).toBe(1);
  });

  test("emoji : accepté et transmis tel quel ; 21 emojis refusés (les graphèmes comptent, pas les unités)", async ({ page }) => {
    await pseudo(page).fill("🙂".repeat(21));
    await envoyer(page).click();
    await expect(page.getByText("Ce pseudo n'est pas valide")).toBeVisible();
    expect(appels(page)).toBe(0);

    let corps = "";
    await page.route("**/api/parties/ABCDEF/joueurs", (r) => {
      corps = r.request().postData() ?? "";
      return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ playerId: "p1", token: "tok" }) });
    });
    await pseudo(page).fill("Léa 🙂👨‍👩‍👧");
    await envoyer(page).click();
    await expect(page).toHaveURL(/\/jouer$/);
    expect(JSON.parse(corps)).toEqual({ pseudo: "Léa 🙂👨‍👩‍👧" });
  });

  test("caractère de contrôle ou invisible seul : refusé", async ({ page }) => {
    await pseudo(page).fill("​​");
    await envoyer(page).click();
    await expect(page.getByText("Ce pseudo n'est pas valide")).toBeVisible();
    expect(appels(page)).toBe(0);
  });
});

test.describe("/j/<code> : erreurs de l'API", () => {
  const cas = [
    { status: 400, error: "invalid_pseudo", message: "Ce pseudo n'est pas valide. Choisis-en un de 1 à 20 caractères.", pres: "pseudo" },
    { status: 409, error: "pseudo_taken", message: "Ce pseudo est déjà pris dans cette partie. Choisis-en un autre.", pres: "pseudo" },
    { status: 409, error: "game_full", message: "Cette partie est pleine. Demande à l'animateur de faire de la place.", pres: "bloc" },
    { status: 404, error: "game_not_found", message: "Aucune partie ne correspond à ce code. Vérifie-le auprès de l'animateur.", pres: "bloc" },
    { status: 410, error: "game_finished", message: "Cette partie est terminée. Demande un nouveau code à l'animateur.", pres: "bloc" },
    { status: 500, error: "server_misconfigured", message: "Un problème est survenu. Réessaie dans un instant.", pres: "bloc" },
  ] as const;

  for (const c of cas) {
    test(`${c.status} ${c.error} : message français, formulaire réutilisable, pas de jeton`, async ({ page }) => {
      await page.route("**/api/parties/ABCDEF/joueurs", reponseJson(c.status, { error: c.error }));
      await ouvrir(page, "/j/ABCDEF");
      await pseudo(page).fill("Léa");
      await envoyer(page).click();
      await expect(page.getByRole("alert").filter({ hasText: c.message })).toBeVisible();
      await expect(page).toHaveURL(/\/j\/ABCDEF$/);
      await expect(envoyer(page)).toBeEnabled();
      await expect(envoyer(page)).not.toHaveAttribute("aria-busy", "true");
      expect(await page.evaluate(() => localStorage.length)).toBe(0);
      if (c.pres === "pseudo") await expect(pseudo(page)).toHaveAttribute("aria-invalid", "true");
      await sansViolation(page);
    });
  }

  test("500 avec corps HTML (page d'erreur du serveur) : message générique", async ({ page }) => {
    await page.route("**/api/parties/ABCDEF/joueurs", (r) => r.fulfill({ status: 500, contentType: "text/html", body: "<h1>Boom</h1>" }));
    await ouvrir(page, "/j/ABCDEF");
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page.getByText("Un problème est survenu. Réessaie dans un instant.")).toBeVisible();
  });

  test("201 avec corps invalide : pas de redirection, message générique", async ({ page }) => {
    await page.route("**/api/parties/ABCDEF/joueurs", reponseJson(201, { playerId: 1 }));
    await ouvrir(page, "/j/ABCDEF");
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page.getByText("Un problème est survenu.")).toBeVisible();
    await expect(page).toHaveURL(/\/j\/ABCDEF$/);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
  });

  test("réseau coupé : message, « Réessayer » relance, puis succès", async ({ page }) => {
    let essais = 0;
    await page.route("**/api/parties/ABCDEF/joueurs", (r) => {
      essais++;
      return essais === 1 ? r.abort("connectionrefused") : r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ playerId: "p1", token: "tok" }) });
    });
    await page.route("**/j/ABCDEF/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await ouvrir(page, "/j/ABCDEF");
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page.getByText("Connexion impossible. Vérifie ton réseau puis réessaie.")).toBeVisible();
    await expect(pseudo(page)).toHaveValue("Léa");
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(page).toHaveURL(/\/j\/ABCDEF\/jouer$/);
    expect(essais).toBe(2);
  });

  test("les erreurs de code n'ont pas de « Réessayer »", async ({ page }) => {
    await page.route("**/api/parties/ABCDEF/joueurs", reponseJson(404, { error: "game_not_found" }));
    await ouvrir(page, "/j/ABCDEF");
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "Aucune partie" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Réessayer" })).toHaveCount(0);
  });
});

test.describe("/j/<code> : inscription et jeton", () => {
  test("un double clic ne crée qu'une inscription, bouton et champ verrouillés pendant l'envoi", async ({ page }) => {
    let appels = 0;
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const bouton = document.querySelector("form button[aria-busy=true]");
        const champ = document.querySelector<HTMLInputElement>("input[autocomplete=nickname]");
        if (bouton && champ?.disabled) sessionStorage.setItem("verrouille", "1");
      }).observe(document, { subtree: true, attributes: true, childList: true });
    });
    await page.route("**/api/parties/ABCDEF/joueurs", async (r) => {
      appels++;
      await new Promise((ok) => setTimeout(ok, 700));
      await r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ playerId: "p1", token: "tok" }) });
    });
    await page.route("**/j/ABCDEF/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await ouvrir(page, "/j/ABCDEF");
    await pseudo(page).fill("Léa");
    await envoyer(page).dblclick();
    await expect(page).toHaveURL(/\/jouer$/);
    expect(appels).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem("verrouille"))).toBe("1");
  });

  test("Entrée dans le pseudo envoie aussi une seule fois", async ({ page }) => {
    let appels = 0;
    await page.route("**/api/parties/ABCDEF/joueurs", async (r) => {
      appels++;
      await r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ playerId: "p1", token: "tok" }) });
    });
    await page.route("**/j/ABCDEF/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await ouvrir(page, "/j/ABCDEF");
    await pseudo(page).fill("Léa");
    await pseudo(page).press("Enter");
    await expect(page).toHaveURL(/\/jouer$/);
    expect(appels).toBe(1);
  });

  test("jeton stocké sous quizdeszeles:jeton:<CODE> (majuscules), seule clé écrite, valeur {playerId, token}", async ({ page }) => {
    await page.route("**/api/parties/ABCDEF/joueurs", reponseJson(201, { playerId: "p1", token: "tok", extra: "ignoré" }));
    await page.route("**/j/ABCDEF/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await ouvrir(page, "/j/abcdef");
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page).toHaveURL(/\/j\/ABCDEF\/jouer$/);
    const stock = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    expect(stock).toEqual({ "quizdeszeles:jeton:ABCDEF": JSON.stringify({ playerId: "p1", token: "tok" }) });
  });

  test("l'inscription part vers l'API du bon code, en POST JSON", async ({ page }) => {
    let requete: { url: string; method: string; type: string | undefined } | null = null;
    await page.route("**/api/parties/*/joueurs", (r) => {
      requete = { url: new URL(r.request().url()).pathname, method: r.request().method(), type: r.request().headers()["content-type"] };
      return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ playerId: "p1", token: "tok" }) });
    });
    await page.route("**/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await ouvrir(page, "/j/k7q2mb");
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page).toHaveURL(/\/jouer$/);
    expect(requete).toEqual({ url: "/api/parties/K7Q2MB/joueurs", method: "POST", type: "application/json" });
  });

  test("jeton existant : redirection directe vers /jouer, sans afficher le formulaire ni appeler l'API", async ({ page }) => {
    let appels = 0;
    await page.route("**/api/parties/**", (r) => (appels++, r.abort()));
    await page.route("**/j/ABCDEF/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await page.addInitScript(() => localStorage.setItem("quizdeszeles:jeton:ABCDEF", JSON.stringify({ playerId: "p1", token: "tok" })));
    await page.goto("/j/abcdef");
    await expect(page).toHaveURL(/\/j\/ABCDEF\/jouer$/);
    expect(appels).toBe(0);
  });

  test("jeton d'une autre partie, ou corrompu : le formulaire s'affiche", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("quizdeszeles:jeton:ZZZZZZ", JSON.stringify({ playerId: "p1", token: "tok" }));
      localStorage.setItem("quizdeszeles:jeton:ABCDEF", "{pas du json");
    });
    await ouvrir(page, "/j/ABCDEF");
    await expect(pseudo(page)).toBeVisible();
    await expect(page).toHaveURL(/\/j\/ABCDEF$/);
  });

  test("stockage inaccessible : l'inscription réussie est signalée au lieu de rediriger vers un écran cassé", async ({ page }) => {
    await page.route("**/api/parties/ABCDEF/joueurs", reponseJson(201, { playerId: "p1", token: "tok" }));
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("quota", "QuotaExceededError");
      };
    });
    await ouvrir(page, "/j/ABCDEF");
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page.getByText("Un problème est survenu.")).toBeVisible();
    await expect(page).toHaveURL(/\/j\/ABCDEF$/);
  });
});

test.describe("/j/<code> : accessibilité", () => {
  test("axe, cibles de 44 px, pas de débordement, focus visible, états vide et erreur", async ({ page }) => {
    await page.route("**/api/parties/ABCDEF/joueurs", reponseJson(409, { error: "pseudo_taken" }));
    await ouvrir(page, "/j/K7Q");
    await sansViolation(page);
    const largeur = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largeur);
    expect((await interactifs(page)).filter((e) => e.h < 44 || e.l < 44)).toEqual([]);
    await envoyer(page).click();
    await sansViolation(page);

    await ouvrir(page, "/j/ABCDEF");
    const sansAnneau: string[] = [];
    const cibles = [page.getByRole("link", { name: "Retour à l'accueil" }), cases(page).last(), pseudo(page), envoyer(page)];
    for (const cible of cibles) {
      const o = await anneau(page, cible);
      if (!o.fv || o.style === "none" || o.largeur < 2) sansAnneau.push(await cible.evaluate((el) => el.getAttribute("aria-label") ?? el.id ?? el.tagName));
    }
    expect(sansAnneau).toEqual([]);
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "déjà pris" })).toBeVisible();
    await sansViolation(page);
  });

  test("mouvement réduit : pas d'animation, squelette de vérification compris", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await sansApercuServeur(page);
    await page.route("**/api/parties/ABCDEF/joueurs", async (r) => {
      await new Promise((ok) => setTimeout(ok, 500));
      await r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ playerId: "p1", token: "tok" }) });
    });
    await page.route("**/jouer", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "jeu" }));
    await ouvrir(page, "/j/ABCDEF");
    await pseudo(page).fill("Léa");
    await envoyer(page).click();
    await expect(page.getByRole("button", { name: "Inscription en cours" })).toBeVisible();
    expect(await mouvement(page)).toEqual({ keyframes: [], transitionsLongues: 0, animationsEnCours: 0 });
    await ctx.close();
  });
});
