import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DOSSIER = join(process.cwd(), "..", "Quizele", ".agents", "tasks", "QZ-002-astro-cloudflare", "captures");
mkdirSync(DOSSIER, { recursive: true });

async function pret(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function sansViolation(page: Page) {
  const resultat = await new AxeBuilder({ page }).analyze();
  expect(resultat.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
}

test("accueil : capture, axe et saisie du code", async ({ page }, info) => {
  await page.goto("/");
  await pret(page);
  await page.screenshot({ path: join(DOSSIER, `qz002-10-accueil-${info.project.name}.png`), fullPage: true });
  await sansViolation(page);

  const champ = page.getByLabel("Code de la partie");
  await page.getByRole("button", { name: "Rejoindre la partie" }).click();
  await expect(page.getByRole("alert")).toContainText("Saisis le code");
  await champ.fill("k7q-2mb");
  await expect(champ).toHaveValue("K7Q2MB");
  await page.getByRole("button", { name: "Rejoindre la partie" }).click();
  await expect(page).toHaveURL(/\/j\/K7Q2MB$/);
});

test("accueil : les pilules ne sont pas focusables", async ({ page }) => {
  await page.goto("/");
  await pret(page);
  const pilule = page.getByText("Apprendre", { exact: true });
  await expect(pilule).toBeVisible();
  expect(await pilule.evaluate((el) => el.matches("a, button, [tabindex]"))).toBe(false);
});

test("rejoindre : état vide, capture et axe", async ({ page }, info) => {
  await page.goto("/j/K7Q");
  await pret(page);
  await page.screenshot({ path: join(DOSSIER, `qz002-10-rejoindre-vide-${info.project.name}.png`), fullPage: true });
  await sansViolation(page);
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  const erreurCode = page.getByText("Le code fait 6 caractères.");
  await expect(erreurCode).toBeVisible();
  const idErreur = await erreurCode.getAttribute("id");
  expect(idErreur).toBeTruthy();
  expect(await page.getByLabel("Caractère 1 du code").getAttribute("aria-describedby")).toContain(idErreur!);
  await expect(page.getByText("Ce pseudo n'est pas valide")).toBeVisible();
});

test("rejoindre : code inconnu, erreur et capture", async ({ page }, info) => {
  // Réponse simulée : la base D1 locale de l'e2e n'a pas forcément ses migrations, ce test vise l'affichage.
  await page.route("**/api/parties/ZZZZZZ/joueurs", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "game_not_found" }) }),
  );
  await page.goto("/j/ZZZZZZ");
  await pret(page);
  await page.getByLabel("Pseudo").fill("Grâce_22");
  await page.screenshot({ path: join(DOSSIER, `qz002-10-rejoindre-rempli-${info.project.name}.png`), fullPage: true });
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Aucune partie ne correspond" })).toBeVisible();
  await page.screenshot({ path: join(DOSSIER, `qz002-10-rejoindre-erreur-${info.project.name}.png`), fullPage: true });
  await sansViolation(page);
});

test("rejoindre : erreur réseau avec réessai", async ({ page }, info) => {
  await page.route("**/api/parties/*/joueurs", (route) => route.abort());
  await page.goto("/j/ABCDEF");
  await pret(page);
  await page.getByLabel("Pseudo").fill("Léa");
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await page.screenshot({ path: join(DOSSIER, `qz002-10-rejoindre-reseau-${info.project.name}.png`), fullPage: true });
});

test("rejoindre : inscription réussie, jeton stocké puis reprise directe", async ({ page }) => {
  await page.route("**/api/parties/ABCDEF/joueurs", (route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ playerId: "p1", token: "tok" }) }),
  );
  await page.route("**/j/ABCDEF/jouer", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>jeu</title>jeu" }));
  await page.goto("/j/ABCDEF");
  await pret(page);
  await page.getByLabel("Pseudo").fill("Léa");
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(page).toHaveURL(/\/j\/ABCDEF\/jouer$/);
  expect(await page.evaluate(() => localStorage.getItem("quizdeszeles:jeton:ABCDEF"))).toBe(JSON.stringify({ playerId: "p1", token: "tok" }));

  await page.goto("/j/ABCDEF");
  await expect(page).toHaveURL(/\/j\/ABCDEF\/jouer$/);
});

