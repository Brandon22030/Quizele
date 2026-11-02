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
  await expect(page.getByText("Le code fait 6 caractères.")).toBeVisible();
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
