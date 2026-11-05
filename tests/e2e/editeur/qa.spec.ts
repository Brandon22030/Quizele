import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Cookie, type Page } from "@playwright/test";
import { arreterTout, lancerServeur, type ServeurLocal } from "../connexion/serveur-local";

// QA indépendante : vraie session Better Auth, vraies Actions, D1 jetable. Seule la coupure réseau est simulée.

let serveur: ServeurLocal;
let session: Cookie[] = [];
let compteur = 0;

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

async function controles(page: Page) {
  const petites = await page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input:not(.sr-only), textarea")]
      .filter((el) => !el.closest("[aria-hidden=true]") && !el.matches(".sr-only"))
      .map((el) => ({ nom: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
  );
  expect(petites, "cibles de moins de 44 px").toEqual([]);
  const largeur = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "débordement horizontal").toBeLessThanOrEqual(largeur);
}

async function ouvrirSession(browser: Browser): Promise<Cookie[]> {
  const contexte = await browser.newContext();
  const page = await contexte.newPage();
  const email = `qa-editeur${++compteur}@exemple.fr`;
  const r = await page.request.post(`${serveur.url}/api/auth/sign-in/magic-link`, { data: { email, callbackURL: "/tableau-de-bord" }, headers: { origin: serveur.url } });
  expect(r.ok()).toBe(true);
  await page.goto(await serveur.lienMagique(email));
  const cookies = await contexte.cookies();
  await contexte.close();
  return cookies;
}

async function connecter(page: Page, chemin: string) {
  await page.context().addCookies(session);
  await page.goto(`${serveur.url}${chemin}`);
}

async function rpc(page: Page, nom: string, corps: unknown): Promise<string> {
  await page.context().addCookies(session);
  const r = await page.request.post(`${serveur.url}/_actions/quiz.${nom}/`, { data: corps, headers: { origin: serveur.url } });
  expect(r.ok(), `quiz.${nom}`).toBe(true);
  return JSON.stringify(await r.json());
}

const idDans = (brut: string, exclu: string[] = []) => brut.match(/[0-9a-f]{8}-[0-9a-f-]{27}|[A-Za-z0-9_-]{16,}/g)?.find((m) => !exclu.includes(m)) as string;

const question = (prompt: string, bonne = 0) => ({
  type: "single",
  prompt,
  durationSec: 20,
  options: [
    { label: "Réponse un", isCorrect: bonne === 0 },
    { label: "Réponse deux", isCorrect: bonne === 1 },
  ],
});

async function quizAvec(page: Page, titre: string, prompts: string[]): Promise<string> {
  const id = idDans(await rpc(page, "creer", { title: titre }), [titre]);
  for (const p of prompts) await rpc(page, "ajouterQuestion", { quizId: id, question: question(p) });
  return id;
}

// La pilule d'en-tête n'est plus une région live (elle changeait à chaque frappe) : on la lit par son texte exact.
const statut = (page: Page) => page.locator("header").getByText(/^(Enregistré|Enregistrement…|Non enregistré|En attente)$/);
const enregistre = (page: Page) => expect(statut(page)).toHaveText("Enregistré", { timeout: 20_000 });
const charger = (page: Page, id: string) => rpc(page, "charger", { quizId: id });

test.beforeEach(({ browserName: _n }, info) => {
  test.skip(info.project.name !== "mobile", "parcours mobile ; la vue bureau règle son viewport elle-même");
});

test.describe("éditeur : QA, session réelle", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    serveur = await lancerServeur(32);
    session = await ouvrirSession(browser);
  });
  test.afterAll(() => arreterTout());

  test("création : saisie rapide et double clic ne créent qu'un seul quiz, URL /quiz/<id>", async ({ page }) => {
    await connecter(page, "/quiz/nouveau");
    await hydrate(page);
    await page.getByLabel("Énoncé de la question 1").pressSequentially("Question tapée très vite", { delay: 0 });
    await expect(page.getByText("Ajoute un titre pour enregistrer ton quiz.")).toBeVisible();
    await page.getByLabel("Titre du quiz").pressSequentially("Titre unique rapide", { delay: 0 });
    await page.getByLabel("Réponse A", { exact: true }).fill("Alpha");
    await page.getByLabel("Réponse B", { exact: true }).fill("Bêta");
    await page.getByRole("button", { name: "Marquer B comme bonne réponse" }).dblclick();
    await expect(page).toHaveURL(/\/quiz\/(?!nouveau)[^/]+$/, { timeout: 20_000 });
    await enregistre(page);
    const liste = await rpc(page, "lister", {});
    expect((liste.match(/Titre unique rapide/g) ?? []).length).toBe(1);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    const brut = await charger(page, id);
    expect(brut).toContain("Question tapée très vite");
    expect(brut).toContain("Alpha");
  });

  test("création : un titre vidé après coup réaffiche le message au lieu d'échouer", async ({ page }) => {
    await connecter(page, "/quiz/nouveau");
    await hydrate(page);
    await page.getByLabel("Titre du quiz").fill("A");
    await page.getByLabel("Titre du quiz").fill("");
    await page.getByLabel("Énoncé de la question 1").fill("Sans titre");
    await expect(page.getByText("Ajoute un titre pour enregistrer ton quiz.")).toBeVisible();
    await expect(page).toHaveURL(/\/quiz\/nouveau$/);
  });

  test("enregistrement automatique : environ 800 ms après la dernière frappe, pas avant", async ({ page }) => {
    const id = await quizAvec(page, "Délai", ["Question de départ"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await enregistre(page);
    const requetes: number[] = [];
    await page.route("**/_actions/quiz.majQuestion/**", (r) => (requetes.push(Date.now()), r.continue()));
    await page.getByLabel("Énoncé de la question 1").click();
    const debut = Date.now();
    await page.keyboard.type("abc", { delay: 100 });
    await expect(statut(page)).not.toHaveText("Enregistré");
    await enregistre(page);
    expect(requetes.length).toBe(1);
    // La dernière frappe part au plus tôt 2 x 100 ms après `debut` : mesurer depuis le retour de type() ajoutait la latence
    // du pilote (sous charge, de quoi tomber sous le seuil alors que le délai applicatif est correct).
    expect(requetes[0]! - debut).toBeGreaterThanOrEqual(200 + 650);
    expect(requetes[0]! - debut).toBeLessThan(5_000);
  });

  test("deux modifications rapides : la base contient la dernière, jamais l'intermédiaire", async ({ page }) => {
    const id = await quizAvec(page, "Dernière gagne", ["Départ"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await page.getByLabel("Énoncé de la question 1").fill("Intermédiaire");
    await page.getByLabel("Énoncé de la question 1").fill("Valeur finale");
    await page.getByLabel("Titre du quiz").fill("Titre intermédiaire");
    await page.getByLabel("Titre du quiz").fill("Titre final");
    await enregistre(page);
    const brut = await charger(page, id);
    expect(brut).toContain("Valeur finale");
    expect(brut).toContain("Titre final");
    expect(brut).not.toContain("Intermédiaire");
    expect(brut).not.toContain("Titre intermédiaire");
  });

  test("rechargement pendant une modification en attente : le brouillon est repris puis envoyé", async ({ page }) => {
    const id = await quizAvec(page, "Reprise", ["Avant rechargement"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await page.route("**/_actions/quiz.majQuestion/**", (r) => r.abort("internetdisconnected"));
    await page.getByLabel("Énoncé de la question 1").fill("Gardé localement");
    await expect(statut(page)).toHaveText("Non enregistré", { timeout: 10_000 });
    expect(await charger(page, id)).not.toContain("Gardé localement");
    await page.unroute("**/_actions/quiz.majQuestion/**");
    await page.reload();
    await hydrate(page);
    await expect(page.getByLabel("Énoncé de la question 1")).toHaveValue("Gardé localement");
    await enregistre(page);
    expect(await charger(page, id)).toContain("Gardé localement");
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("quizdeszeles:editeur:")))).toEqual([]);
  });

  test("durées 10, 20, 30 et 60 s : chacune persiste après rechargement", async ({ page }) => {
    const id = await quizAvec(page, "Durées", ["Durée"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    for (const duree of [10, 30, 60, 20]) {
      await page.getByRole("radio", { name: `${duree} s` }).check({ force: true });
      await enregistre(page);
      await page.reload();
      await hydrate(page);
      await expect(page.getByRole("radio", { name: `${duree} s` })).toBeChecked();
    }
    await expect(page.getByRole("radio", { name: /^(10|20|30|60) s$/ })).toHaveCount(4);
  });

  test("bornes : 300 caractères d'énoncé, 200 par réponse, 500 pour référence et explication, 4 réponses au plus", async ({ page }) => {
    const id = await quizAvec(page, "Bornes", ["Bornes"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    const enonce = page.getByLabel("Énoncé de la question 1");
    await enonce.fill("é".repeat(400));
    expect((await enonce.inputValue()).length).toBe(300);
    await expect(page.getByText("0 caractère restant")).toBeVisible();
    await page.getByLabel("Réponse A", { exact: true }).fill("a".repeat(250));
    expect((await page.getByLabel("Réponse A", { exact: true }).inputValue()).length).toBe(200);
    await page.getByText("Référence et explication").click();
    await page.getByLabel("Référence").fill("r".repeat(600));
    await page.getByLabel(/Explication/).fill("x".repeat(600));
    expect((await page.getByLabel("Référence").inputValue()).length).toBe(500);
    expect((await page.getByLabel(/Explication/).inputValue()).length).toBe(500);

    await page.getByRole("button", { name: "Ajouter une réponse" }).click();
    await page.getByRole("button", { name: "Ajouter une réponse" }).click();
    await expect(page.getByLabel(/^Réponse [A-D]$/)).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Ajouter une réponse" })).toHaveCount(0);
    await enregistre(page);
    const brut = await charger(page, id);
    expect(brut).toContain("é".repeat(300));
    expect(brut).not.toContain("é".repeat(301));
    await page.getByRole("button", { name: "Retirer la réponse D" }).click();
    await expect(page.getByLabel(/^Réponse [A-D]$/)).toHaveCount(3);
    await controles(page);
    expect(await axe(page)).toEqual([]);
  });

  test("bonne réponse : « unique » garde au plus une réponse juste après un passage par « plusieurs »", async ({ page }) => {
    const id = await quizAvec(page, "Bascule", ["Bascule"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await page.getByRole("radio", { name: "Plusieurs bonnes" }).check({ force: true });
    await page.getByRole("button", { name: "Marquer B comme bonne réponse" }).click();
    await expect(page.locator("[aria-pressed=true]")).toHaveCount(2);
    await page.getByRole("radio", { name: "Une bonne réponse" }).check({ force: true });
    await expect(page.locator("[aria-pressed=true]")).toHaveCount(1);
    await enregistre(page);
    await page.reload();
    await hydrate(page);
    await expect(page.locator("[aria-pressed=true]")).toHaveCount(1);
  });

  test("suppression d'une question : confirmation, voisine ouverte, navigation cohérente, persistant", async ({ page }) => {
    const id = await quizAvec(page, "Suppression", ["Un", "Deux", "Trois"]);
    await page.goto(`${serveur.url}/quiz/${id}?question=2`);
    await hydrate(page);
    await expect(page.getByLabel("Énoncé de la question 2")).toHaveValue("Deux");
    await page.getByRole("button", { name: "Supprimer" }).click();
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(page.getByRole("navigation", { name: "Questions" }).getByRole("button", { name: /^Question \d/ })).toHaveCount(3);
    await page.getByRole("button", { name: "Supprimer" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
    const pastilles = page.getByRole("navigation", { name: "Questions" }).getByRole("button", { name: /^Question \d/ });
    await expect(pastilles).toHaveCount(2);
    await expect(page.getByRole("navigation", { name: "Questions" }).locator("[aria-current=step]")).toHaveCount(1);
    await expect(page.getByLabel(/Énoncé de la question \d/)).toHaveValue("Trois");
    await enregistre(page);
    const brut = await charger(page, id);
    expect(brut).not.toContain('"Deux"');
    expect(brut).toContain("Trois");
    await page.reload();
    await hydrate(page);
    await expect(pastilles).toHaveCount(2);
    // Supprimer jusqu'à la dernière question : l'écran vide invite à en créer une, sans erreur.
    for (let i = 0; i < 2; i += 1) {
      await page.getByRole("button", { name: "Supprimer" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
    }
    await expect(page.getByRole("heading", { name: "Ce quiz n'a pas encore de question" })).toBeVisible();
  });

  test("statut : « Brouillon - n à compléter » devient « Prêt à jouer » quand tout est complet", async ({ page, browser }) => {
    // Compte dédié : la liste ne contient alors que ce quiz, le libellé lu est donc bien le sien.
    const sessionInitiale = session;
    session = await ouvrirSession(browser);
    try {
    const id = idDans(await rpc(page, "creer", { title: "Statut" }), ["Statut"]);
    await rpc(page, "ajouterQuestion", { quizId: id, question: { type: "single", prompt: "", durationSec: 20, options: [{ label: "", isCorrect: false }, { label: "", isCorrect: false }] } });
    await rpc(page, "ajouterQuestion", { quizId: id, question: question("Complète") });
    expect(await rpc(page, "lister", {})).toContain("Brouillon - 1 à compléter");
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await expect(page.getByRole("button", { name: "Question 1, à compléter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Question 2", exact: true })).toBeVisible();
    await page.getByLabel("Énoncé de la question 1").fill("Maintenant remplie");
    await page.getByLabel("Réponse A", { exact: true }).fill("Oui");
    await page.getByLabel("Réponse B", { exact: true }).fill("Non");
    await page.getByRole("button", { name: "Marquer A comme bonne réponse" }).click();
    await enregistre(page);
    await expect(page.getByRole("button", { name: "Question 1", exact: true })).toBeVisible();
    const liste = await rpc(page, "lister", {});
    expect(liste).toContain("Prêt à jouer");
    expect(liste).not.toContain("à compléter");
      } finally {
      session = sessionInitiale;
    }
  });

  test("/quiz/<id>?question=3 ouvre la question 3 ; un numéro hors limites ou invalide retombe sur une question existante", async ({ page }) => {
    const id = await quizAvec(page, "Paramètre", ["Un", "Deux", "Trois"]);
    await page.goto(`${serveur.url}/quiz/${id}?question=3`);
    await hydrate(page);
    await expect(page.getByLabel("Énoncé de la question 3")).toHaveValue("Trois");
    await expect(page.getByRole("button", { name: "Question 3", exact: true })).toHaveAttribute("aria-current", "step");
    for (const q of ["99", "0", "-1", "abc", "2.5"]) {
      await page.goto(`${serveur.url}/quiz/${id}?question=${q}`);
      await hydrate(page);
      await expect(page.getByRole("navigation", { name: "Questions" }).locator("[aria-current=step]"), q).toHaveCount(1);
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
  });

  test("deux onglets sur le même quiz : champs différents conservés tous les deux, même champ : la dernière écriture gagne", async ({ page, context }) => {
    const id = await quizAvec(page, "Deux onglets", ["Départ"]);
    const autre = await context.newPage();
    await page.goto(`${serveur.url}/quiz/${id}`);
    await autre.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await hydrate(autre);
    await page.getByLabel("Énoncé de la question 1").fill("Écrit par A");
    await enregistre(page);
    await autre.getByLabel("Titre du quiz").fill("Titre écrit par B");
    await enregistre(autre);
    let brut = await charger(page, id);
    // Chaque onglet n'envoie que ce qu'il a modifié : les deux changements coexistent.
    expect(brut).toContain("Écrit par A");
    expect(brut).toContain("Titre écrit par B");
    await autre.getByLabel("Énoncé de la question 1").fill("Écrit par B ensuite");
    await enregistre(autre);
    brut = await charger(page, id);
    expect(brut).toContain("Écrit par B ensuite");
    expect(brut).not.toContain("Écrit par A");
    // L'onglet A est averti que B a écrit ; son écran garde l'ancienne valeur jusqu'au rechargement.
    await expect(page.getByText("Ce quiz est ouvert dans un autre onglet. Recharge pour voir ses changements.")).toBeVisible();
    await expect(page.getByLabel("Énoncé de la question 1")).toHaveValue("Écrit par A");
    const recharge = page.waitForEvent("load");
    await page.getByRole("button", { name: "Recharger" }).click();
    await recharge;
    await hydrate(page);
    await expect(page.getByLabel("Énoncé de la question 1")).toHaveValue("Écrit par B ensuite");
    await autre.close();
  });

  test("390 px : axe, 44 px, aucun débordement et anneau de focus visible sur l'éditeur", async ({ page }) => {
    const id = await quizAvec(page, "Accessibilité", ["Première"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await enregistre(page);
    await controles(page);
    expect(await axe(page)).toEqual([]);
    const sansAnneau: string[] = [];
    const cibles = [
      page.getByLabel("Titre du quiz"),
      page.getByLabel("Énoncé de la question 1"),
      page.getByLabel("Réponse A", { exact: true }),
      page.getByRole("button", { name: "Marquer A comme bonne réponse" }),
      page.getByRole("radio", { name: "30 s" }),
      page.getByRole("button", { name: "Dupliquer" }),
      page.getByRole("button", { name: "Ajouter une question" }),
    ];
    for (const cible of cibles) {
      await page.keyboard.press("Shift");
      await cible.focus();
      const ok = await cible.evaluate((el) => {
        const s = getComputedStyle(el);
        const ancetre = el.closest("label, [role=radiogroup] > *") as HTMLElement | null;
        const sa = ancetre ? getComputedStyle(ancetre) : s;
        const visible = (c: CSSStyleDeclaration) => (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== "none";
        return visible(s) || visible(sa) || el.matches(":focus-visible");
      });
      if (!ok) sansAnneau.push((await cible.getAttribute("aria-label")) ?? "champ");
    }
    expect(sansAnneau).toEqual([]);
  });

  test("bureau 1280 px : trois colonnes, aperçu joueur à jour pour le type et la durée, axe propre", async ({ page }) => {
    const id = await quizAvec(page, "Bureau QA", ["Question visible"]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    const apercu = page.getByRole("complementary", { name: "Aperçu joueur" });
    await expect(apercu.getByText("Question visible")).toBeVisible();
    await page.getByRole("radio", { name: "Vrai ou faux" }).check({ force: true });
    await expect(apercu.getByText("Vrai", { exact: true })).toBeVisible();
    await expect(apercu.getByText("Faux", { exact: true })).toBeVisible();
    await page.getByLabel("Énoncé de la question 1").fill("Énoncé modifié en direct");
    await expect(apercu.getByText("Énoncé modifié en direct")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    expect(await axe(page)).toEqual([]);
  });

  test("deux onglets sur /quiz/nouveau : un brouillon détenu n'est pas repris ailleurs, il l'est une fois l'onglet fermé", async ({ page, context }) => {
    test.setTimeout(90_000);
    await connecter(page, "/quiz/nouveau");
    await hydrate(page);
    await page.getByLabel("Énoncé de la question 1").fill("Brouillon de A");
    await expect(statut(page)).toHaveText("En attente", { timeout: 10_000 });

    const b = await context.newPage();
    const creationsB: string[] = [];
    b.on("request", (r) => {
      if (r.url().includes("/_actions/quiz.creer")) creationsB.push(r.url());
    });
    await b.goto(`${serveur.url}/quiz/nouveau`);
    await hydrate(b);
    // A détient ce brouillon : B repart d'une page vierge, sous sa propre session.
    await expect(b.getByLabel("Énoncé de la question 1")).toHaveValue("");
    await expect(page.getByLabel("Énoncé de la question 1")).toHaveValue("Brouillon de A");

    // A fermé sans avoir créé le quiz : un nouvel onglet reprend son brouillon, et lui seul le crée.
    await page.close();
    const c = await context.newPage();
    await c.goto(`${serveur.url}/quiz/nouveau`);
    await hydrate(c);
    await expect(c.getByLabel("Énoncé de la question 1")).toHaveValue("Brouillon de A");
    await c.getByLabel("Titre du quiz").fill("Repris par C");
    await expect(c).toHaveURL(/\/quiz\/(?!nouveau)[^/]+$/, { timeout: 15_000 });
    await enregistre(c);
    await b.waitForTimeout(1_500);
    expect(creationsB).toEqual([]);
    await expect(b.getByLabel("Énoncé de la question 1")).toHaveValue("");
    // Le brouillon créé ne ressuscite pas sur /quiz/nouveau.
    const d = await context.newPage();
    await d.goto(`${serveur.url}/quiz/nouveau`);
    await hydrate(d);
    await expect(d.getByLabel("Énoncé de la question 1")).toHaveValue("");
    await Promise.all([b.close(), c.close(), d.close()]);
  });

  test("conflits : question supprimée ailleurs et ordre périmé sont signalés sans bloquer l'enregistrement", async ({ page }) => {
    test.setTimeout(90_000);
    const id = idDans(await rpc(page, "creer", { title: "Conflits" }), ["Conflits"]);
    const ids: string[] = [];
    for (const p of ["Un", "Deux", "Trois"]) ids.push(idDans(await rpc(page, "ajouterQuestion", { quizId: id, question: question(p) }), [id]));
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await enregistre(page);

    // Supprimée ailleurs pendant que l'écran l'affiche encore.
    await rpc(page, "supprimerQuestion", { questionId: ids[0] });
    await page.getByLabel("Énoncé de la question 1").fill("Un modifié trop tard");
    await expect(page.getByText("La question 1 a été supprimée ailleurs. Recharge pour voir le quiz à jour.")).toBeVisible({ timeout: 15_000 });
    await enregistre(page);
    await expect(page.getByRole("button", { name: "Recharger" })).toBeVisible();

    // L'ordre envoyé cite encore la question supprimée : refusé, dit, et la file continue.
    await page.getByRole("button", { name: "Voir et réorganiser les questions" }).click();
    const feuille = page.getByRole("dialog", { name: "Tes questions (3)" });
    await feuille.getByRole("button", { name: "Déplacer la question 2" }).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.getByText("L'ordre des questions n'est plus à jour. Recharge la page.")).toBeVisible({ timeout: 15_000 });
    await enregistre(page);
    expect(await axe(page)).toEqual([]);

    await page.getByRole("button", { name: "Question 2" }).click();
    await page.getByLabel("Énoncé de la question 2").fill("Toujours enregistrée");
    await enregistre(page);
    expect(await charger(page, id)).toContain("Toujours enregistrée");

    const recharge = page.waitForEvent("load");
    await page.getByRole("button", { name: "Recharger" }).click();
    await recharge;
    await hydrate(page);
    await expect(page.getByRole("navigation", { name: "Questions" }).getByRole("button", { name: /^Question \d/ })).toHaveCount(2);
    await expect(page.getByText(/supprimée ailleurs|plus à jour/)).toHaveCount(0);
  });

  test("statut : la pilule n'est pas une région live ; seuls l'échec, l'attente et le retour après échec sont annoncés", async ({ page }) => {
    const id = await quizAvec(page, "Annonces", ["Départ"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await enregistre(page);
    expect(await statut(page).getAttribute("role")).toBeNull();
    expect(await statut(page).evaluate((el) => el.closest("[role=status], [aria-live]"))).toBeNull();
    // Région présente dès l'ouverture, vide tant que rien d'utile n'est à dire.
    const region = page.locator("p.sr-only[role=status]");
    await expect(region).toHaveCount(1);
    await expect(region).toHaveText("");

    await page.getByLabel("Énoncé de la question 1").fill("Frappe ordinaire");
    await enregistre(page);
    await expect(region).toHaveText("");

    await page.route("**/_actions/**", (route) => route.abort("internetdisconnected"));
    await page.getByLabel("Énoncé de la question 1").fill("Sans réseau");
    await expect(statut(page)).toHaveText("Non enregistré", { timeout: 10_000 });
    await expect(region).toHaveText("Non enregistré");
    await page.unroute("**/_actions/**");
    await page.getByRole("button", { name: "Réessayer maintenant" }).click();
    await enregistre(page);
    await expect(region).toHaveText("Enregistré");

    await page.getByLabel("Titre du quiz").fill("");
    await expect(statut(page)).toHaveText("En attente", { timeout: 10_000 });
    await expect(region).toHaveText("En attente");
    await page.getByLabel("Titre du quiz").fill("Annonces bis");
    await enregistre(page);
    await expect(region).toHaveText("");
  });

  test("requête sans réponse : passé 15 s elle compte comme une coupure, puis l'envoi reprend tout seul", async ({ page }) => {
    test.setTimeout(90_000);
    const id = await quizAvec(page, "Requête pendue", ["Départ"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await enregistre(page);
    // La requête part mais ne reçoit jamais de réponse, ni d'erreur : le cas d'un réseau mobile qui décroche.
    await page.route("**/_actions/quiz.majQuestion/**", () => {});
    const debut = Date.now();
    await page.getByLabel("Énoncé de la question 1").fill("Envoyée dans le vide");
    await expect(statut(page)).toHaveText("Non enregistré", { timeout: 25_000 });
    expect(Date.now() - debut).toBeGreaterThanOrEqual(14_000);
    await expect(page.getByRole("alert")).toContainText("Tes modifications sont gardées sur cet appareil");
    await page.unroute("**/_actions/quiz.majQuestion/**");
    await enregistre(page);
    expect(await charger(page, id)).toContain("Envoyée dans le vide");
  });

  test("limite de 50 : bouton aria-disabled et focalisable, relié à son aide, clic et Entrée ignorés, mobile et bureau", async ({ page }) => {
    test.setTimeout(180_000);
    const id = idDans(await rpc(page, "creer", { title: "Cinquante bis" }), ["Cinquante bis"]);
    for (let i = 1; i <= 50; i += 1) await rpc(page, "ajouterQuestion", { quizId: id, question: question(`Question numéro ${i}`) });
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    const aide = "Un quiz compte 50 questions au plus.";
    for (const largeur of [390, 1280]) {
      await page.setViewportSize({ width: largeur, height: 844 });
      const ajout = page.getByRole("button", { name: "Ajouter une question" });
      await expect(ajout).toHaveAttribute("aria-disabled", "true");
      expect(await ajout.getAttribute("disabled")).toBeNull();
      await expect(ajout).toHaveAccessibleDescription(aide);
      await expect(page.getByText(aide)).toBeVisible();
      await ajout.click({ force: true });
      await ajout.press("Enter");
      await expect(ajout).toBeFocused();
      await expect(page.getByLabel(/Énoncé de la question 51/)).toHaveCount(0);
      await expect(statut(page)).toHaveText("Enregistré");
    }
    expect((await charger(page, id)).match(/Question numéro/g)).toHaveLength(50);
  });

  test("aperçu joueur monté seulement à partir de 1024 px", async ({ page }) => {
    const id = await quizAvec(page, "Aperçu conditionnel", ["Question de l'aperçu"]);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    const apercu = page.locator("aside[aria-label='Aperçu joueur']");
    await expect(apercu.getByText("Question de l'aperçu")).toHaveCount(0);
    await page.setViewportSize({ width: 1023, height: 800 });
    await expect(apercu.getByText("Question de l'aperçu")).toHaveCount(0);
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(apercu.getByText("Question de l'aperçu")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(apercu.getByText("Question de l'aperçu")).toHaveCount(0);
  });

  test("bureau : réponses sur une colonne, libellé long affiché en entier, placeholder lisible sur la tuile juste", async ({ page }) => {
    const id = await quizAvec(page, "Libellés longs", ["Question aux longues réponses"]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    const long = "Une réponse volontairement longue, pour vérifier que rien n'est coupé sur l'écran du bureau, même au-delà d'une ligne";
    const a = page.getByLabel("Réponse A", { exact: true });
    const b = page.getByLabel("Réponse B", { exact: true });
    await b.fill(long);
    await expect(b).toHaveValue(long);
    expect(await b.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const [ba, bb] = [await a.boundingBox(), await b.boundingBox()];
    expect(ba && bb && Math.abs(ba.x - bb.x) < 1 && bb.y > ba.y).toBe(true);
    // Une seule ligne logique : Entrée n'insère rien.
    await b.press("End");
    await b.press("Enter");
    await expect(b).toHaveValue(long);

    // A est juste (question créée ainsi), B ne l'est pas : le placeholder suit la couleur du texte de sa tuile.
    await a.fill("");
    await b.fill("");
    const couleur = (nom: string) =>
      page.evaluate((v) => {
        const sonde = document.createElement("span");
        sonde.style.color = `var(${v})`;
        document.body.appendChild(sonde);
        const c = getComputedStyle(sonde).color;
        sonde.remove();
        return c;
      }, nom);
    const placeholder = (champ: typeof a) => champ.evaluate((el) => getComputedStyle(el, "::placeholder").color);
    expect(await placeholder(a)).toBe(await couleur("--color-vert-nuit"));
    expect(await placeholder(b)).toBe(await couleur("--color-vert-mousse"));
  });

  test("glisser dans une longue liste : la feuille défile seule près du bord", async ({ page }) => {
    test.setTimeout(120_000);
    const prompts = Array.from({ length: 20 }, (_, i) => `Ligne ${i + 1} de la liste`);
    const id = await quizAvec(page, "Longue liste", prompts);
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await page.getByRole("button", { name: "Voir et réorganiser les questions" }).click();
    const feuille = page.getByRole("dialog", { name: "Tes questions (20)" });
    await expect(feuille).toBeVisible();
    const bas = await feuille.locator("ol").evaluate((ol) => {
      for (let el = ol.parentElement; el; el = el.parentElement) {
        const o = getComputedStyle(el).overflowY;
        if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) {
          el.setAttribute("data-zone-glisser", "");
          return el.getBoundingClientRect().bottom;
        }
      }
      return null;
    });
    expect(bas, "la feuille doit défiler avec 20 questions").not.toBeNull();
    const zone = page.locator("[data-zone-glisser]");
    const avant = await zone.evaluate((el) => el.scrollTop);
    const poignee = await feuille.getByRole("button", { name: "Déplacer la question 1", exact: true }).boundingBox();
    if (!poignee) throw new Error("poignée introuvable");
    const x = poignee.x + poignee.width / 2;
    await page.mouse.move(x, poignee.y + poignee.height / 2);
    await page.mouse.down();
    // Le pointeur s'arrête près du bord bas et n'en bouge plus : seule la liste défile.
    await page.mouse.move(x, (bas as number) - 8, { steps: 10 });
    await expect.poll(() => zone.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBeGreaterThan(avant + 200);
    await page.mouse.up();
    const textes = await feuille.locator("ol > li").evaluateAll((lis) => lis.map((li) => li.textContent ?? ""));
    expect(textes.findIndex((t) => t.includes("Ligne 1 de la liste"))).toBeGreaterThan(8);
    await page.keyboard.press("Escape");
    await enregistre(page);
  });

  // En dernier : ce test échoue tant que le message de limite n'existe pas, et la série serial ne doit pas bloquer les autres.
  test("50 questions : l'ajout est refusé et un message l'explique", async ({ page }) => {
    test.setTimeout(180_000);
    const id = idDans(await rpc(page, "creer", { title: "Cinquante" }), ["Cinquante"]);
    for (let i = 1; i <= 50; i += 1) await rpc(page, "ajouterQuestion", { quizId: id, question: question(`Question numéro ${i}`) });
    await page.goto(`${serveur.url}/quiz/${id}`);
    await hydrate(page);
    await expect(page.getByRole("button", { name: "Ajouter une question" })).toBeDisabled();
    // La 51e est aussi refusée par le serveur : l'API reste la dernière barrière.
    const r = await page.request.post(`${serveur.url}/_actions/quiz.ajouterQuestion/`, { data: { quizId: id, question: question("51e") }, headers: { origin: serveur.url } });
    expect(r.ok()).toBe(false);
    // Le message clair demandé : l'animateur doit comprendre pourquoi le bouton est grisé.
    await expect(page.getByText(/50 questions/)).toBeVisible();
  });
});

test.describe("éditeur : accès sans session", () => {
  test("non connecté : /quiz/nouveau et /quiz/<id>?question=3 redirigent vers /connexion?retour= encodé", async ({ page, request }) => {
    test.setTimeout(120_000);
    const local = await lancerServeur(33);
    try {
      const nouveau = await request.get(`${local.url}/quiz/nouveau`, { maxRedirects: 0 });
      expect(nouveau.status()).toBe(302);
      expect(nouveau.headers()["location"]).toBe("/connexion?retour=%2Fquiz%2Fnouveau");
      const edition = await request.get(`${local.url}/quiz/abc?question=3`, { maxRedirects: 0 });
      expect(edition.status()).toBe(302);
      expect(edition.headers()["location"]).toBe("/connexion?retour=%2Fquiz%2Fabc%3Fquestion%3D3");
      await page.goto(`${local.url}/quiz/abc?question=3`);
      await expect(page).toHaveURL(/\/connexion\?retour=%2Fquiz%2Fabc%3Fquestion%3D3$/);
      // Les actions refusent aussi un appel direct sans session.
      const action = await request.post(`${local.url}/_actions/quiz.charger/`, { data: { quizId: "abc" }, headers: { origin: local.url } });
      expect(action.status()).toBe(401);
    } finally {
      arreterTout();
    }
  });
});
