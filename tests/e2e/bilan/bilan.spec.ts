import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { arreterTout, lancerServeur, type ServeurLocal } from "../tableau-de-bord/serveur-local";

const A = "animateur-a@exemple.fr";
const B = "animateur-b@exemple.fr";

// CAPTURES_DIR : dossier des captures de revue ; sans lui, aucune image n'est écrite.
async function capturer(page: Page, nom: string) {
  const dossier = process.env.CAPTURES_DIR;
  if (!dossier) return;
  mkdirSync(dossier, { recursive: true });
  const projet = test.info().project.name === "bureau" ? "bureau" : "mobile";
  await page.screenshot({ path: join(dossier, `qz002-17-${nom}-${projet}.png`), fullPage: true });
}

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

const sessions = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function ouvrirSession(browser: Browser, serveur: ServeurLocal, email: string): Promise<{ contexte: BrowserContext; page: Page }> {
  const contexte = await browser.newContext({ viewport: test.info().project.use.viewport ?? { width: 390, height: 844 } });
  const page = await contexte.newPage();
  const connus = sessions.get(email);
  if (connus) {
    await contexte.addCookies(connus);
    return { contexte, page };
  }
  await page.goto(`${serveur.url}/connexion`);
  await hydrate(page);
  await page.getByLabel("Ton adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible({ timeout: 30_000 });
  await page.goto(await serveur.lienMagique(email));
  await expect(page).toHaveURL(/\/tableau-de-bord$/, { timeout: 30_000 });
  sessions.set(email, await contexte.cookies());
  return { contexte, page };
}

const PSEUDOS = ["Esther.B", "David", "Grâce_22", "Noé", "Ruth", "Samuel", "Marie", "Paul", "Lydie", "Tite", "Anne", "Jonas"];

function semer(serveur: ServeurLocal) {
  const inserer = (id: string, titre: string, proprietaire: string) =>
    "INSERT INTO game_sessions (id, code, owner_id, quiz_id, quiz_title, mode, show_correct_answer, shuffle, status, created_at, ended_at) " +
    `SELECT '${id}', '${id.slice(-6).toUpperCase()}', id, NULL, '${titre}', 'together', 1, 0, 'ended', 1793000000000, 1793003600000 FROM user WHERE email = '${proprietaire}';`;
  const joueurs = PSEUDOS.map(
    (p, i) => `('j${i}', 'partie-a', '${p}', ${3 - Math.floor(i / 4)}, ${9000 + i * 1000}, ${i + 1})`,
  ).join(", ");
  serveur.sql(
    inserer("partie-a", "Les héros de la foi", A) +
      inserer("partie-vide", "Partie déserte", A) +
      `INSERT INTO session_players (id, session_id, pseudo, score, total_time_ms, rank) VALUES ${joueurs};` +
      "INSERT INTO question_stats (id, session_id, position, prompt, correct_labels, reference, answer_count, correct_count, distribution) VALUES " +
      "('s1', 'partie-a', 1, 'Combien de jours a duré la création ?', '[\"Six jours\"]', 'Genèse 1', 12, 4, '{}'), " +
      "('s2', 'partie-a', 2, 'Qui a construit l''arche ?', '[\"Noé\"]', NULL, 12, 9, '{}'), " +
      "('s3', 'partie-a', 3, 'Question facile', '[\"Oui\"]', NULL, 12, 12, '{}');",
  );
}

test.describe("bilan de partie (vraie session)", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    sessions.clear();
    serveur = await lancerServeur(50);
    // Les comptes doivent exister avant l'insertion des parties.
    for (const email of [A, B]) {
      const { contexte } = await ouvrirSession(browser, serveur, email);
      await contexte.close();
    }
    semer(serveur);
  });
  test.afterAll(() => arreterTout());

  test("classement, questions à revoir triées, mention de purge, axe propre", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page, contexte } = await ouvrirSession(browser, serveur, A);
    await page.goto(`${serveur.url}/partie/partie-a/bilan`);
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Les héros de la foi" })).toBeVisible();
    await expect(page.getByText("12 joueurs")).toBeVisible();
    await expect(page.getByText("Ce bilan sera supprimé automatiquement 90 jours après la partie.")).toBeVisible();
    const cartes = page.locator("article");
    await expect(cartes).toHaveCount(2);
    await expect(cartes.first()).toContainText("Combien de jours a duré la création ?");
    await expect(cartes.first()).toContainText("33");
    await expect(cartes.first()).toContainText("Six jours");
    await expect(cartes.first()).toContainText("Genèse 1");
    await expect(page.getByRole("link", { name: "Exporter" })).toHaveAttribute("href", "/partie/partie-a/export.csv");
    // Le PNG est prêt dès l'affichage : le bouton n'est plus en préparation.
    const partager = page.getByRole("button", { name: "Partager" });
    await expect(partager).toBeEnabled({ timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capturer(page, "bilan");
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(violations.map((v) => v.id)).toEqual([]);
    await contexte.close();
  });

  test("partage sans API de partage : retombe sur le téléchargement et l'annonce dans le statut", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page, contexte } = await ouvrirSession(browser, serveur, A);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: () => Promise.reject(new DOMException("refus", "NotAllowedError")), configurable: true });
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    });
    await page.goto(`${serveur.url}/partie/partie-a/bilan`);
    await hydrate(page);
    const partager = page.getByRole("button", { name: "Partager" });
    await expect(partager).toBeEnabled({ timeout: 60_000 });
    const telechargement = page.waitForEvent("download");
    await partager.click();
    expect((await telechargement).suggestedFilename()).toMatch(/\.png$/);
    await expect(page.getByRole("status").filter({ hasText: /\S/ })).toBeVisible();
    await contexte.close();
  });

  test("export CSV : BOM, point-virgule, accents, jamais mis en cache", async ({ browser }) => {
    const { page, contexte } = await ouvrirSession(browser, serveur, A);
    const reponse = await page.request.get(`${serveur.url}/partie/partie-a/export.csv`);
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()["content-type"]).toContain("text/csv");
    expect(reponse.headers()["cache-control"]).toContain("no-store");
    const octets = await reponse.body();
    expect([...octets.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texte = octets.toString("utf8");
    expect(texte).toContain("Rang;Pseudo;Score;Questions;Temps total (s)");
    expect(texte).toContain("3;Grâce_22;3;3;11,0");
    await contexte.close();
  });

  test("partie sans joueur : état vide, sans export ni partage", async ({ browser }) => {
    const { page, contexte } = await ouvrirSession(browser, serveur, A);
    await page.goto(`${serveur.url}/partie/partie-vide/bilan`);
    await hydrate(page);
    await expect(page.getByRole("heading", { name: "Personne n'a joué cette partie" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Partager" })).toHaveCount(0);
    await capturer(page, "vide");
    await contexte.close();
  });

  test("autre animateur et partie inconnue : même 404, page comme export", async ({ browser }) => {
    const { page, contexte } = await ouvrirSession(browser, serveur, B);
    for (const id of ["partie-a", "inconnue"]) {
      const bilan = await page.goto(`${serveur.url}/partie/${id}/bilan`);
      expect(bilan?.status()).toBe(404);
      expect(bilan?.headers()["cache-control"]).toContain("no-store");
      await hydrate(page);
      await expect(page.getByText("Ce bilan est introuvable.")).toBeVisible();
      expect(await page.evaluate(() => document.body.innerText)).not.toContain("Les héros de la foi");
      const exporte = await page.request.get(`${serveur.url}/partie/${id}/export.csv`);
      expect(exporte.status()).toBe(404);
      expect(await exporte.text()).not.toContain("Esther");
    }
    await capturer(page, "introuvable");
    await contexte.close();
  });
});
