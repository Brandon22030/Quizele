import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { arreterTout, lancerServeur, type ServeurLocal } from "../tableau-de-bord/serveur-local";
import { animationsEnBoucle, axeGrave, connecterParLienMagique, espionnerPartage, fermer, hydrate, lirePartage, ouvrirJoueur, verifierPng, VIEWPORT } from "./aide";

// Parcours de bout en bout à 390 px, entièrement piloté par l'interface : seul le serveur (wrangler dev, D1 jetable,
// vrai Durable Object) et la lecture du lien magique dans son journal sortent du navigateur.

const EMAIL = "parcours-animateur@exemple.fr";
const TITRE = "Les héros de la foi";

test.beforeEach(({ browserName: _nav }, info) => {
  test.skip(info.project.name !== "mobile", "parcours mobile à 390 px ; le bureau est couvert par les specs par écran");
});

let serveur: ServeurLocal;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  test.setTimeout(480_000);
  serveur = await lancerServeur(60);
});
test.afterAll(() => arreterTout());

async function enregistre(page: Page) {
  await expect(page.locator("header").getByText(/^Enregistré$/)).toBeVisible({ timeout: 20_000 });
}

/** Crée un quiz de 2 questions depuis zéro, par l'éditeur (pas d'Action appelée à la main). */
async function creerQuizParLInterface(page: Page): Promise<string> {
  await page.goto(`${serveur.url}/quiz/nouveau`);
  await hydrate(page);
  await axeGrave(page, "éditeur : nouveau quiz");
  await page.getByLabel("Titre du quiz").fill(TITRE);
  await page.getByLabel("Énoncé de la question 1").fill("Qui a construit l'arche ?");
  await page.getByLabel("Réponse A", { exact: true }).fill("Abraham");
  await page.getByLabel("Réponse B", { exact: true }).fill("Noé");
  await page.getByRole("button", { name: "Marquer B comme bonne réponse" }).click();
  await expect(page).toHaveURL(/\/quiz\/(?!nouveau)[^/]+$/, { timeout: 20_000 });
  await enregistre(page);

  await page.getByRole("button", { name: "Question", exact: true }).click();
  await page.getByLabel("Énoncé de la question 2").fill("Qui a vaincu Goliath ?");
  await page.getByLabel("Réponse A", { exact: true }).fill("David");
  await page.getByLabel("Réponse B", { exact: true }).fill("Samson");
  await page.getByRole("button", { name: "Marquer A comme bonne réponse" }).click();
  // 60 s partout : sous charge, les contrôles d'accessibilité en cours de question dépassent la durée par défaut et le
  // serveur révèle la réponse tout seul à l'échéance, ce qui désynchronise le parcours.
  await page.getByText("60 s", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "60 s" })).toBeChecked();
  await page.getByRole("button", { name: /Question 1/ }).click();
  await page.getByText("60 s", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "60 s" })).toBeChecked();
  await enregistre(page);
  await axeGrave(page, "éditeur : 2 questions");
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function lancerDepuisLEditeur(page: Page, quizId: string): Promise<{ sessionId: string; code: string }> {
  await page.goto(`${serveur.url}/quiz/${quizId}/lancer`);
  await hydrate(page);
  await expect(page.getByText("2 questions complètes")).toBeVisible();
  await axeGrave(page, "lancement");
  await page.getByRole("button", { name: "Lancer la partie" }).click();
  await expect(page).toHaveURL(/\/partie\/[\w-]+$/, { timeout: 30_000 });
  const sessionId = new URL(page.url()).pathname.split("/").pop()!;
  // Le code est lu là où l'animateur le voit (ticket de l'écran de pilotage), pas dans le stockage de la page.
  const ticket = page.getByText("Code de la partie :").first().locator("xpath=..");
  await expect(ticket).toContainText(/[A-Z0-9]{6}/);
  const code = ((await ticket.innerText()).match(/\b[A-HJ-NP-Z2-9]{6}\b/) ?? [])[0];
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return { sessionId, code: code! };
}

