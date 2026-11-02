import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Animateur, URL_JEU, demarrerServeur, lancerPartie, rejoindre, type QuestionLocale, type ServeurLocal } from "./serveur-local";

// Captures à 390 px lues pour la revue visuelle : seulement si le dossier est fourni.
const DOSSIER_CAPTURES = process.env.CAPTURES_JEU;

const questions: QuestionLocale[] = [
  {
    kind: "single",
    prompt: "Qui a construit l'arche pour échapper au déluge ?",
    durationSec: 20,
    reference: "Genèse 6:14-22",
    explanation: "Dieu demande à Noé de construire une arche en bois de gopher pour sauver sa famille.",
    options: [
      { label: "Abraham", isCorrect: false },
      { label: "Noé", isCorrect: true },
      { label: "Moïse", isCorrect: false },
      { label: "Élie", isCorrect: false },
    ],
  },
  {
    kind: "multiple",
    prompt: "Lesquels sont auteurs d'un Évangile ?",
    durationSec: 20,
    options: [
      { label: "Matthieu", isCorrect: true },
      { label: "Judas", isCorrect: false },
      { label: "Luc", isCorrect: true },
      { label: "Pierre", isCorrect: false },
    ],
  },
];

let serveur: ServeurLocal;
test.beforeAll(async () => {
  test.setTimeout(150_000);
  serveur = await demarrerServeur();
});
test.afterAll(async () => {
  await serveur?.arreter();
});
test.beforeEach(({ browserName }, info) => {
  void browserName;
  test.skip(info.project.name !== "mobile", "écran de jeu conçu pour 390 px");
});

async function nouveauJoueur(browser: Browser, code: string, pseudo: string): Promise<Page> {
  const contexte = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await contexte.newPage();
  const jeton = await rejoindre(code, pseudo);
  // Même clé et même forme que la page « rejoindre » : la page de jeu les relit à l'ouverture.
  await page.addInitScript(([cle, valeur]) => localStorage.setItem(cle, valeur), [`quizdeszeles:jeton:${code}`, JSON.stringify(jeton)] as const);
  await page.goto(`${URL_JEU}/j/${code}/jouer`);
  return page;
}

async function capturer(page: Page, nom: string) {
  await page.evaluate(() => document.fonts.ready);
  if (!DOSSIER_CAPTURES) return;
  mkdirSync(DOSSIER_CAPTURES, { recursive: true });
  // Laisse finir les animations d'entrée (ressort du verdict, apparition des puces).
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(DOSSIER_CAPTURES, `qz002-11-${nom}.png`) });
}

