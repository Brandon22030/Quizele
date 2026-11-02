import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type WebSocketRoute } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { arreterTout, lancerServeur, type ServeurLocal } from "../tableau-de-bord/serveur-local";

const SOUS_PROTOCOLE = "quizdeszeles.v1";
// Décalage propre à ce fichier (les autres specs utilisent 2 à 7, 20 et 30 à 33).
const DECALAGE = 34;

let serveur: ServeurLocal;
let compteurAdresses = 0;
type Cookie = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>[number];
let session: Cookie[] = [];

// CAPTURES_DIR : dossier des captures de revue ; sans lui, aucune image n'est écrite.
async function capturer(page: Page, nom: string, suffixe: "mobile" | "bureau" = "mobile") {
  const dossier = process.env.CAPTURES_DIR;
  if (!dossier) return;
  mkdirSync(dossier, { recursive: true });
  await page.screenshot({ path: join(dossier, `qz002-16-${nom}-${suffixe}.png`), fullPage: true });
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
    [...document.querySelectorAll("a[href], button, input")]
      .filter((el) => el.getClientRects().length > 0 && !el.closest("[inert]"))
      .map((el) => ({ nom: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
  );
  expect(petites).toEqual([]);
}

async function ouvrirSession(browser: Browser): Promise<Cookie[]> {
  const contexte = await browser.newContext();
  const page = await contexte.newPage();
  const email = `animateur${++compteurAdresses}@exemple.fr`;
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

async function rpc(page: Page, nom: string, corps: unknown, cookies = session): Promise<string> {
  await page.context().addCookies(cookies);
  const r = await page.request.post(`${serveur.url}/_actions/${nom}/`, { data: corps, headers: { origin: serveur.url } });
  expect(r.ok(), nom).toBe(true);
  return JSON.stringify(await r.json());
}

const idDans = (brut: string) => brut.match(/[0-9a-f]{8}-[0-9a-f-]{27}|[A-Za-z0-9_-]{16,}/g)?.[0] as string;

async function creerQuizPret(page: Page, mode: "together" | "own_pace" = "together"): Promise<string> {
  const quizId = idDans(await rpc(page, "quiz.creer", { modele: "figures-ancien-testament" }));
  if (mode === "own_pace") await rpc(page, "quiz.majReglages", { quizId, mode });
  return quizId;
}

async function rejoindre(pseudo: string, code: string): Promise<{ playerId: string; token: string }> {
  const res = await fetch(`${serveur.url}/api/parties/${code}/joueurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pseudo }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { playerId: string; token: string };
}

// Joueur simulé : une vraie socket qui répond à la première option de chaque question reçue.
function jouer(code: string, token: string) {
  const socket = new WebSocket(`${serveur.url.replace("http", "ws")}/ws/${code}`, [SOUS_PROTOCOLE, token]);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "resume" })));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { type: string; questionId?: string; options?: { id: string }[] };
    if (message.type === "question" && message.questionId && message.options?.[0]) {
      socket.send(JSON.stringify({ type: "answer", questionId: message.questionId, optionIds: [message.options[0].id] }));
    }
  });
  return socket;
}

// La projection est capturée en mobile, puis en 1280 x 720 (les deux fois en plein écran) ; elle est refermée à la fin.
async function capturerProjection(page: Page, nom: string) {
  const projection = page.getByRole("dialog", { name: "Projection" });
  await capturer(page, nom);
  await projection.getByRole("button", { name: "Quitter la projection" }).click();
  await expect(projection).toHaveCount(0);
  // Le plein écran se quitte de façon asynchrone ; redimensionner avant échouerait.
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Projeter" }).click();
  await expect(projection).toBeVisible();
  await expect(projection.locator('[aria-busy="true"]')).toHaveCount(0);
  await capturer(page, nom, "bureau");
  await projection.getByRole("button", { name: "Quitter la projection" }).click();
  await expect(projection).toHaveCount(0);
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.setViewportSize({ width: 390, height: 844 });
}

// Le code vient du stockage de transmission, la même source que la page de pilotage.
async function codeDeLaPartie(page: Page, sessionId: string): Promise<string> {
  const code = await page.evaluate((id) => (JSON.parse(sessionStorage.getItem(`quizdeszeles:hote:${id}`) ?? "null") as { code?: string } | null)?.code, sessionId);
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return code!;
}

async function lancerDepuisK7(page: Page, quizId: string): Promise<{ sessionId: string; code: string }> {
  await page.context().addCookies(session);
  await page.goto(`${serveur.url}/quiz/${quizId}/lancer`);
  await hydrate(page);
  await page.getByRole("button", { name: "Lancer la partie" }).click();
  await expect(page).toHaveURL(/\/partie\/[\w-]+$/);
  const sessionId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return { sessionId, code: await codeDeLaPartie(page, sessionId) };
}

test.beforeEach(({ browserName: _navigateur }, testInfo) => {
  // Les parcours tournent une fois, en mobile ; les captures bureau fixent leur viewport dans le test.
  test.skip(testInfo.project.name !== "mobile", "parcours mobile, la vue bureau est capturée en fixant le viewport");
});

test.describe("lancement, pilotage et projection (session réelle)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(DECALAGE);
    session = await ouvrirSession(browser);
  });
  test.afterAll(() => arreterTout());

  test("k7 : quiz incomplet, bouton inactif et renvoi direct vers la question à compléter", async ({ page }) => {
    const quizId = idDans(await rpc(page, "quiz.creer", { title: "Les paraboles" }));
    const question = (prompt: string, bonne: boolean) => ({
      type: "single",
      prompt,
      durationSec: 20,
      options: [
        { label: bonne ? "Oui" : "", isCorrect: bonne },
        { label: bonne ? "Non" : "", isCorrect: false },
      ],
    });
    await rpc(page, "quiz.ajouterQuestion", { quizId, question: question("Une première question ?", true) });
    await rpc(page, "quiz.ajouterQuestion", { quizId, question: question("", false) });
    await page.goto(`${serveur.url}/quiz/${quizId}/lancer`);
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1, name: "PRÊT ?" })).toBeFocused();
    await expect(page.getByText("1 question à compléter")).toBeVisible();
    await expect(page.getByText("Tout le monde ensemble")).toBeVisible();
    await expect(page.getByRole("button", { name: "Lancer la partie" })).toBeDisabled();
    const lien = page.getByRole("link", { name: "Aller à la question 2" });
    await expect(lien).toHaveAttribute("href", `/quiz/${quizId}?question=2`);
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k7-incomplet");
    await lien.click();
    await expect(page).toHaveURL(new RegExp(`/quiz/${quizId}\\?question=2$`));
  });

  test("k7 : quiz introuvable et quiz d'un autre compte", async ({ page, browser }) => {
    await page.context().addCookies(session);
    await page.goto(`${serveur.url}/quiz/inconnu/lancer`);
    await hydrate(page);
    await expect(page.getByRole("alert")).toContainText("Quiz introuvable");
    await expect(page.getByRole("link", { name: "Retour au tableau de bord" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k7-introuvable");

    const quizId = await creerQuizPret(page);
    const autre = await ouvrirSession(browser);
    const contexte = await browser.newContext();
    await contexte.addCookies(autre);
    const page2 = await contexte.newPage();
    await page2.goto(`${serveur.url}/quiz/${quizId}/lancer`);
    await hydrate(page2);
    await expect(page2.getByRole("alert")).toContainText("Quiz introuvable");
    await contexte.close();
  });

  test("k7 puis g : lancement, jeton hôte hors URL et HTML, joueurs, retrait, projection", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: serveur.url });
    const quizId = await creerQuizPret(page);

    await page.goto(`${serveur.url}/quiz/${quizId}/lancer`);
    await hydrate(page);
    await expect(page.getByText("7 questions complètes")).toBeVisible();
    await expect(page.getByText(/7 questions - environ \d+ min/)).toBeVisible();
    await expect(page.getByText("Bonne réponse montrée après chaque question")).toBeVisible();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k7-pret");
    await page.setViewportSize({ width: 1280, height: 800 });
    await capturer(page, "k7-pret", "bureau");
    await page.setViewportSize({ width: 390, height: 844 });

    await page.getByRole("button", { name: "Lancer la partie" }).click();
    await expect(page).toHaveURL(/\/partie\/[\w-]+$/);
    const sessionId = new URL(page.url()).pathname.split("/").pop() ?? "";
    await expect(page.getByRole("heading", { level: 1, name: "Grandes figures de l'Ancien Testament" })).toBeFocused();
    const code = await codeDeLaPartie(page, sessionId);

    // Sécurité : le jeton hôte n'est ni dans l'URL ni dans le HTML rendu par le serveur.
    const jeton = await page.evaluate((id) => (JSON.parse(sessionStorage.getItem(`quizdeszeles:hote:${id}`) ?? "null") as { hostToken?: string } | null)?.hostToken, sessionId);
    expect(jeton).toBeTruthy();
    expect(page.url()).not.toContain(jeton!);
    const html = await (await page.request.get(`${serveur.url}/partie/${sessionId}`)).text();
    expect(html).not.toContain(jeton!);
    expect(html).not.toContain("hostToken");

    // Vide : personne n'est encore là, le QR et le lien sont affichés.
    await expect(page.getByRole("heading", { name: "Personne n'est encore là" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Participants (0)" })).toBeVisible();
    await expect(page.getByRole("img", { name: "QR code pour rejoindre la partie" })).toBeVisible();
    await expect(page.getByText(new RegExp(`/j/${code}$`))).toBeVisible();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "g-vide");

    await page.getByRole("button", { name: "Copier le lien" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Lien copié." })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${serveur.url}/j/${code}`);
    // Le toast s'anime à l'apparition (échelle) : il est fermé avant de mesurer les cibles tactiles.
    await page.getByRole("button", { name: "Fermer le message" }).click();

    // Deux joueurs rejoignent par l'API : ils apparaissent sans rechargement.
    await rejoindre("Esther.B", code);
    await rejoindre("Grâce_22", code);
    await expect(page.getByRole("heading", { name: "Participants (2)" })).toBeVisible();
    await expect(page.locator("main [aria-live=polite]").filter({ hasText: "En attente des joueurs. 2 participants" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Retirer Esther.B" })).toBeVisible();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "g-joueurs");
    await page.setViewportSize({ width: 1280, height: 800 });
    await capturer(page, "g-joueurs", "bureau");
    await page.setViewportSize({ width: 390, height: 844 });

    // Retrait avec confirmation : annuler ne change rien, confirmer retire le joueur et rend le focus au titre.
    await page.getByRole("button", { name: "Retirer Grâce_22" }).click();
    const dialogue = page.getByRole("dialog", { name: "Retirer Grâce_22 ?" });
    await expect(dialogue).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "g-retrait");
    await dialogue.getByRole("button", { name: "Annuler" }).click();
    await expect(page.getByRole("heading", { name: "Participants (2)" })).toBeVisible();
    await page.getByRole("button", { name: "Retirer Grâce_22" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
    await expect(page.getByRole("heading", { name: "Participants (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retirer Grâce_22" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Participants (1)" })).toBeFocused();

    // Projection : vue plein écran en fond forêt, code en très grand, sans bouton de pilotage.
    await page.getByRole("button", { name: "Projeter" }).click();
    const projection = page.getByRole("dialog", { name: "Projection" });
    await expect(projection).toBeVisible();
    await expect(projection).toHaveAttribute("data-theme", "foret");
    await expect(projection.getByText(`Code de la partie : ${code}`)).toBeAttached();
    await expect(projection.getByText("Esther.B")).toBeVisible();
    await expect(projection.getByRole("button", { name: /Lancer|Révéler|Terminer/ })).toHaveCount(0);
    await expect(projection.getByRole("heading", { level: 1, name: "Grandes figures de l'Ancien Testament" })).toBeFocused();
    expect(await axe(page)).toEqual([]);
    // Plein écran réellement demandé au navigateur (Fullscreen API), puis quitté avec la vue.
    expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await capturerProjection(page, "i-salle");
    await expect(page.getByRole("button", { name: "Projeter" })).toBeFocused();
    await page.getByRole("button", { name: "Projeter" }).click();
    await expect(projection).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(projection).toHaveCount(0);
  });

  test("pilotage d'une partie ensemble : start, reveal, next, end, avec joueur, reprise et projection", async ({ page, browser }) => {
    const quizId = await creerQuizPret(page);
    const { sessionId, code } = await lancerDepuisK7(page, quizId);
    const joueur = await rejoindre("Esther.B", code);
    await expect(page.getByRole("heading", { name: "Participants (1)" })).toBeVisible();

    // Connecté avant le départ : il reçoit la question diffusée et y répond.
    const socket = jouer(code, joueur.token);
    await page.getByRole("button", { name: "Lancer la première question" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Question 1 sur 7" })).toBeFocused();
    await expect(page.getByText("Qui a construit l'arche ?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Révéler la réponse" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Question suivante" })).toBeDisabled();
    await expect(page.getByRole("progressbar", { name: "Réponses reçues" })).toHaveAttribute("aria-valuenow", "1");
    await expect(page.getByRole("timer")).toBeVisible();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k8-question");
    await page.setViewportSize({ width: 1280, height: 800 });
    await capturer(page, "k8-question", "bureau");
    await page.setViewportSize({ width: 390, height: 844 });

    // Projection pendant la question : énoncé, chrono et compteur, sans commande.
    await page.getByRole("button", { name: "Projeter" }).click();
    const projection = page.getByRole("dialog", { name: "Projection" });
    await expect(projection.getByText("Qui a construit l'arche ?")).toBeVisible();
    await expect(projection.getByRole("timer")).toBeVisible();
    await expect(projection.getByRole("progressbar", { name: "Réponses reçues" })).toHaveAttribute("aria-valuenow", "1");
    await expect(projection.getByRole("button", { name: /Lancer|Révéler|Suivante|Terminer/ })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    await capturerProjection(page, "i-question");

    // Reprise : un autre onglet n'a pas le jeton en sessionStorage et passe par l'action jetonHote.
    const autreOnglet = await page.context().newPage();
    const reponseJeton = autreOnglet.waitForResponse((r) => r.url().includes("/_actions/partie.jetonHote"));
    await autreOnglet.goto(`${serveur.url}/partie/${sessionId}`);
    expect((await reponseJeton).status()).toBe(200);
    await expect(autreOnglet.getByRole("heading", { level: 1, name: "Question 1 sur 7" })).toBeVisible();
    await autreOnglet.close();

    await page.getByRole("button", { name: "Révéler la réponse" }).click();
    await expect(page.getByText("B. Noé")).toBeVisible();
    await expect(page.getByRole("button", { name: "Révéler la réponse" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Question suivante" })).toBeEnabled();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k8-correction");

    await page.getByRole("button", { name: "Projeter" }).click();
    await expect(projection.getByText("Bonne réponse", { exact: true })).toBeVisible();
    await expect(projection.getByRole("list", { name: "Classement" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturerProjection(page, "i-correction");

    await page.getByRole("button", { name: "Question suivante" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Question 2 sur 7" })).toBeFocused();

    // Rechargement du même onglet puis perte de la clé : la partie reprend dans l'état où elle était.
    await page.reload();
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Question 2 sur 7" })).toBeVisible();
    await page.evaluate((id) => sessionStorage.removeItem(`quizdeszeles:hote:${id}`), sessionId);
    const reprise = page.waitForResponse((r) => r.url().includes("/_actions/partie.jetonHote"));
    await page.reload();
    expect((await reprise).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Question 2 sur 7" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Révéler la réponse" })).toBeEnabled();

    // Fin : confirmation, puis classement et lien vers le bilan.
    await page.getByRole("button", { name: "Terminer et afficher les résultats" }).click();
    const confirmation = page.getByRole("dialog", { name: "Terminer la partie ?" });
    await expect(confirmation).toBeVisible();
    await capturer(page, "k8-confirmation-fin");
    await confirmation.getByRole("button", { name: "Continuer à jouer" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Question 2 sur 7" })).toBeVisible();
    await page.getByRole("button", { name: "Terminer et afficher les résultats" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Terminer la partie" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Partie terminée" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Voir le bilan de la partie" })).toHaveAttribute("href", `/partie/${sessionId}/bilan`);
    await expect(page.getByText("Esther.B").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Révéler|Question suivante|Terminer/ })).toHaveCount(0);
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k8-fin");
    socket.close();

    // Partie terminée : le jeton ne se redemande plus, la page dit que la partie n'existe plus pour le pilotage.
    const apres = await browser.newContext();
    await apres.addCookies(session);
    const page2 = await apres.newPage();
    await page2.goto(`${serveur.url}/partie/${sessionId}`);
    await expect(page2.getByRole("heading", { level: 1, name: "Partie introuvable" })).toBeAttached();
    await expect(page2.getByRole("alert")).toContainText("déjà terminée");
    await apres.close();
  });

  test("mode « Chacun à son rythme » : Terminer la partie toujours visible avec le nombre de joueurs ayant fini", async ({ page }) => {
    const quizId = await creerQuizPret(page, "own_pace");
    await page.goto(`${serveur.url}/quiz/${quizId}/lancer`);
    await hydrate(page);
    await expect(page.getByText("Chacun à son rythme")).toBeVisible();
    await page.getByRole("button", { name: "Lancer la partie" }).click();
    await expect(page).toHaveURL(/\/partie\/[\w-]+$/);
    const code = await codeDeLaPartie(page, new URL(page.url()).pathname.split("/").pop() ?? "");
    await rejoindre("Esther.B", code);
    await expect(page.getByRole("heading", { name: "Participants (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Terminer la partie" })).toBeEnabled();

    await page.getByRole("button", { name: "Lancer la partie" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Partie en cours" })).toBeFocused();
    await expect(page.getByText("0 joueur sur 1 a fini.")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Joueurs ayant fini" })).toHaveAttribute("aria-valuemax", "1");
    await expect(page.getByRole("button", { name: "Révéler la réponse" })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k8-libre");

    await page.getByRole("button", { name: "Terminer la partie" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Terminer la partie" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Partie terminée" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Voir le bilan de la partie" })).toBeVisible();
  });

  test("erreurs : partie inconnue et partie d'un autre animateur", async ({ page, browser }) => {
    const quizId = await creerQuizPret(page);
    const { sessionId } = await lancerDepuisK7(page, quizId);

    await page.context().clearCookies();
    await page.context().addCookies(session);
    await page.goto(`${serveur.url}/partie/identifiant-inconnu`);
    await hydrate(page);
    await expect(page.getByRole("alert")).toContainText("Partie introuvable");
    await expect(page.getByRole("link", { name: "Retour au tableau de bord" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "g-introuvable");

    const autre = await ouvrirSession(browser);
    const contexte = await browser.newContext();
    await contexte.addCookies(autre);
    const page2 = await contexte.newPage();
    await page2.goto(`${serveur.url}/partie/${sessionId}`);
    await hydrate(page2);
    await expect(page2.getByRole("alert")).toContainText("autre animateur");
    await contexte.close();

    // Sans session : redirection vers la connexion, avec retour à la page de pilotage.
    const anonyme = await browser.newContext();
    const page3 = await anonyme.newPage();
    await page3.goto(`${serveur.url}/partie/${sessionId}`);
    await expect(page3).toHaveURL(/\/connexion\?retour=%2Fpartie%2F/);
    await anonyme.close();
  });

  test("chargement : squelette tant que la connexion au Durable Object n'est pas établie, puis reprise", async ({ page }) => {
    const quizId = await creerQuizPret(page);
    await lancerDepuisK7(page, quizId);
    let bloque = true;
    await page.routeWebSocket(/\/ws\//, (ws) => {
      if (bloque) ws.close({ code: 1011 });
      else ws.connectToServer();
    });
    await page.reload();
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Connexion…" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "g-chargement");

    bloque = false;
    await expect(page.getByRole("heading", { level: 1, name: "Grandes figures de l'Ancien Testament" })).toBeVisible({ timeout: 20_000 });
  });

  test("connexion perdue en cours de partie : commandes suspendues, reprise automatique", async ({ page }) => {
    const quizId = await creerQuizPret(page);
    await lancerDepuisK7(page, quizId);
    let premiere: WebSocketRoute | null = null;
    let coupe = false;
    await page.routeWebSocket(/\/ws\//, (ws) => {
      if (coupe) {
        ws.close({ code: 1011 });
        return;
      }
      premiere = ws;
      ws.connectToServer();
    });
    await page.reload();
    const demarrer = page.getByRole("button", { name: "Lancer la première question" });
    await expect(demarrer).toBeEnabled();

    coupe = true;
    premiere!.close({ code: 1011 });
    const statut = page.getByRole("status").filter({ hasText: "Connexion perdue, reprise en cours" });
    await expect(statut).toBeVisible();
    await expect(demarrer).toBeDisabled();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "g-connexion-perdue");

    coupe = false;
    await expect(statut).toHaveCount(0, { timeout: 30_000 });
    await expect(demarrer).toBeEnabled();
  });
});