test("accueil : l'anneau de focus du champ est jaune soleil sur le ticket forêt", async ({ page }) => {
  await page.goto("/");
  await pret(page);
  await page.keyboard.press("Tab");
  const champ = page.getByLabel("Code de la partie");
  for (let i = 0; i < 6 && !(await champ.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(champ).toBeFocused();
  const { anneau, jaune } = await page.evaluate(() => {
    const sonde = document.createElement("div");
    sonde.style.backgroundColor = "var(--color-jaune-soleil)";
    document.body.appendChild(sonde);
    const jaune = getComputedStyle(sonde).backgroundColor;
    sonde.remove();
    return { anneau: getComputedStyle(document.activeElement!).outlineColor, jaune };
  });
  expect(jaune).not.toBe("rgba(0, 0, 0, 0)");
  expect(anneau).toBe(jaune);
});

test("accueil : retour par le cache avant/arrière, le bouton n'est plus bloqué", async ({ page }) => {
  // Réponse 204 : la navigation ne remplace pas la page, qui reste dans l'état « envoi » comme après un retour par le cache.
  await page.route("**/j/K7Q2MB", (route) => route.fulfill({ status: 204 }));
  await page.goto("/");
  await pret(page);
  await page.getByLabel("Code de la partie").fill("K7Q2MB");
  await page.locator("form button[type=submit]").click({ noWaitAfter: true });
  // Les locators attendent la fin de la navigation en cours : on lit le DOM directement.
  const occupe = () => page.evaluate(() => document.querySelector("form button[type=submit]")?.getAttribute("aria-busy") === "true");
  await expect.poll(occupe).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(occupe).toBe(false);
});

test("rejoindre : retour par le cache avant/arrière, le formulaire est rendu à la saisie", async ({ page }) => {
  await page.route("**/api/parties/ABCDEF/joueurs", () => new Promise(() => undefined));
  await page.goto("/j/ABCDEF");
  await pret(page);
  const pseudo = page.getByLabel("Pseudo");
  await pseudo.fill("Léa");
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(pseudo).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(pseudo).toBeEnabled();
});

test("rejoindre : un jeton expiré est écarté et sa clé supprimée", async ({ page }) => {
  const jeton = `${btoa(JSON.stringify({ c: "ABCDEF", s: "s1", r: "player", p: "p1", e: 1000 }))}.sig`;
  await page.goto("/j/K7Q2MB");
  await page.evaluate(
    ([cle, valeur]) => localStorage.setItem(cle!, valeur!),
    ["quizdeszeles:jeton:ABCDEF", JSON.stringify({ playerId: "p1", token: jeton })],
  );
  await page.goto("/j/ABCDEF");
  await pret(page);
  await expect(page).toHaveURL(/\/j\/ABCDEF$/);
  await expect(page.getByLabel("Pseudo")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("quizdeszeles:jeton:ABCDEF"))).toBeNull();
});

test("rejoindre : une forme non normalisée du code est redirigée en 301", async ({ request }) => {
  const reponse = await request.get("/j/k7q-2mb", { maxRedirects: 0 });
  expect(reponse.status()).toBe(301);
  expect(reponse.headers()["location"]).toBe("/j/K7Q2MB");
  const exces = await request.get("/j/K7Q2MBXY", { maxRedirects: 0 });
  expect(exces.status()).toBe(301);
  expect(exces.headers()["location"]).toBe("/j/K7Q2MB");
  expect((await request.get("/j/K7Q2MB", { maxRedirects: 0 })).status()).toBe(200);
});

test("rejoindre : cache privé de 30 secondes", async ({ request }) => {
  const reponse = await request.get("/j/K7Q2MB");
  expect(reponse.headers()["cache-control"]).toBe("private, max-age=30");
});

test("accueil : repli sans JavaScript, ?code= mène à la page de la partie", async ({ request }) => {
  const reponse = await request.get("/?code=k7q-2mb", { maxRedirects: 0 });
  expect(reponse.status()).toBe(303);
  expect(reponse.headers()["location"]).toBe("/j/K7Q2MB");
  expect((await request.get("/?code=", { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.get("/?code=!!!", { maxRedirects: 0 })).status()).toBe(200);
});

test.describe("sans JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("accueil : le formulaire GET mène à /j/<code>", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Code de la partie").fill("K7Q2MB");
    await page.getByRole("button", { name: "Rejoindre la partie" }).click();
    await expect(page).toHaveURL(/\/j\/K7Q2MB$/);
  });

  test("rejoindre : un avertissement demande d'activer JavaScript", async ({ page }) => {
    await page.goto("/j/K7Q2MB");
    // getByText ignore le contenu de noscript : on le cible par sa balise.
    await expect(page.locator("noscript p")).toHaveText("Active JavaScript pour jouer.");
  });
});
