import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { arreterTout, lancerServeur, type ServeurLocal } from "../tableau-de-bord/serveur-local";

// QA indépendante de QZ-002-15 : réglages et aperçu, vraie session, serveur wrangler dédié (décalage 40).
const A = "qa15-a@exemple.fr";
const B = "qa15-b@exemple.fr";
let serveur: ServeurLocal;
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

// La demande de lien est limitée par IP : une connexion par adresse, ensuite les cookies sont rejoués.
async function connecter(page: Page, email: string) {
  const connus = sessions.get(email);
  if (connus) {
    await page.context().addCookies(connus);
    return;
  }
  await page.goto(`${serveur.url}/connexion`);
  await hydrate(page);
  await page.getByLabel("Ton adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible();
  await page.goto(await serveur.lienMagique(email));
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  sessions.set(email, await page.context().cookies());
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

async function mobileOk(page: Page) {
  const r = await page.evaluate(() => ({
    petites: [...document.querySelectorAll("a[href], button, input:not(.sr-only), textarea")]
      .filter((el) => !el.closest("[hidden]"))
      .map((el) => ({ nom: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
    debord: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(r.petites).toEqual([]);
  expect(r.debord).toBeLessThanOrEqual(0);
}

// Le bloc « Plus d'options » s'ouvre de lui-même quand une description ou une catégorie existe : on ne le referme pas par erreur.
async function ouvrirOptions(page: Page) {
  if (!(await page.getByLabel("Catégorie").isVisible())) await page.getByText("Plus d'options").click();
  await expect(page.getByLabel("Catégorie")).toBeVisible();
}

async function focusVisible(page: Page, nombre = 14) {
  const sans: string[] = [];
  for (let i = 0; i < nombre; i += 1) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // Une entrée masquée (case native sous un interrupteur) délègue l'anneau à son libellé voisin.
      const cible = el.classList.contains("sr-only") ? ((el.closest("label, div") as HTMLElement | null) ?? el) : el;
      const s = getComputedStyle(cible);
      const t = getComputedStyle(el);
      const ok = [s, t].some((c) => (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== "none");
      return { nom: `${el.tagName}.${String(el.className).slice(0, 60)} ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}`, ok };
    });
    if (r && !r.ok) sans.push(r.nom);
  }
  return sans;
}

async function action(page: Page, nom: string, corps: unknown): Promise<{ statut: number; texte: string }> {
  return page.evaluate(
    async ([chemin, donnees]) => {
      const reponse = await fetch(`/_actions/${chemin}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donnees) });
      return { statut: reponse.status, texte: await reponse.text() };
    },
    [nom, corps] as const,
  );
}

// Les Actions répondent en devalue : { quizId } arrive sous la forme [{ "quizId": 1 }, "<id>"].
async function creer(page: Page, titre: string): Promise<string> {
  const { texte } = await action(page, "quiz.creer", { title: titre });
  const tableau = JSON.parse(texte) as unknown[];
  return tableau[(tableau[0] as Record<string, number>).quizId!] as string;
}

type Q = { prompt: string; type?: "single" | "multiple" | "true_false"; durationSec?: number; options: Array<[string, boolean]>; explanation?: string };
async function ajouter(page: Page, quizId: string, q: Q) {
  const r = await action(page, "quiz.ajouterQuestion", {
    quizId,
    question: { type: q.type ?? "single", prompt: q.prompt, durationSec: q.durationSec ?? 20, explanation: q.explanation, options: q.options.map(([label, isCorrect]) => ({ label, isCorrect })) },
  });
  expect(r.statut).toBe(200);
}

const charger = (page: Page, quizId: string) => action(page, "quiz.charger", { quizId });

test.describe("réglages et aperçu : QA indépendante", () => {
  test.describe.configure({ mode: "serial" });
  let quiz = "";
  let quizApercu = "";
  let quizVide = "";
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(40);
  });
  test.afterAll(() => arreterTout());
  test.beforeEach(({ browserName }, info) => {
    void browserName;
    test.skip(info.project.name !== "mobile", "vérifié à 390 px");
  });

  test("préparation", async ({ page }) => {
    await connecter(page, A);
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(page);
    quiz = await creer(page, "Réglages QA");
    await ajouter(page, quiz, { prompt: "Q1 ?", options: [["Oui", true], ["Non", false]] });
    quizApercu = await creer(page, "Aperçu QA");
    await ajouter(page, quizApercu, { prompt: "Simple ?", explanation: "Parce que.", options: [["Alpha", true], ["Bravo", false], ["Charlie", false]] });
    await ajouter(page, quizApercu, { prompt: "Multiple ?", type: "multiple", options: [["Un", true], ["Deux", false], ["Trois", true]] });
    await ajouter(page, quizApercu, { prompt: "Vrai ou faux ?", type: "true_false", options: [["Vrai", false], ["Faux", true]] });
    await ajouter(page, quizApercu, { prompt: "Chrono ?", durationSec: 10, options: [["Oui", true], ["Non", false]] });
    quizVide = await creer(page, "Vide QA");
  });

  test("chaque réglage persiste après rechargement et quiz.charger le confirme", async ({ page }) => {
    await connecter(page, A);
    await page.goto(`${serveur.url}/quiz/${quiz}/reglages`);
    await hydrate(page);
    await ouvrirOptions(page);
    await page.getByText("Chacun à son rythme").click();
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible();
    await page.getByRole("switch", { name: /Montrer la bonne réponse/ }).setChecked(false, { force: true });
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible();
    await page.getByRole("switch", { name: /Mélanger l'ordre/ }).setChecked(true, { force: true });
    await page.getByLabel("Description (visible par les joueurs)").fill("Une description QA");
    await page.getByLabel("Catégorie").fill("Catégorie QA");
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible();
    const brut = (await charger(page, quiz)).texte;
    for (const valeur of ["own_pace", "Une description QA", "Catégorie QA"]) expect(brut).toContain(valeur);
    await page.reload();
    await hydrate(page);
    await ouvrirOptions(page);
    await expect(page.getByRole("radio", { name: /Chacun à son rythme/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: /Montrer la bonne réponse/ })).not.toBeChecked();
    await expect(page.getByRole("switch", { name: /Mélanger l'ordre/ })).toBeChecked();
    await expect(page.getByLabel("Description (visible par les joueurs)")).toHaveValue("Une description QA");
    await expect(page.getByLabel("Catégorie")).toHaveValue("Catégorie QA");
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);
    expect(await focusVisible(page)).toEqual([]);
  });

  test("plusieurs changements rapides : la dernière valeur l'emporte en base", async ({ page }) => {
    test.setTimeout(90_000);
    await connecter(page, A);
    await page.goto(`${serveur.url}/quiz/${quiz}/reglages`);
    await hydrate(page);
    await ouvrirOptions(page);
    const appels: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("quiz.majReglages")) appels.push(r.postData() ?? "");
    });
    const interrupteur = page.getByRole("switch", { name: /Montrer la bonne réponse/ });
    const melange = page.getByRole("switch", { name: /Mélanger l'ordre/ });
    // État de départ : bonne réponse masquée, mélange actif. Sept bascules rapides de chacun.
    // Clics synchrones dans la page : aucune pause entre deux changements.
    await page.evaluate(() => {
      const [bonne, melanger] = ["Montrer la bonne réponse", "Mélanger l'ordre"].map((nom) =>
        [...document.querySelectorAll<HTMLElement>("[role=switch]")].find((el) => (el.closest("label")?.textContent ?? el.getAttribute("aria-label") ?? "").includes(nom))!,
      );
      for (let i = 0; i < 7; i += 1) {
        bonne.click();
        melanger.click();
      }
    });
    await page.getByText("Chacun à son rythme").click();
    await page.getByText("Tout le monde ensemble").click();
    await page.getByLabel("Description (visible par les joueurs)").fill("v1");
    await page.getByLabel("Description (visible par les joueurs)").fill("v2");
    await page.getByLabel("Description (visible par les joueurs)").fill("version finale");
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible({ timeout: 15_000 });
    expect(appels.length).toBeGreaterThan(0);
    await page.reload();
    await hydrate(page);
    await ouvrirOptions(page);
    // Sept bascules : l'état est inversé par rapport au départ.
    await expect(interrupteur).toBeChecked();
    await expect(melange).not.toBeChecked();
    await expect(page.getByRole("radio", { name: /Tout le monde ensemble/ })).toBeChecked();
    await expect(page.getByLabel("Description (visible par les joueurs)")).toHaveValue("version finale");
  });

  test("coupure réseau : « Non enregistré », « Réessayer », puis reprise", async ({ page }) => {
    await connecter(page, A);
    await page.goto(`${serveur.url}/quiz/${quiz}/reglages`);
    await hydrate(page);
    await ouvrirOptions(page);
    await page.getByLabel("Catégorie").fill("Avant coupure");
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible();
    await page.context().setOffline(true);
    await page.getByLabel("Catégorie").fill("Pendant coupure");
    await expect(page.getByRole("status").filter({ hasText: "Non enregistré" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);
    await page.context().setOffline(false);
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await hydrate(page);
    await ouvrirOptions(page);
    await expect(page.getByLabel("Catégorie")).toHaveValue("Pendant coupure");
  });

  test("le lien de retour attend la fin de l'envoi", async ({ page }) => {
    await connecter(page, A);
    await page.goto(`${serveur.url}/quiz/${quiz}/reglages`);
    await hydrate(page);
    await ouvrirOptions(page);
    await page.route(/_actions\/quiz\.majReglages/, async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    await page.getByLabel("Catégorie").fill("Après retour");
    await page.getByRole("link", { name: "Retour à l'éditeur" }).click();
    await page.waitForTimeout(700);
    expect(page.url()).toContain("/reglages");
    await expect(page).toHaveURL(new RegExp(`/quiz/${quiz}$`), { timeout: 20_000 });
    await page.unroute(/_actions\/quiz\.majReglages/);
    expect((await charger(page, quiz)).texte).toContain("Après retour");
  });

  test("bornes : 500 caractères de description, 60 de catégorie, refus serveur au-delà", async ({ page }) => {
    await connecter(page, A);
    await page.goto(`${serveur.url}/quiz/${quiz}/reglages`);
    await hydrate(page);
    await ouvrirOptions(page);
    const description = page.getByLabel("Description (visible par les joueurs)");
    await description.fill("d".repeat(600));
    await page.getByLabel("Catégorie").fill("c".repeat(80));
    expect(await description.inputValue()).toHaveLength(500);
    expect(await page.getByLabel("Catégorie").inputValue()).toHaveLength(60);
    await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible();
    await page.reload();
    await hydrate(page);
    await ouvrirOptions(page);
    expect(await page.getByLabel("Description (visible par les joueurs)").inputValue()).toHaveLength(500);
    expect(await page.getByLabel("Catégorie").inputValue()).toHaveLength(60);
    // Le serveur reste maître : un appel direct au-delà des bornes est refusé et ne change rien.
    expect((await action(page, "quiz.majReglages", { quizId: quiz, description: "d".repeat(501) })).statut).toBe(400);
    expect((await action(page, "quiz.majReglages", { quizId: quiz, category: "c".repeat(61) })).statut).toBe(400);
    expect((await action(page, "quiz.majReglages", { quizId: quiz, description: "d".repeat(500), category: "c".repeat(60) })).statut).toBe(200);
  });

  test("aperçu : parcours, bonnes et mauvaises réponses, multiple, vrai/faux, chrono à zéro, focus, aucune requête de jeu", async ({ page }) => {
    test.setTimeout(120_000);
    await connecter(page, A);
    const jeu: string[] = [];
    page.on("websocket", (ws) => jeu.push(`ws ${ws.url()}`));
    page.on("request", (r) => {
      if (/_actions\/partie|\/ws\/|\/api\/parties/.test(r.url())) jeu.push(r.url());
    });
    await page.goto(`${serveur.url}/quiz/${quizApercu}/apercu`);
    await hydrate(page);
    const titre = (nom: string) => page.getByRole("heading", { level: 1, name: nom });
    await expect(titre("Simple ?")).toBeFocused();
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);
    expect(await focusVisible(page, 8)).toEqual([]);
    await page.getByRole("button", { name: /Bravo/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: /PAS CETTE\s*FOIS/ })).toBeVisible();
    await expect(page.getByText("Parce que.")).toBeVisible();
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);

    await page.getByRole("button", { name: "Suivante" }).click();
    await expect(titre("Multiple ?")).toBeFocused();
    await page.getByRole("button", { name: /Un/ }).click();
    await expect(page.getByRole("heading", { name: "JUSTE !" })).toHaveCount(0);
    await page.getByRole("button", { name: /Trois/ }).click();
    await page.getByRole("button", { name: "Valider la sélection" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "JUSTE !" })).toBeVisible();

    await page.getByRole("button", { name: "Suivante" }).click();
    await expect(titre("Vrai ou faux ?")).toBeFocused();
    await page.getByRole("button", { name: /Faux/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "JUSTE !" })).toBeVisible();

    await page.getByRole("button", { name: "Précédente" }).click();
    await expect(titre("Multiple ?")).toBeFocused();
    await expect(page.getByText("Question 2 sur 4")).toBeVisible();
    await page.getByRole("button", { name: "Suivante" }).click();
    await page.getByRole("button", { name: "Suivante" }).click();

    await expect(titre("Chrono ?")).toBeFocused();
    // À zéro, l'aperçu passe de lui-même à la correction (le chrono disparaît avec la question) : « Pas cette fois ! ».
    await expect(page.getByRole("heading", { level: 2, name: /PAS CETTE\s*FOIS/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("timer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Suivante" })).toBeDisabled();
    expect(jeu).toEqual([]);
  });

  test("aperçu d'un quiz sans question : état vide avec lien, mobile et axe propres", async ({ page }) => {
    await connecter(page, A);
    await page.goto(`${serveur.url}/quiz/${quizVide}/apercu`);
    await hydrate(page);
    await expect(page.getByRole("heading", { name: "Rien à prévisualiser" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ajouter une question" })).toHaveAttribute("href", `/quiz/${quizVide}`);
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);
  });

  test("sécurité : Cache-Control private no-store, 404 sans bonne réponse, redirection du visiteur", async ({ page, browser }) => {
    await connecter(page, A);
    for (const chemin of ["apercu", "reglages"]) {
      const r = await page.request.get(`${serveur.url}/quiz/${quizApercu}/${chemin}`);
      expect(r.status()).toBe(200);
      expect(r.headers()["cache-control"], chemin).toBe("private, no-store");
    }
    const contexteB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageB = await contexteB.newPage();
    await connecter(pageB, B);
    for (const chemin of ["apercu", "reglages"]) {
      const r = await pageB.request.get(`${serveur.url}/quiz/${quizApercu}/${chemin}`);
      expect(r.status(), chemin).toBe(404);
      expect(r.headers()["cache-control"], chemin).toBe("private, no-store");
      const html = await r.text();
      for (const secret of ["Alpha", "Simple ?", "Parce que.", "Aperçu QA"]) expect(html, `${chemin} ${secret}`).not.toContain(secret);
    }
    await contexteB.close();
    const visiteur = await browser.newContext();
    for (const chemin of ["apercu", "reglages"]) {
      const r = await visiteur.request.get(`${serveur.url}/quiz/${quizApercu}/${chemin}`, { maxRedirects: 0 });
      expect([301, 302, 303, 307, 308]).toContain(r.status());
      expect(r.headers()["location"]).toContain(`/connexion?retour=${encodeURIComponent(`/quiz/${quizApercu}/${chemin}`)}`);
      const html = await r.text();
      expect(html).not.toContain("Alpha");
    }
    await visiteur.close();
  });
});
