import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { arreterTout, lancerServeur, type ServeurLocal } from "./serveur-local";

// QA indépendante de QZ-002-13 : vraie session, deux animateurs, serveur wrangler dédié (décalage 30, port distinct
// du spec de l'implémenteur qui utilise 20).
const A = "animateur-a@exemple.fr";
const B = "animateur-b@exemple.fr";
const SOLO = "solo@exemple.fr";
let serveur: ServeurLocal;

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

// La demande de lien est limitée par IP : une seule connexion par adresse, les tests suivants rejouent les cookies.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function ouvrirSession(browser: Browser, email: string): Promise<{ contexte: BrowserContext; page: Page }> {
  const contexte = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await contexte.newPage();
  const connus = sessions.get(email);
  if (connus) {
    await contexte.addCookies(connus);
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(page);
    return { contexte, page };
  }
  await page.goto(`${serveur.url}/connexion`);
  await hydrate(page);
  await page.getByLabel("Ton adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible();
  await page.goto(await serveur.lienMagique(email));
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await hydrate(page);
  sessions.set(email, await contexte.cookies());
  return { contexte, page };
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

async function mobileOk(page: Page) {
  const r = await page.evaluate(() => ({
    petites: [...document.querySelectorAll("a[href], button, input")]
      .filter((el) => !el.closest("[hidden]"))
      .map((el) => ({ nom: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
    debord: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(r.petites).toEqual([]);
  expect(r.debord).toBeLessThanOrEqual(0);
}

// Appel brut d'une Astro Action avec les cookies et l'Origin du navigateur : renvoie statut et corps texte.
async function action(page: Page, nom: string, corps: unknown) {
  return page.evaluate(
    async ([chemin, donnees]) => {
      const reponse = await fetch(`/_actions/${chemin}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donnees) });
      return { statut: reponse.status, corps: await reponse.text() };
    },
    [nom, corps] as const,
  );
}

async function creerDepuisModele(page: Page): Promise<string> {
  const modele = page.getByRole("list").filter({ has: page.getByRole("button", { name: /questions/ }) }).getByRole("button").first();
  await modele.click();
  await expect(page).toHaveURL(/\/quiz\/[\w-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

test.describe("tableau de bord : QA indépendante", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(30);
  });
  test.afterAll(() => arreterTout());
  test.beforeEach(({ browserName }, info) => {
    void browserName;
    test.skip(info.project.name !== "mobile", "tableau de bord vérifié à 390 px");
  });

  let quizA = "";

  test("isolation : B ne voit rien de A et ses actions sur le quiz de A répondent NOT_FOUND", async ({ browser }) => {
    test.setTimeout(120_000);
    const a = await ouvrirSession(browser, A);
    quizA = await creerDepuisModele(a.page);
    await a.page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(a.page);
    await expect(a.page.getByRole("tab", { name: "Mes quiz (1)" })).toBeVisible();
    // Une partie jouée de A, insérée en base.
    serveur.sql(
      "INSERT INTO game_sessions (id, code, owner_id, quiz_id, quiz_title, mode, show_correct_answer, shuffle, status, created_at, ended_at) " +
        `SELECT 'partie-de-a', 'AAA234', id, NULL, 'Secret de A', 'together', 1, 0, 'ended', 1793000000000, 1793003600000 FROM user WHERE email = '${A}'`,
    );
    await a.page.reload();
    await hydrate(a.page);
    await a.page.getByRole("tab", { name: "Parties jouées" }).click();
    await expect(a.page.getByText("Secret de A")).toBeVisible();

    const b = await ouvrirSession(browser, B);
    // B est en première visite : aucun quiz de A.
    await expect(b.page.getByRole("heading", { level: 1, name: /TON 1ER/ })).toBeVisible();
    await b.page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(b.page);
    await expect(b.page.getByText("Secret de A")).toHaveCount(0);
    expect(await b.page.evaluate(() => document.body.innerText)).not.toContain("Secret de A");
    const liste = await action(b.page, "quiz.lister", {});
    expect(liste.corps).not.toContain(quizA);

    for (const [nom, corps] of [
      ["quiz.dupliquer", { quizId: quizA }],
      ["quiz.supprimer", { quizId: quizA }],
      ["quiz.charger", { quizId: quizA }],
      ["partie.lancer", { quizId: quizA }],
    ] as const) {
      const r = await action(b.page, nom, corps);
      expect(r.statut, nom).toBe(404);
      expect(r.corps, nom).toContain("NOT_FOUND");
    }
    // Le quiz de A est intact et reste lisible par A.
    await a.page.reload();
    await hydrate(a.page);
    await expect(a.page.getByRole("tab", { name: "Mes quiz (1)" })).toBeVisible();
    // Le bilan de A n'est pas ouvert à B.
    const bilan = await b.page.goto(`${serveur.url}/partie/partie-de-a/bilan`);
    expect(bilan?.status()).not.toBe(200);
    await a.contexte.close();
    await b.contexte.close();
  });

  test("« Partir de zéro » mène à /quiz/nouveau", async ({ browser }) => {
    const { contexte, page } = await ouvrirSession(browser, SOLO);
    await page.getByRole("link", { name: "Partir de zéro" }).click();
    await expect(page).toHaveURL(/\/quiz\/nouveau$/);
    await contexte.close();
  });

  test("menu « … » : Modifier, Échap et clic extérieur ferment, focus rendu au bouton, accessibilité", async ({ browser }) => {
    test.setTimeout(90_000);
    const { contexte, page } = await ouvrirSession(browser, SOLO);
    await creerDepuisModele(page);
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(page);
    const carte = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /Plus d'actions/ }) }).first();
    const bouton = carte.getByRole("button", { name: /Plus d'actions/ });
    await bouton.click();
    await expect(bouton).toHaveAttribute("aria-expanded", "true");
    await expect(carte.getByRole("link", { name: "Modifier" })).toBeVisible();
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(bouton).toHaveAttribute("aria-expanded", "false");
    await expect(carte.getByRole("link", { name: "Modifier" })).toBeHidden();
    await expect(bouton).toBeFocused();

    await bouton.click();
    await page.mouse.click(4, 4);
    await expect(bouton).toHaveAttribute("aria-expanded", "false");
    await expect(carte.getByRole("link", { name: "Modifier" })).toBeHidden();

    await bouton.click();
    await carte.getByRole("link", { name: "Modifier" }).click();
    await expect(page).toHaveURL(/\/quiz\/[\w-]+$/);
    await contexte.close();
  });

  test("brouillon : « Continuer » mène à l'éditeur, « Lancer » du menu affiche le message serveur et « Compléter le quiz »", async ({ browser }) => {
    test.setTimeout(90_000);
    const { contexte, page } = await ouvrirSession(browser, SOLO);
    await action(page, "quiz.creer", { title: "Brouillon QA" });
    await page.reload();
    await hydrate(page);
    const carte = page.getByRole("listitem").filter({ hasText: "Brouillon QA" }).first();
    await carte.getByRole("link", { name: "Continuer" }).click();
    await expect(page).toHaveURL(/\/quiz\/[\w-]+$/);
    await page.goBack();
    await hydrate(page);
    await carte.getByRole("button", { name: /Plus d'actions/ }).click();
    await carte.getByRole("button", { name: "Lancer" }).click();
    await expect(carte.getByRole("alert")).toContainText("Le quiz n'est pas prêt");
    await expect(carte.getByRole("link", { name: "Compléter le quiz" })).toBeVisible();
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);
    await contexte.close();
  });

  test("lancement : jeton hôte en sessionStorage, rien dans l'URL ; le 21e lancement de l'heure est refusé en français", async ({ browser }) => {
    test.setTimeout(180_000);
    const { contexte, page } = await ouvrirSession(browser, SOLO);
    const prete = page.getByRole("listitem").filter({ hasText: "Prêt à jouer" }).first();
    const quizId = ((await prete.locator('a[href$="/apercu"]').getAttribute("href")) ?? "").split("/")[2]!;
    expect(quizId).toMatch(/^[\w-]+$/);
    await prete.getByRole("button", { name: "Lancer" }).click();
    await expect(page).toHaveURL(/\/partie\/[\w-]+$/);
    expect(page.url()).not.toMatch(/[?#]|hostToken|token/i);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    const stocke = JSON.parse((await page.evaluate((k) => sessionStorage.getItem(k), `quizdeszeles:hote:${id}`)) ?? "null");
    expect(stocke).toEqual({ code: expect.stringMatching(/^[A-Z0-9]{6}$/), hostToken: expect.any(String) });
    expect(await page.evaluate(() => localStorage.length)).toBe(0);

    // 19 lancements de plus : le plafond est de 20 par heure, le 21e vient de l'interface.
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(page);
    for (let i = 0; i < 19; i += 1) expect((await action(page, "partie.lancer", { quizId })).statut).toBe(200);
    const carte = page.getByRole("listitem").filter({ hasText: "Prêt à jouer" }).first();
    await carte.getByRole("button", { name: "Lancer" }).click();
    await expect(carte.getByRole("alert")).toContainText("Trop de parties lancées en peu de temps");
    await expect(page).toHaveURL(/\/tableau-de-bord$/);
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);
    await contexte.close();
  });

  test("parties jouées : lien vers le bilan, puis erreur avec « Réessayer » qui rétablit la liste", async ({ browser }) => {
    test.setTimeout(120_000);
    const { contexte, page } = await ouvrirSession(browser, SOLO);
    serveur.sql(
      "INSERT INTO game_sessions (id, code, owner_id, quiz_id, quiz_title, mode, show_correct_answer, shuffle, status, created_at, ended_at) " +
        `SELECT 'partie-qa-1', 'QAQ234', id, NULL, 'Veillée', 'together', 1, 0, 'ended', 1793000000000, 1793003600000 FROM user WHERE email = '${SOLO}'`,
    );
    await page.reload();
    await hydrate(page);
    await page.getByRole("tab", { name: "Parties jouées" }).click();
    const lien = page.getByRole("link", { name: /Voir le bilan de Veillée/ });
    await expect(lien).toHaveAttribute("href", "/partie/partie-qa-1/bilan");
    await lien.click();
    await expect(page).toHaveURL(/\/partie\/partie-qa-1\/bilan$/);

    // Panne de lecture : la table des joueurs disparaît le temps de la panne.
    serveur.sql("ALTER TABLE session_players RENAME TO session_players_off");
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(page);
    await page.getByRole("tab", { name: "Parties jouées" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Parties indisponibles" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
    await mobileOk(page);
    expect(await axe(page)).toEqual([]);
    serveur.sql("ALTER TABLE session_players_off RENAME TO session_players");
    await page.getByRole("button", { name: "Réessayer" }).click();
    await hydrate(page);
    await page.getByRole("tab", { name: "Parties jouées" }).click();
    await expect(page.getByRole("link", { name: /Voir le bilan de Veillée/ })).toBeVisible();
    await contexte.close();
  });

  test("déconnexion (contournement JSON) : la session est réellement fermée", async ({ browser }) => {
    const { contexte, page } = await ouvrirSession(browser, SOLO);
    await page.getByRole("button", { name: /Menu du compte/ }).click();
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(`${serveur.url}/`);
    const session = await page.evaluate(async () => (await fetch("/api/auth/get-session")).text());
    expect(session === "null" || session === "").toBe(true);
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await expect(page).toHaveURL(/\/connexion\?retour=%2Ftableau-de-bord/);
    await contexte.close();
  });

  test("focus visible au clavier sur les contrôles du tableau", async ({ browser }) => {
    const { contexte, page } = await ouvrirSession(browser, SOLO);
    const sansAnneau: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const visible = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
        return { nom: `${el.tagName}.${String(el.className).slice(0, 80)} tabindex=${el.getAttribute("tabindex")} ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}`, visible };
      });
      if (r && !r.visible) sansAnneau.push(r.nom);
    }
    expect(sansAnneau).toEqual([]);
    await contexte.close();
  });
});
