import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { arreterTout, lancerServeur, type ServeurLocal } from "../tableau-de-bord/serveur-local";

const EMAIL = "animatrice@exemple.fr";
const EMAIL_AUTRE = "autre-animateur@exemple.fr";

// CAPTURES_DIR : dossier des captures de revue ; sans lui, aucune image n'est écrite.
async function capturer(page: Page, nom: string) {
  const dossier = process.env.CAPTURES_DIR;
  if (!dossier) return;
  mkdirSync(dossier, { recursive: true });
  const projet = test.info().project.name === "bureau" ? "bureau" : "mobile";
  await page.screenshot({ path: join(dossier, `qz002-15-${nom}-${projet}.png`), fullPage: true });
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
      .filter((el) => !el.closest("[hidden]"))
      .map((el) => ({ nom: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
  );
  expect(petites).toEqual([]);
}

// Un seul lien magique par adresse et par exécution : la demande de lien est limitée, les tests suivants rejouent le cookie.
const cookiesParAdresse = new Map<string, Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>>();

async function connecter(page: Page, serveur: ServeurLocal, email = EMAIL) {
  const connus = cookiesParAdresse.get(email);
  if (connus) {
    await page.context().addCookies(connus);
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(page);
    return;
  }
  await page.goto(`${serveur.url}/connexion`);
  await hydrate(page);
  await page.getByLabel("Ton adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible();
  await page.goto(await serveur.lienMagique(email));
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await hydrate(page);
  cookiesParAdresse.set(email, await page.context().cookies());
}

// Les Astro Actions répondent en devalue : un objet { quizId } arrive sous la forme [{ "quizId": 1 }, "<id>"].
async function action(page: Page, nom: string, corps: unknown): Promise<Record<string, string>> {
  const texte = await page.evaluate(
    async ([chemin, donnees]) => {
      const reponse = await fetch(`/_actions/${chemin}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donnees) });
      return reponse.text();
    },
    [nom, corps] as const,
  );
  const tableau = JSON.parse(texte) as unknown[];
  const racine = tableau[0] as Record<string, number>;
  return Object.fromEntries(Object.entries(racine).map(([cle, i]) => [cle, tableau[i] as string]));
}

async function creerQuiz(page: Page, titre: string, questions: Array<{ prompt: string; type?: string; reference?: string; explanation?: string; options: Array<[string, boolean]> }>) {
  const { quizId } = await action(page, "quiz.creer", { title: titre });
  for (const q of questions) {
    await action(page, "quiz.ajouterQuestion", {
      quizId,
      question: {
        type: q.type ?? "single",
        prompt: q.prompt,
        durationSec: 20,
        reference: q.reference,
        explanation: q.explanation,
        options: q.options.map(([label, isCorrect]) => ({ label, isCorrect })),
      },
    });
  }
  return quizId!;
}

test.describe("réglages et aperçu du quiz (vraie session)", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  let quizId = "";
  let quizVide = "";

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    cookiesParAdresse.clear();
    serveur = await lancerServeur(30);
  });
  test.afterAll(() => arreterTout());

  test("préparation : un quiz de deux questions et un quiz vide", async ({ page }) => {
    await connecter(page, serveur);
    quizId = await creerQuiz(page, "Les héros de la foi", [
      { prompt: "Qui a construit l'arche ?", reference: "Genèse 6", explanation: "Noé a obéi à Dieu.", options: [["Abraham", false], ["Noé", true], ["Moïse", false], ["Élie", false]] },
      { prompt: "Quels livres sont des évangiles ?", type: "multiple", options: [["Matthieu", true], ["Jean", true], ["Jonas", false]] },
    ]);
    quizVide = (await action(page, "quiz.creer", { title: "Quiz vide" })).quizId!;
    expect(quizId).toMatch(/^[\w-]+$/);
  });

  test("réglages (k5) : contenu, enregistrement automatique relu après rechargement, axe propre", async ({ page }) => {
    await connecter(page, serveur);
    await page.goto(`${serveur.url}/quiz/${quizId}/reglages`);
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'éditeur" })).toHaveAttribute("href", `/quiz/${quizId}`);
    await expect(page.getByRole("radio", { name: /Tout le monde ensemble/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: /Montrer la bonne réponse/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: /Mélanger l'ordre/ })).not.toBeChecked();
    await page.getByText("Plus d'options").click();
    await capturer(page, "k5-reglages");
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);

    await page.getByText("Chacun à son rythme").click();
    await page.getByRole("switch", { name: /Mélanger l'ordre/ }).setChecked(true, { force: true });
    await page.getByLabel("Description (visible par les joueurs)").fill("Des hommes et des femmes de l'Ancien Testament.");
    await page.getByLabel("Catégorie").fill("Ancien Testament");
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible();

    await page.reload();
    await hydrate(page);
    await expect(page.getByRole("radio", { name: /Chacun à son rythme/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: /Mélanger l'ordre/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: /Montrer la bonne réponse/ })).toBeChecked();
    await expect(page.getByLabel("Description (visible par les joueurs)")).toHaveValue("Des hommes et des femmes de l'Ancien Testament.");
    await expect(page.getByLabel("Catégorie")).toHaveValue("Ancien Testament");
    // Le titre n'est pas touché par un enregistrement partiel.
    await expect(page.getByText("Les héros de la foi")).toBeVisible();
  });

  test("réglages : échec d'enregistrement, message et nouvelle tentative", async ({ page }) => {
    await connecter(page, serveur);
    await page.goto(`${serveur.url}/quiz/${quizId}/reglages`);
    await hydrate(page);
    await page.route(/_actions\/quiz\.majReglages/, (route) => route.abort());
    await page.getByRole("switch", { name: /Montrer la bonne réponse/ }).setChecked(false, { force: true });
    await expect(page.getByRole("alert").filter({ hasText: "Réglage non enregistré" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Non enregistré" })).toBeVisible();
    await capturer(page, "k5-echec");
    expect(await axe(page)).toEqual([]);

    await page.unroute(/_actions\/quiz\.majReglages/);
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible();
    await page.reload();
    await hydrate(page);
    await expect(page.getByRole("switch", { name: /Montrer la bonne réponse/ })).not.toBeChecked();
  });

  test("aperçu (k6) : bandeau, verdict, explication, navigation, focus, axe propre", async ({ page }) => {
    await connecter(page, serveur);
    await page.goto(`${serveur.url}/quiz/${quizId}/apercu`);
    await hydrate(page);
    const bandeau = page.getByText("Aperçu : tes réponses ne comptent pas");
    await expect(bandeau).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'éditeur" })).toHaveAttribute("href", `/quiz/${quizId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Qui a construit l'arche ?" })).toBeVisible();
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Précédente" })).toBeDisabled();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k6-question");

    await page.getByRole("button", { name: /Noé/ }).click();
    await expect(page.getByText("JUSTE !")).toBeVisible();
    await expect(page.getByText("Noé a obéi à Dieu.")).toBeVisible();
    await expect(page.getByText("Genèse 6")).toBeVisible();
    await expect(bandeau).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "JUSTE !" })).toBeFocused();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k6-verdict-juste");

    await page.getByRole("button", { name: "Suivante" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Quels livres sont des évangiles ?" })).toBeFocused();
    await expect(page.getByText("Question 2 sur 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Suivante" })).toBeDisabled();
    await page.getByRole("button", { name: /Jonas/ }).click();
    await page.getByRole("button", { name: "Valider la sélection" }).click();
    await expect(page.getByText("PAS CETTE")).toBeVisible();
    await expect(bandeau).toBeVisible();
    await capturer(page, "k6-verdict-rate");

    await page.getByRole("button", { name: "Précédente" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Qui a construit l'arche ?" })).toBeFocused();
    await expect(page.getByText("Question 1 sur 2")).toBeVisible();
  });

  test("aperçu d'un quiz sans question : état vide avec lien vers l'éditeur", async ({ page }) => {
    await connecter(page, serveur);
    await page.goto(`${serveur.url}/quiz/${quizVide}/apercu`);
    await hydrate(page);
    await expect(page.getByRole("heading", { name: "Rien à prévisualiser" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ajouter une question" })).toHaveAttribute("href", `/quiz/${quizVide}`);
    await expect(page.getByText("Aperçu : tes réponses ne comptent pas")).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k6-vide");
  });

  test("accès refusé : le quiz d'un autre animateur est introuvable, sans bonne réponse dans la page", async ({ page }) => {
    await connecter(page, serveur, EMAIL_AUTRE);
    for (const chemin of ["apercu", "reglages"]) {
      const reponse = await page.goto(`${serveur.url}/quiz/${quizId}/${chemin}`);
      expect(reponse?.status()).toBe(404);
      await hydrate(page);
      await expect(page.getByText("Ce quiz est introuvable.")).toBeVisible();
      const html = await page.content();
      expect(html).not.toContain("Noé");
      expect(html).not.toContain("Genèse");
    }
    expect(await axe(page)).toEqual([]);
    await capturer(page, "erreur-introuvable");
  });

  test("non connecté : redirection vers la connexion avec retour", async ({ page }) => {
    await page.goto(`${serveur.url}/quiz/${quizId}/apercu`);
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fquiz%2F[\w-]+%2Fapercu/);
  });
});