async function sansViolation(page: Page) {
  const resultat = await new AxeBuilder({ page }).analyze();
  expect(resultat.violations.map((v) => `${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

test("partie complète : attente, question, correction juste et fausse, résultat", async ({ browser }) => {
  test.setTimeout(120_000);
  const partie = await lancerPartie({ questions });
  const animateur = new Animateur(partie.code, partie.hostToken);
  const grace = await nouveauJoueur(browser, partie.code, "Grâce_22");

  // c. Salle d'attente, vide : aucun autre joueur.
  await expect(grace.getByText("EN ATTENTE")).toBeVisible();
  await expect(grace.getByText("Tu es le premier arrivé")).toBeVisible();
  await capturer(grace, "ecran-c-vide");
  await sansViolation(grace);

  const david = await nouveauJoueur(browser, partie.code, "David");
  await expect(david.getByText("EN ATTENTE")).toBeVisible();
  await capturer(david, "ecran-c");

  await animateur.envoyer("start");

  // d. Question avec chrono et tuiles.
  await expect(grace.getByRole("heading", { name: questions[0]!.prompt })).toBeVisible();
  await expect(grace.getByRole("timer")).toBeVisible();
  await expect(david.getByRole("heading", { name: questions[0]!.prompt })).toBeVisible();
  await capturer(grace, "ecran-d");
  await sansViolation(grace);

  await grace.getByRole("button", { name: /Noé/ }).click();
  await david.getByRole("button", { name: /Moïse/ }).click();
  await expect(grace.getByText("Réponse enregistrée")).toBeVisible();
  await expect(grace.getByRole("heading", { name: "JUSTE !" })).toHaveCount(0);
  await capturer(grace, "reponse-enregistree");
  await sansViolation(grace);

  // e1 / e2. Correction : seul le message reveal la déclenche.
  await animateur.envoyer("reveal");
  await expect(grace.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  await expect(grace.getByText("Genèse 6:14-22")).toBeVisible();
  await capturer(grace, "ecran-e1");
  await sansViolation(grace);
  await expect(david.getByRole("heading", { name: /PAS CETTE\s*FOIS/ })).toBeVisible();
  await expect(david.getByText("Ta réponse")).toBeVisible();
  await expect(david.getByText(/faux/i)).toHaveCount(0);
  await capturer(david, "ecran-e2");
  await sansViolation(david);

  // d bis. Choix multiple : validation explicite.
  await animateur.envoyer("next");
  await expect(grace.getByRole("heading", { name: questions[1]!.prompt })).toBeVisible();
  await grace.getByRole("button", { name: /Matthieu/ }).click();
  await grace.getByRole("button", { name: /Luc/ }).click();
  await capturer(grace, "ecran-d2");
  await sansViolation(grace);
  await grace.getByRole("button", { name: "Valider la sélection" }).click();
  await expect(grace.getByText("Réponse enregistrée")).toBeVisible();
  await david.getByRole("button", { name: /Judas/ }).click();
  await david.getByRole("button", { name: "Valider la sélection" }).click();

  await animateur.envoyer("reveal");
  await expect(grace.getByRole("heading", { name: "JUSTE !" })).toBeVisible();

  // f. Résultat final et partage.
  await animateur.envoyer("end");
  await expect(grace.getByRole("heading", { name: "Résultat final" })).toBeAttached();
  await expect(grace.getByText(/Rang : 1 \/ 2/)).toBeVisible();
  const partager = grace.getByRole("button", { name: "Partager mon score" });
  await expect(partager).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
  await capturer(grace, "ecran-f");
  await sansViolation(grace);
  await partager.click();
  await expect(grace.getByRole("status").filter({ hasText: "Image" })).toBeVisible();
  await expect(david.getByText(/Rang : 2 \/ 2/)).toBeVisible();

  animateur.fermer();
  await grace.context().close();
  await david.context().close();
});

test("correction masquée : « Réponse enregistrée », aucun verdict ni score", async ({ browser }) => {
  test.setTimeout(60_000);
  const partie = await lancerPartie({ showCorrectAnswer: false, questions: questions.slice(0, 1) });
  const animateur = new Animateur(partie.code, partie.hostToken);
  const esther = await nouveauJoueur(browser, partie.code, "Esther");
  await expect(esther.getByText("EN ATTENTE")).toBeVisible();
  await animateur.envoyer("start");
  await esther.getByRole("button", { name: /Noé/ }).click();
  await animateur.envoyer("reveal");
  await expect(esther.getByText("La correction arrive à la fin de la partie")).toBeVisible();
  await expect(esther.getByText(/JUSTE|PAS CETTE|faux|Explication/i)).toHaveCount(0);
  await expect(esther.getByText(/\d+ justes?/)).toHaveCount(0);
  await capturer(esther, "correction-masquee");
  await sansViolation(esther);
  animateur.fermer();
  await esther.context().close();
});

test("sans jeton : retour à la saisie du code", async ({ browser }) => {
  const contexte = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await contexte.newPage();
  await page.goto(`${URL_JEU}/j/K7Q2M9/jouer`);
  await page.waitForURL(`${URL_JEU}/j/K7Q2M9`);
  await contexte.close();
});

test("jeton refusé : la clé est supprimée puis retour à la saisie du code", async ({ browser }) => {
  test.setTimeout(60_000);
  const partie = await lancerPartie({ questions: questions.slice(0, 1) });
  const contexte = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await contexte.newPage();
  const cle = `quizdeszeles:jeton:${partie.code}`;
  // Une seule fois : le script rejoue à chaque navigation et recréerait la clé après la redirection.
  await page.addInitScript(([k]) => {
    if (sessionStorage.getItem("amorce")) return;
    sessionStorage.setItem("amorce", "1");
    localStorage.setItem(k!, JSON.stringify({ playerId: "x", token: "jeton-falsifie" }));
  }, [cle]);
  await page.goto(`${URL_JEU}/j/${partie.code}/jouer`);
  await expect(page.getByText(/Connexion/).first()).toBeVisible();
  await capturer(page, "chargement");
  await page.waitForURL(`${URL_JEU}/j/${partie.code}`, { timeout: 45_000 });
  expect(await page.evaluate((k) => localStorage.getItem(k), cle)).toBeNull();
  await contexte.close();
});
