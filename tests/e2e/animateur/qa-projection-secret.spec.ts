import { expect, test, type Browser, type Page } from "@playwright/test";
import { parse } from "devalue";
import { arreterTout, lancerServeur, type ServeurLocal } from "../tableau-de-bord/serveur-local";

const SOUS_PROTOCOLE = "quizdeszeles.v1";
// Décalage propre à ce fichier (pilotage.spec.ts utilise 34).
const DECALAGE = 35;

// Marqueurs de la correction de la première question du modèle : ils ne doivent jamais atteindre l'écran projeté.
const EXPLICATION = "Dieu demande à Noé de se faire une arche.";
const REFERENCE = "Genèse 6:14";
const CLES_INTERDITES = ["correctOptionIds", "isCorrect", "explanation", "reference", "wasCorrect", "ranking"];

let serveur: ServeurLocal;
let compteur = 0;
type Cookie = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>[number];
let session: Cookie[] = [];

async function ouvrirSession(browser: Browser): Promise<Cookie[]> {
  const contexte = await browser.newContext();
  const page = await contexte.newPage();
  const email = `secret${++compteur}@exemple.fr`;
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

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
}

// Appel d'Action avec la vraie session : la réponse Astro est sérialisée par devalue.
async function action<T>(page: Page, nom: string, corps: unknown): Promise<T> {
  await page.context().addCookies(session);
  const r = await page.request.post(`${serveur.url}/_actions/${nom}/`, { data: corps, headers: { origin: serveur.url } });
  expect(r.ok(), `${nom} : ${r.status()}`).toBe(true);
  return parse(await r.text()) as T;
}

async function quizSansCorrection(page: Page): Promise<string> {
  const { quizId } = await action<{ quizId: string }>(page, "quiz.creer", { modele: "figures-ancien-testament" });
  expect(quizId).toBeTruthy();
  await action(page, "quiz.majReglages", { quizId, showCorrectAnswer: false });
  return quizId;
}