test("animateur ensemble : lien magique, création, 3 joueurs, partie complète, bilan, CSV, partage", async ({ browser }) => {
  test.setTimeout(480_000);
  const hote = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, acceptDownloads: true });
  const page = await hote.newPage();

  await connecterParLienMagique(page, serveur, EMAIL);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await axeGrave(page, "tableau de bord (vide)");

  const quizId = await creerQuizParLInterface(page);
  const { sessionId, code } = await lancerDepuisLEditeur(page, quizId);
  await expect(page.getByRole("heading", { name: "Personne n'est encore là" })).toBeVisible();
  await axeGrave(page, "pilotage : salle vide");

  // Trois joueurs, trois contextes isolés (stockage et sockets séparés).
  const noms = ["Esther", "Grâce", "Noémie"];
  const joueurs = [];
  for (const [i, nom] of noms.entries()) joueurs.push(await ouvrirJoueur(browser, serveur, code, nom, { axe: i === 0 }));
  await axeGrave(joueurs[0]!.page, "joueur : attente");
  await expect(page.getByRole("heading", { name: "Participants (3)" })).toBeVisible({ timeout: 20_000 });
  await axeGrave(page, "pilotage : 3 participants");

  // Esther : juste, juste. Grâce : juste, faux. Noémie : faux, faux.
  const choix = [
    [/Noé/, /David/],
    [/Noé/, /Samson/],
    [/Abraham/, /Samson/],
  ];
  const verdicts = [
    ["JUSTE !", "JUSTE !"],
    ["JUSTE !", /PAS CETTE\s*FOIS/],
    [/PAS CETTE\s*FOIS/, /PAS CETTE\s*FOIS/],
  ] as const;
  const questions = ["Qui a construit l'arche ?", "Qui a vaincu Goliath ?"];

  await page.getByRole("button", { name: "Lancer la première question" }).click();
  for (let q = 0; q < 2; q++) {
    await expect(page.getByRole("heading", { level: 1, name: `Question ${q + 1} sur 2` })).toBeVisible();
    for (const [i, j] of joueurs.entries()) {
      await expect(j.page.getByRole("heading", { name: questions[q]! })).toBeVisible({ timeout: 20_000 });
      if (i === 0 && q === 0) await axeGrave(j.page, "joueur : question");
      await j.page.getByRole("button", { name: choix[i]![q]! }).click();
      await expect(j.page.getByText("Réponse enregistrée")).toBeVisible();
    }
    await expect(page.getByRole("progressbar", { name: "Réponses reçues" })).toHaveAttribute("aria-valuenow", "3");
    if (q === 0) await axeGrave(page, "pilotage : question");
    await page.getByRole("button", { name: "Révéler la réponse" }).click();
    await page.getByRole("button", { name: /Voir la bonne réponse|Voir les bonnes réponses/ }).click();
    for (const [i, j] of joueurs.entries()) {
      await expect(j.page.getByRole("heading", { name: verdicts[i]![q]! })).toBeVisible({ timeout: 20_000 });
    }
    if (q === 0) {
      await axeGrave(joueurs[0]!.page, "joueur : correction");
      await axeGrave(page, "pilotage : correction");
    }
    await page.getByRole("button", { name: q === 1 ? "Afficher les résultats" : "Question suivante", exact: true }).click();
  }

  await expect(page.getByRole("heading", { level: 1, name: "Partie terminée" })).toBeVisible({ timeout: 20_000 });
  await axeGrave(page, "pilotage : partie terminée");

  // Résultat côté joueur : rang, PNG généré dans le navigateur, navigator.share simulé.
  const [premier, deuxieme, troisieme] = joueurs;
  await expect(premier!.page.getByText(/Rang : 1 \/ 3/)).toBeVisible({ timeout: 20_000 });
  await expect(deuxieme!.page.getByText(/Rang : 2 \/ 3/)).toBeVisible();
  await expect(troisieme!.page.getByText(/Rang : 3 \/ 3/)).toBeVisible();
  const partager = premier!.page.getByRole("button", { name: "Partager mon score" });
  await expect(partager).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
  await axeGrave(premier!.page, "joueur : résultat final");
  await espionnerPartage(premier!.page);
  await partager.click();
  verifierPng((await lirePartage(premier!.page))!);

  // Bilan de l'animateur puis export CSV par le vrai bouton.
  await page.getByRole("link", { name: "Voir le bilan de la partie" }).click();
  await expect(page).toHaveURL(new RegExp(`/partie/${sessionId}/bilan$`));
  await hydrate(page);
  await expect(page.getByRole("heading", { level: 1, name: TITRE })).toBeVisible();
  await expect(page.getByText("3 joueurs")).toBeVisible();
  await expect(page.getByRole("button", { name: "Partager" })).toBeEnabled({ timeout: 60_000 });
  await axeGrave(page, "bilan");

  await espionnerPartage(page);
  await page.getByRole("button", { name: "Partager" }).click();
  verifierPng((await lirePartage(page))!);

  const telechargement = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exporter" }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^bilan-les-heros-de-la-foi-\d{4}-\d\d-\d\d\.csv$/);
  const octets = readFileSync((await fichier.path())!);
  expect([...octets.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lignes = octets.toString("utf8").slice(1).split("\r\n");
  expect(lignes[0]).toBe("Rang;Pseudo;Score;Questions;Temps total (s)");
  expect(lignes.slice(1, -1).map((l) => l.split(";").slice(0, 4).join(";"))).toEqual(["1;Esther;2;2", "2;Grâce;1;2", "3;Noémie;0;2"]);

  await fermer(hote, ...joueurs.map((j) => j.contexte));
});

