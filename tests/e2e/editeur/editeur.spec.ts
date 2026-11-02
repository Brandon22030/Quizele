import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Cookie, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { arreterTout, lancerServeur, type ServeurLocal } from "../connexion/serveur-local";

// Vraie session : le serveur dédié journalise le lien magique, on s'en sert pour ouvrir une session Better Auth réelle, puis
// l'éditeur parle aux vraies Actions (D1 jetable). Aucune action n'est simulée, sauf pour couper le réseau.

// CAPTURES_DIR : dossier des captures de revue ; sans lui, aucune image n'est écrite.
async function capturer(page: Page, nom: string) {
  const dossier = process.env.CAPTURES_DIR;
  if (!dossier) return;
  mkdirSync(dossier, { recursive: true });
  await page.screenshot({ path: join(dossier, `qz002-14-${nom}.png`), fullPage: true });
}

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

async function axe(page: Page) {
  const resultat = await new AxeBuilder({ page }).analyze();
  return resultat.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

async function ciblesTactilesAssezGrandes(page: Page) {
  const petites = await page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input:not(.sr-only), textarea")]
      .filter((el) => !el.closest("[aria-hidden=true]") && !el.matches(".sr-only"))
      .map((el) => ({ nom: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
  );
  expect(petites).toEqual([]);
}

let serveur: ServeurLocal;
let compteurAdresses = 0;

// Better Auth limite les liens magiques à 5 par minute et par adresse IP : on ouvre une vraie session une seule fois par
// serveur (et une seconde pour « un autre animateur »), puis chaque test réutilise ses cookies.
async function ouvrirSession(browser: Browser): Promise<Cookie[]> {
  const contexte = await browser.newContext();
  const page = await contexte.newPage();
  const email = `editeur${++compteurAdresses}@exemple.fr`;
  const reponse = await page.request.post(`${serveur.url}/api/auth/sign-in/magic-link`, {
    data: { email, callbackURL: "/tableau-de-bord" },
    headers: { origin: serveur.url },
  });
  expect(reponse.ok()).toBe(true);
  await page.goto(await serveur.lienMagique(email));
  const cookies = await contexte.cookies();
  await contexte.close();
  return cookies;
}

let sessionAnimateur: Cookie[] = [];

async function connecter(page: Page, retour = "/quiz/nouveau", cookies: Cookie[] = sessionAnimateur) {
  await page.context().addCookies(cookies);
  await page.goto(`${serveur.url}${retour}`);
}

async function actionRpc(page: Page, nom: string, corps: unknown) {
  const r = await page.request.post(`${serveur.url}/_actions/quiz.${nom}/`, { data: corps, headers: { origin: serveur.url } });
  expect(r.ok()).toBe(true);
  return r.json() as Promise<unknown>;
}

// Les actions Astro répondent en JSON sérialisé (devalue) : on lit l'identifiant dans la chaîne.
async function creerQuizVide(page: Page, titre: string): Promise<string> {
  const brut = JSON.stringify(await actionRpc(page, "creer", { title: titre }));
  const id = brut.match(/[0-9a-f]{8}-[0-9a-f-]{27}|[A-Za-z0-9_-]{16,}/g)?.find((m) => m !== titre);
  if (!id) throw new Error(`Identifiant de quiz introuvable dans ${brut}`);
  return id;
}

const statut = (page: Page) => page.getByRole("status").filter({ hasText: /Enregistr|En attente|Non enregistré/ }).first();

test.beforeEach(({ browserName: _navigateur }, testInfo) => {
  // Les deux projets (mobile et bureau) lanceraient les mêmes parcours sur les mêmes ports : le bureau a ses propres tests.
  test.skip(testInfo.project.name !== "mobile", "parcours mobile, la vue bureau est testée en fixant le viewport");
});

test.describe("éditeur de quiz, session réelle", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(30);
    sessionAnimateur = await ouvrirSession(browser);
  });
  test.afterAll(() => arreterTout());

  test("k3 : titre et question 1 sur un écran, enregistrés tout seuls, puis rechargés", async ({ page }) => {
    await connecter(page);
    await expect(page).toHaveURL(/\/quiz\/nouveau$/);
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Nouveau quiz" })).toBeVisible();
    await expect(page.getByLabel("Titre du quiz")).toBeVisible();
    await expect(page.getByLabel("Énoncé de la question 1")).toBeVisible();
    // k3 : seulement A et B, pas de type ni de durée à l'écran.
    await expect(page.getByLabel("Réponse A", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Réponse B", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Réponse C", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lancer" })).toBeDisabled();
    await capturer(page, "k3-vide");

    // Sans titre, rien ne part : l'écran le dit au lieu d'échouer.
    await page.getByLabel("Énoncé de la question 1").fill("Qui a construit l'arche ?");
    await expect(page.getByText("Ajoute un titre pour enregistrer ton quiz.")).toBeVisible();

    await page.getByLabel("Titre du quiz").fill("Les héros de la foi");
    await page.getByLabel("Réponse A", { exact: true }).fill("Abraham");
    await page.getByLabel("Réponse B", { exact: true }).fill("Noé");
    await page.getByRole("button", { name: "Marquer B comme bonne réponse" }).click();
    await expect(page).toHaveURL(/\/quiz\/(?!nouveau)[^/]+$/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/nouveau/);
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Lancer" })).toBeVisible();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k3-rempli");

    await page.reload();
    await hydrate(page);
    await expect(page.getByLabel("Titre du quiz")).toHaveValue("Les héros de la foi");
    await expect(page.getByLabel("Énoncé de la question 1")).toHaveValue("Qui a construit l'arche ?");
    await expect(page.getByRole("button", { name: "Marquer B comme bonne réponse" })).toHaveAttribute("aria-pressed", "true");
  });

  test("k4 : types, bonne réponse d'un tap, durée, repli, ajout, bascule vrai ou faux", async ({ page }) => {
    await connecter(page);
    await hydrate(page);
    await page.getByLabel("Titre du quiz").fill("Quiz des types");
    await page.getByLabel("Énoncé de la question 1").fill("Qui a construit l'arche pour échapper au déluge ?");
    await page.getByLabel("Réponse A", { exact: true }).fill("Abraham");
    await page.getByLabel("Réponse B", { exact: true }).fill("Noé");
    await page.getByRole("button", { name: "Marquer B comme bonne réponse" }).click();
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });

    // + Question : passe en édition, la question 2 est ouverte.
    await page.getByRole("button", { name: "Question", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Questions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Question 2, à compléter" })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("radio")).toHaveCount(3 + 4);
    await expect(page.getByRole("radio", { name: "Une bonne réponse" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Plusieurs bonnes" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Vrai ou faux" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "20 s" })).toBeChecked();

    await page.getByRole("button", { name: "Question 1" }).click();
    await page.getByRole("radio", { name: "Plusieurs bonnes" }).check({ force: true });
    await page.getByRole("button", { name: "Ajouter une réponse" }).click();
    await page.getByLabel("Réponse C", { exact: true }).fill("Moïse");
    await page.getByRole("button", { name: "Marquer C comme bonne réponse" }).click();
    await page.getByRole("radio", { name: "10 s" }).check({ force: true });
    await page.getByText("Référence et explication").click();
    await page.getByLabel("Référence").fill("Genèse 6:14");
    await page.getByLabel(/Explication/).fill("Dieu demande à Noé de construire une arche.");
    // Plusieurs bonnes : B et C cochées ; retour à « unique » garde une seule bonne réponse (B).
    await expect(page.getByRole("button", { name: /Marquer [BC] comme bonne réponse/ })).toHaveCount(2);
    await expect(page.locator("[aria-pressed=true]")).toHaveCount(2);
    await page.getByRole("radio", { name: "Une bonne réponse" }).check({ force: true });
    await expect(page.locator("[aria-pressed=true]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Marquer B comme bonne réponse" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("radio", { name: "Plusieurs bonnes" }).check({ force: true });
    await page.getByRole("button", { name: "Marquer C comme bonne réponse" }).click();
    await expect(page.locator("[aria-pressed=true]")).toHaveCount(2);

    // Question 2 en vrai ou faux : deux réponses figées, aucun champ de libellé.
    await page.getByRole("button", { name: /Question 2/ }).click();
    await page.getByLabel("Énoncé de la question 2").fill("David a vaincu Goliath avec une épée.");
    await page.getByRole("radio", { name: "Vrai ou faux" }).check({ force: true });
    await expect(page.getByRole("region", { name: "Question" }).getByText("Vrai", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Question" }).getByText("Faux", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Réponse [A-D]$/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajouter une réponse" })).toHaveCount(0);
    await page.getByRole("button", { name: "Marquer B comme bonne réponse" }).click();
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    await capturer(page, "k4-vrai-faux");

    // Rechargement : tout est revenu du serveur.
    await page.reload();
    await hydrate(page);
    await page.getByRole("button", { name: /Question 1/ }).click();
    await expect(page.getByRole("radio", { name: "Plusieurs bonnes" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "10 s" })).toBeChecked();
    await expect(page.getByLabel("Réponse C", { exact: true })).toHaveValue("Moïse");
    await expect(page.getByLabel("Référence")).toHaveValue("Genèse 6:14");
    await page.getByRole("button", { name: /Question 2/ }).click();
    await expect(page.getByRole("radio", { name: "Vrai ou faux" })).toBeChecked();
    await page.getByRole("button", { name: /Question 1/ }).click();
    await capturer(page, "k4");
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
  });

  test("k4b : la feuille « Tes questions » se réordonne aux flèches du clavier et au glisser", async ({ page }) => {
    await connecter(page);
    await hydrate(page);
    await page.getByLabel("Titre du quiz").fill("Quiz à ordonner");
    await page.getByLabel("Énoncé de la question 1").fill("Première");
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    for (const nom of ["Deuxième", "Troisième"]) {
      await page.getByRole("button", { name: /Ajouter une question|^Question$/ }).first().click();
      await page.getByLabel(/Énoncé de la question \d/).fill(nom);
    }
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });

    await page.getByRole("button", { name: "Voir et réorganiser les questions" }).click();
    const feuille = page.getByRole("dialog", { name: "Tes questions (3)" });
    await expect(feuille).toBeVisible();
    const textes = () => feuille.locator("ol > li").evaluateAll((lis) => lis.map((li) => li.textContent ?? ""));
    expect((await textes())[0]).toContain("Première");

    const poignee1 = feuille.getByRole("button", { name: "Déplacer la question 1" });
    await poignee1.focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await textes())[1]).toContain("Première");
    // Le focus suit la poignée déplacée, la flèche suivante agit sur la même question.
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await textes())[2]).toContain("Première");
    await expect(feuille.getByRole("status")).toContainText("position 3 sur 3");
    await capturer(page, "k4b-feuille");
    expect(await axe(page)).toEqual([]);

    // Glisser : la dernière ligne remonte en tête à la souris.
    const cible = await feuille.locator("ol > li").nth(0).boundingBox();
    const depart = await feuille.getByRole("button", { name: /Déplacer la question 3/ }).boundingBox();
    if (!cible || !depart) throw new Error("lignes introuvables");
    await page.mouse.move(depart.x + depart.width / 2, depart.y + depart.height / 2);
    await page.mouse.down();
    await page.mouse.move(cible.x + cible.width / 2, cible.y + 5, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await textes())[0]).toContain("Première");

    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    await page.keyboard.press("Escape");
    await page.reload();
    await hydrate(page);
    await page.getByRole("button", { name: "Voir et réorganiser les questions" }).click();
    expect((await textes())[0]).toContain("Première");
  });

  test("hors ligne : échec visible, modifications gardées, nouvelle tentative puis reprise après rechargement", async ({ page, context }) => {
    await connecter(page);
    await hydrate(page);
    await page.getByLabel("Titre du quiz").fill("Quiz hors ligne");
    await page.getByLabel("Énoncé de la question 1").fill("Avant la coupure");
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });

    await context.setOffline(true);
    await page.getByLabel("Énoncé de la question 1").fill("Écrit sans réseau");
    await expect(statut(page)).toHaveText("Non enregistré", { timeout: 10_000 });
    await expect(page.getByRole("alert")).toContainText("Tes modifications sont gardées sur cet appareil");
    await capturer(page, "k10-echec");
    expect(await axe(page)).toEqual([]);
    const gardee = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("quizdeszeles:editeur:")).map(([, v]) => v).join(""));
    expect(gardee).toContain("Écrit sans réseau");

    // Retour du réseau : l'événement « online » relance l'envoi sans geste de l'animateur.
    await context.setOffline(false);
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("quizdeszeles:editeur:")))).toEqual([]);

    // Nouvelle tentative manuelle : les requêtes sont coupées au niveau de la page (pas d'événement « online » à attendre).
    await page.route("**/_actions/**", (route) => route.abort("internetdisconnected"));
    await page.getByLabel("Énoncé de la question 1").fill("Réessai manuel");
    await expect(page.getByRole("button", { name: "Réessayer maintenant" })).toBeVisible({ timeout: 10_000 });
    await page.unroute("**/_actions/**");
    await page.getByRole("button", { name: "Réessayer maintenant" }).click();
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });

    // Reprise après rechargement : le serveur n'a jamais reçu la modification, localStorage la rejoue.
    await page.route("**/_actions/**", (route) => route.abort("internetdisconnected"));
    await page.getByLabel("Énoncé de la question 1").fill("Gardé pour le rechargement");
    await expect(statut(page)).toHaveText("Non enregistré", { timeout: 10_000 });
    await page.unroute("**/_actions/**");
    await page.reload();
    await hydrate(page);
    await expect(page.getByLabel("Énoncé de la question 1")).toHaveValue("Gardé pour le rechargement");
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    await page.reload();
    await hydrate(page);
    await expect(page.getByLabel("Énoncé de la question 1")).toHaveValue("Gardé pour le rechargement");
  });

  test("états : chargement, quiz introuvable, quiz sans question", async ({ page }) => {
    await connecter(page);
    // La réponse de chargement est retenue le temps de voir le squelette.
    let liberer: () => void = () => {};
    const porte = new Promise<void>((r) => (liberer = r));
    let retenir = true;
    await page.route("**/_actions/quiz.charger/**", async (route) => {
      if (retenir) await porte;
      await route.continue();
    });
    await page.goto(`${serveur.url}/quiz/inconnu`);
    await expect(page.getByRole("status", { name: "Chargement du quiz" })).toBeVisible();
    await capturer(page, "k10-chargement");
    retenir = false;
    liberer();
    await hydrate(page);
    await expect(page.getByRole("alert")).toContainText("Ce quiz est introuvable.");
    await expect(page.getByRole("link", { name: "Retour au tableau de bord" }).first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k10-introuvable");

    const id = await creerQuizVide(page, "Sans question");
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await expect(page.getByRole("heading", { name: "Ce quiz n'a pas encore de question" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k10-vide");
    await page.getByRole("button", { name: "Créer la question 1" }).click();
    await expect(page.getByLabel("Énoncé de la question 1")).toBeVisible();
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
  });

  test("quiz d'un autre animateur : introuvable, rien n'est affiché", async ({ page, browser }) => {
    await connecter(page);
    await hydrate(page);
    await page.getByLabel("Titre du quiz").fill("Quiz privé");
    await expect(page).toHaveURL(/\/quiz\/(?!nouveau)[^/]+$/, { timeout: 15_000 });
    const lien = page.url();
    const autre = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await autre.newPage();
    await connecter(page2, new URL(lien).pathname, await ouvrirSession(browser));
    await hydrate(page2);
    await expect(page2.getByRole("alert")).toContainText("Ce quiz est introuvable.");
    await expect(page2.getByText("Quiz privé")).toHaveCount(0);
    await autre.close();
  });

  test("Aperçu et Lancer mènent aux pages du quiz, après enregistrement des modifications", async ({ page }) => {
    await connecter(page);
    await hydrate(page);
    await page.getByLabel("Titre du quiz").fill("Quiz à lancer");
    await page.getByLabel("Énoncé de la question 1").fill("Question prête");
    await expect(page).toHaveURL(/\/quiz\/(?!nouveau)[^/]+$/, { timeout: 15_000 });
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    await page.getByRole("button", { name: "Question", exact: true }).click();
    const id = new URL(page.url()).pathname.split("/").pop();
    await expect(page.getByRole("link", { name: "Aperçu" })).toHaveAttribute("href", `/quiz/${id}/apercu`);
    await expect(page.getByRole("link", { name: "Lancer" })).toHaveAttribute("href", `/quiz/${id}/lancer`);
    await expect(page.getByRole("link", { name: "Réglages du quiz" })).toHaveAttribute("href", `/quiz/${id}/reglages`);
  });
});

test.describe("éditeur de quiz, bureau", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 800 } });
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(31);
    sessionAnimateur = await ouvrirSession(browser);
  });
  test.afterAll(() => arreterTout());

  test("liste à gauche, question au centre, aperçu joueur à droite", async ({ page }) => {
    await connecter(page);
    await hydrate(page);
    await page.getByLabel("Titre du quiz").fill("Les héros de la foi");
    await page.getByLabel("Énoncé de la question 1").fill("Qui a construit l'arche pour échapper au déluge ?");
    await page.getByLabel("Réponse A", { exact: true }).fill("Abraham");
    await page.getByLabel("Réponse B", { exact: true }).fill("Noé");
    await page.getByRole("button", { name: "Marquer B comme bonne réponse" }).click();
    await expect(page).toHaveURL(/\/quiz\/(?!nouveau)[^/]+$/, { timeout: 15_000 });
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    await page.reload();
    await hydrate(page);

    const liste = page.getByRole("complementary", { name: "Liste des questions" });
    const apercu = page.getByRole("complementary", { name: "Aperçu joueur" });
    await expect(liste).toBeVisible();
    await expect(apercu).toBeVisible();
    const [bl, bm, ba] = await Promise.all([liste.boundingBox(), page.getByLabel("Énoncé de la question 1").boundingBox(), apercu.boundingBox()]);
    expect(bl && bm && ba && bl.x < bm.x && bm.x < ba.x).toBe(true);
    // Mobile only : pastilles et barre du bas absentes en bureau.
    await expect(page.getByRole("navigation", { name: "Questions" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Lancer" })).toBeVisible();
    await expect(apercu.getByText("Qui a construit l'arche pour échapper au déluge ?")).toBeVisible();

    // L'aperçu suit la frappe.
    await page.getByLabel("Réponse A", { exact: true }).fill("Abraham le patriarche");
    await expect(apercu.getByText("Abraham le patriarche")).toBeVisible();
    await page.getByRole("button", { name: "Ajouter une question" }).click();
    await expect(liste.getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: /Question 1/ }).click();
    await expect(statut(page)).toHaveText("Enregistré", { timeout: 15_000 });
    expect(await axe(page)).toEqual([]);
    await capturer(page, "bureau");
  });
});