async function rejoindre(pseudo: string, code: string): Promise<{ playerId: string; token: string }> {
  const res = await fetch(`${serveur.url}/api/parties/${code}/joueurs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pseudo }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { playerId: string; token: string };
}

interface Ecoute {
  socket: WebSocket;
  trames: string[];
  messages: () => { type: string; [cle: string]: unknown }[];
  envoyer: (message: unknown) => void;
}

function ecouter(code: string, token: string): Ecoute {
  const socket = new WebSocket(`${serveur.url.replace("http", "ws")}/ws/${code}`, [SOUS_PROTOCOLE, token]);
  const trames: string[] = [];
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "resume" })));
  socket.addEventListener("message", (e) => trames.push(String(e.data)));
  const messages = () => trames.map((t) => JSON.parse(t) as { type: string });
  return {
    socket,
    trames,
    messages,
    envoyer: (m) => socket.send(JSON.stringify(m)),
  };
}

async function attendreTrame(e: Ecoute, predicat: (m: { type: string; [cle: string]: unknown }) => boolean, depuis = 0, delaiMs = 10_000) {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    if (e.messages().slice(depuis).some(predicat)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`trame attendue absente : ${e.trames.slice(depuis).join(" | ").slice(0, 400)}`);
}

function assertSansCorrection(trames: string[], nom: string) {
  const brut = trames.join("\n");
  for (const cle of CLES_INTERDITES) expect(brut, `${nom} : clé ${cle}`).not.toContain(`"${cle}"`);
  expect(brut, `${nom} : explication`).not.toContain(EXPLICATION);
  expect(brut, `${nom} : référence`).not.toContain(REFERENCE);
}

test.beforeEach(({ browserName: _n }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "parcours unique, la sécurité ne dépend pas du viewport");
});

test.describe("QA : la bonne réponse n'atteint jamais l'écran projeté (réglage « ne pas montrer »)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(DECALAGE);
    session = await ouvrirSession(browser);
  });
  test.afterAll(() => arreterTout());

  test("trames reçues par la socket écran : ni correction, ni classement, ni score avant la fin ; l'hôte, lui, la reçoit", async ({ page }) => {
    const quizId = await quizSansCorrection(page);
    const lancement = await action<{ sessionId: string; code: string; hostToken: string }>(page, "partie.lancer", { quizId });
    const { sessionId, code, hostToken } = lancement;
    const ecran = await action<{ code: string; token: string }>(page, "partie.jetonEcran", { sessionId });
    expect(JSON.stringify(ecran)).not.toMatch(/correct|explanation/i);

    const joueur = await rejoindre("Esther.B", code);
    const hote = ecouter(code, hostToken);
    const projete = ecouter(code, ecran.token);
    const joueurSocket = ecouter(code, joueur.token);
    joueurSocket.socket.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data)) as { type: string; questionId?: string; options?: { id: string }[] };
      if (m.type === "question" && m.questionId && m.options?.[0]) joueurSocket.envoyer({ type: "answer", questionId: m.questionId, optionIds: [m.options[0].id] });
    });
    await attendreTrame(hote, (m) => m.type === "snapshot");
    await attendreTrame(projete, (m) => m.type === "snapshot" && m.role === "screen");

    const parcourir = async (n: number) => {
      hote.envoyer({ type: "start" });
      for (let i = 0; i < n; i++) {
        const avantHote = hote.trames.length;
        if (i > 0) hote.envoyer({ type: "next" });
        await attendreTrame(hote, (m) => m.type === "question", avantHote);
        const avantReveal = hote.trames.length;
        await new Promise((r) => setTimeout(r, 300));
        hote.envoyer({ type: "reveal" });
        await attendreTrame(hote, (m) => m.type === "reveal", avantReveal);
      }
    };
    await parcourir(3);

    // Contrôle positif : l'hôte reçoit bien la correction, sinon le test ne prouverait rien.
    const revelationsHote = hote.messages().filter((m) => m.type === "reveal");
    expect(revelationsHote.length).toBeGreaterThanOrEqual(3);
    expect(revelationsHote[0]!.correctOptionIds).toBeTruthy();
    expect(JSON.stringify(revelationsHote[0])).toContain(EXPLICATION);

    // L'écran a reçu les mêmes révélations, mais vidées de toute correction.
    await attendreTrame(projete, (m) => m.type === "reveal");
    const revelationsEcran = projete.messages().filter((m) => m.type === "reveal");
    expect(revelationsEcran.length).toBeGreaterThanOrEqual(3);
    for (const r of revelationsEcran) expect(Object.keys(r).sort()).toEqual(["questionId", "type"]);
    assertSansCorrection(projete.trames, "écran");
    assertSansCorrection(joueurSocket.trames, "joueur");

    // Une reconnexion de l'écran en phase « correction » renvoie un instantané lui aussi sans correction.
    const idBonne = (revelationsHote[0]!.correctOptionIds as string[])[0]!;
    const ecran2 = await action<{ code: string; token: string }>(page, "partie.jetonEcran", { sessionId });
    const reconnecte = ecouter(code, ecran2.token);
    await attendreTrame(reconnecte, (m) => m.type === "snapshot");
    const instantane = reconnecte.messages().find((m) => m.type === "snapshot") as { phase?: string; reveal?: Record<string, unknown> };
    expect(instantane.phase).toBe("revealed");
    expect(Object.keys(instantane.reveal ?? {}).sort()).toEqual(["questionId"]);
    assertSansCorrection(reconnecte.trames, "écran reconnecté");
    expect(JSON.stringify(reconnecte.messages().find((m) => m.type === "snapshot"))).not.toContain(`"you"`);

    // L'identifiant de bonne réponse apparaît dans la question (c'est une option), jamais dans un message de correction.
    for (const r of revelationsEcran) expect(JSON.stringify(r)).not.toContain(idBonne);

    // Le rôle écran est en lecture seule.
    const avant = projete.trames.length;
    projete.envoyer({ type: "reveal" });
    projete.envoyer({ type: "end" });
    await attendreTrame(projete, (m) => m.type === "error" && m.code === "forbidden", avant);

    // À la fin, le classement est légitimement transmis.
    hote.envoyer({ type: "end" });
    await attendreTrame(projete, (m) => m.type === "finished", 0, 15_000);

    for (const e of [hote, projete, joueurSocket, reconnecte]) e.socket.close();
  });

  test("navigateur : la projection ne montre jamais la bonne réponse, ni à l'écran ni dans ses trames", async ({ page }) => {
    const quizId = await quizSansCorrection(page);
    const { sessionId, code, hostToken } = await action<{ sessionId: string; code: string; hostToken: string }>(page, "partie.lancer", { quizId });
    // La page de pilotage lit le jeton dans sessionStorage, comme après un vrai lancement.
    await page.goto(`${serveur.url}/connexion`);
    await page.evaluate(([id, c, t]) => sessionStorage.setItem(`quizdeszeles:hote:${id}`, JSON.stringify({ code: c, hostToken: t })), [sessionId, code, hostToken] as const);
    const joueur = await rejoindre("Esther.B", code);
    const socketJoueur = ecouter(code, joueur.token);
    socketJoueur.socket.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data)) as { type: string; questionId?: string; options?: { id: string }[] };
      if (m.type === "question" && m.questionId && m.options?.[0]) socketJoueur.envoyer({ type: "answer", questionId: m.questionId, optionIds: [m.options[0].id] });
    });

    await page.goto(`${serveur.url}/partie/${sessionId}`);
    await hydrate(page);
    await expect(page.getByRole("heading", { name: "Participants (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Lancer la première question" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Question 1 sur 7" })).toBeVisible();

    const ecranTrames: string[] = [];
    // L'événement ne se déclenche que pour les sockets ouvertes après son branchement : la télécommande est déjà ouverte, seule la socket écran est écoutée.
    page.on("websocket", (ws) => ws.on("framereceived", (f) => ecranTrames.push(String(f.payload))));
    await page.getByRole("button", { name: "Projeter" }).click();
    const projection = page.getByRole("dialog", { name: "Projection" });
    await expect(projection).toBeVisible();
    await expect(projection.getByText("Qui a construit l'arche ?")).toBeVisible();
    await expect.poll(() => ecranTrames.length).toBeGreaterThan(0);

    // La télécommande est inerte sous la projection : on révèle via un accès hôte direct.
    const hote = ecouter(code, hostToken);
    await attendreTrame(hote, (m) => m.type === "snapshot");
    hote.envoyer({ type: "reveal" });
    await expect(projection.getByText("La bonne réponse n'est pas montrée pour ce quiz.")).toBeVisible({ timeout: 10_000 });
    await expect(projection.getByText("Bonne réponse", { exact: true })).toHaveCount(0);
    const texte = await projection.innerText();
    expect(texte).not.toContain(EXPLICATION);
    expect(texte).not.toContain(REFERENCE);
    // Aucune tuile n'est marquée juste : pas de badge, pas d'état « juste » exposé.
    await expect(projection.locator('[data-etat="juste"], [data-state="juste"]')).toHaveCount(0);
    const html = await projection.innerHTML();
    expect(html).not.toContain("Bonne réponse<");
    assertSansCorrection(ecranTrames, "navigateur écran");
    expect(ecranTrames.some((t) => t.includes('"type":"reveal"'))).toBe(true);

    // Rien dans le stockage ni dans le HTML serveur non plus.
    const pageHtml = await (await page.request.get(`${serveur.url}/partie/${sessionId}`)).text();
    expect(pageHtml).not.toContain(EXPLICATION);
    hote.socket.close();
    socketJoueur.socket.close();
  });

  test("contrôle positif : réglage par défaut, l'écran reçoit la correction (le détecteur des tests ci-dessus fonctionne)", async ({ page }) => {
    const { quizId } = await action<{ quizId: string }>(page, "quiz.creer", { modele: "figures-ancien-testament" });
    const { sessionId, code, hostToken } = await action<{ sessionId: string; code: string; hostToken: string }>(page, "partie.lancer", { quizId });
    const ecran = await action<{ code: string; token: string }>(page, "partie.jetonEcran", { sessionId });
    await rejoindre("Esther.B", code);
    const hote = ecouter(code, hostToken);
    const projete = ecouter(code, ecran.token);
    await attendreTrame(projete, (m) => m.type === "snapshot");
    hote.envoyer({ type: "start" });
    await attendreTrame(hote, (m) => m.type === "question");
    hote.envoyer({ type: "reveal" });
    await attendreTrame(projete, (m) => m.type === "reveal");
    const reveal = projete.messages().find((m) => m.type === "reveal")!;
    expect(reveal.correctOptionIds).toHaveLength(1);
    expect(projete.trames.join("\n")).toContain(EXPLICATION);
    hote.socket.close();
    projete.socket.close();
  });

  test("non propriétaire et joueur : aucun jeton hôte ou écran, aucune commande de pilotage", async ({ page, browser }) => {
    const { quizId } = await action<{ quizId: string }>(page, "quiz.creer", { modele: "figures-ancien-testament" });
    const { sessionId, code } = await action<{ sessionId: string; code: string }>(page, "partie.lancer", { quizId });
    const joueur = await rejoindre("Esther.B", code);

    const autre = await ouvrirSession(browser);
    const contexte = await browser.newContext();
    await contexte.addCookies(autre);
    const intrus = await contexte.newPage();
    for (const nom of ["partie.jetonHote", "partie.jetonEcran"]) {
      const r = await intrus.request.post(`${serveur.url}/_actions/${nom}/`, { data: { sessionId }, headers: { origin: serveur.url } });
      expect(r.status(), nom).toBe(404);
      expect(await r.text(), nom).not.toContain(code);
    }
    const lancement = await intrus.request.post(`${serveur.url}/_actions/partie.lancer/`, { data: { quizId }, headers: { origin: serveur.url } });
    expect(lancement.ok()).toBe(false);
    await contexte.close();

    const anonyme = await browser.newContext();
    const r = await anonyme.request.post(`${serveur.url}/_actions/partie.jetonHote/`, { data: { sessionId }, headers: { origin: serveur.url } });
    expect(r.status()).toBe(401);
    await anonyme.close();

    // Un joueur qui présente son jeton ne peut ni démarrer ni révéler ni terminer.
    const socket = ecouter(code, joueur.token);
    await attendreTrame(socket, (m) => m.type === "snapshot");
    for (const type of ["start", "reveal", "next", "end"]) {
      const avant = socket.trames.length;
      socket.envoyer({ type });
      await attendreTrame(socket, (m) => m.type === "error" && m.code === "forbidden", avant);
    }
    // Un jeton quelconque est refusé à la connexion.
    const faux = ecouter(code, "jeton-invalide");
    const ferme = await new Promise<number>((resolve) => faux.socket.addEventListener("close", (e) => resolve(e.code)));
    expect(ferme).not.toBe(1000);
    socket.socket.close();
  });
});