test("mode « Chacun à son rythme » avec reduced-motion émulé, jusqu'au bilan", async ({ browser }) => {
  test.setTimeout(480_000);
  const hote = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, reducedMotion: "reduce" });
  const page = await hote.newPage();
  await connecterParLienMagique(page, serveur, "parcours-libre@exemple.fr");
  const quizId = await creerQuizParLInterface(page);

  // Mode choisi dans l'écran de réglages, relu sur l'écran de lancement.
  await page.goto(`${serveur.url}/quiz/${quizId}/reglages`);
  await hydrate(page);
  await axeGrave(page, "réglages");
  await page.getByText("Chacun à son rythme").click();
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible({ timeout: 20_000 });
  const { code } = await lancerDepuisLEditeur(page, quizId);
  await expect(page.getByRole("heading", { name: "Personne n'est encore là" })).toBeVisible();

  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await animationsEnBoucle(page)).toEqual([]);

  const solo = await ouvrirJoueur(browser, serveur, code, "Solo", { reducedMotion: "reduce" });
  expect(await solo.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await animationsEnBoucle(solo.page)).toEqual([]);
  await expect(page.getByRole("heading", { name: "Participants (1)" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Lancer la partie" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Partie en cours" })).toBeVisible();
  await axeGrave(page, "pilotage : mode libre");

  await expect(solo.page.getByRole("heading", { name: "Qui a construit l'arche ?" })).toBeVisible({ timeout: 20_000 });
  await solo.page.getByRole("button", { name: /Noé/ }).click();
  await expect(solo.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  expect(await animationsEnBoucle(solo.page)).toEqual([]);
  await axeGrave(solo.page, "joueur libre : correction");
  await solo.page.getByRole("button", { name: "Question suivante" }).click();
  await expect(solo.page.getByRole("heading", { name: "Qui a vaincu Goliath ?" })).toBeVisible();
  await solo.page.getByRole("button", { name: /Samson/ }).click();
  await expect(solo.page.getByRole("heading", { name: /PAS CETTE\s*FOIS/ })).toBeVisible();
  await solo.page.getByRole("button", { name: "Voir mon résultat" }).click();
  await expect(solo.page.getByText(/Rang : 1 \/ 1/)).toBeVisible();
  await expect(solo.page.getByRole("button", { name: "Partager mon score" })).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
  expect(await animationsEnBoucle(solo.page)).toEqual([]);
  await axeGrave(solo.page, "joueur libre : résultat");

  // Le seul joueur a fini : le serveur clôt la partie sans que l'animateur ait à le faire.
  await expect(page.getByRole("heading", { level: 1, name: "Partie terminée" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Voir le bilan de la partie" }).click();
  await hydrate(page);
  await expect(page.getByText("1 joueur")).toBeVisible();
  expect(await animationsEnBoucle(page)).toEqual([]);
  await axeGrave(page, "bilan : mode libre");
  await fermer(hote, solo.contexte);
});

test("reconnexion du joueur après une coupure réseau, dans une partie lancée par l'interface", async ({ browser }) => {
  test.setTimeout(480_000);
  const hote = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
  const page = await hote.newPage();
  await connecterParLienMagique(page, serveur, "parcours-reconnexion@exemple.fr");
  const quizId = await creerQuizParLInterface(page);
  const { code } = await lancerDepuisLEditeur(page, quizId);

  const fragile = await ouvrirJoueur(browser, serveur, code, "Fragile");
  // Chromium ne ferme pas toujours une socket ouverte en mode hors ligne : on garde les sockets pour les couper comme un réseau mobile.
  await fragile.page.addInitScript(() => {
    const Origine = window.WebSocket;
    const liste: WebSocket[] = [];
    (window as unknown as { __sockets: WebSocket[] }).__sockets = liste;
    window.WebSocket = class extends Origine {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        liste.push(this);
      }
    } as typeof WebSocket;
  });
  await fragile.page.reload();
  await expect(fragile.page.getByText("EN ATTENTE")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Participants (1)" })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Lancer la première question" }).click();
  await expect(fragile.page.getByRole("heading", { name: "Qui a construit l'arche ?" })).toBeVisible({ timeout: 20_000 });
  await fragile.page.getByRole("button", { name: /Noé/ }).click();
  await expect(fragile.page.getByText("Réponse enregistrée")).toBeVisible();

  await fragile.contexte.setOffline(true);
  await fragile.page.evaluate(() => {
    for (const ws of (window as unknown as { __sockets?: WebSocket[] }).__sockets ?? []) ws.close(4999);
  });
  await expect(fragile.page.getByText("Connexion perdue, reprise en cours…")).toBeVisible({ timeout: 30_000 });
  await axeGrave(fragile.page, "joueur : connexion perdue");

  // Pendant la coupure, l'animateur révèle la réponse : le joueur doit la retrouver au retour.
  await page.getByRole("button", { name: "Révéler la réponse" }).click();
  await page.getByRole("button", { name: /Voir la bonne réponse/ }).click();

  await fragile.contexte.setOffline(false);
  await expect(fragile.page.getByText("Connexion perdue, reprise en cours…")).toHaveCount(0, { timeout: 60_000 });
  await expect(fragile.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible({ timeout: 30_000 });
  await axeGrave(fragile.page, "joueur : reconnecté");

  await fermer(hote, fragile.contexte);
});
