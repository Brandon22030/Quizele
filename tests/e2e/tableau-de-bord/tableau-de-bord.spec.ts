import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { arreterTout, lancerServeur, type ServeurLocal } from "./serveur-local";

const EMAIL = "animatrice@exemple.fr";

// CAPTURES_DIR : dossier des captures de revue ; sans lui, aucune image n'est écrite.
async function capturer(page: Page, nom: string) {
  const dossier = process.env.CAPTURES_DIR;
  if (!dossier) return;
  mkdirSync(dossier, { recursive: true });
  const projet = test.info().project.name === "bureau" ? "bureau" : "mobile";
  await page.screenshot({ path: join(dossier, `qz002-13-${nom}-${projet}.png`), fullPage: true });
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
      .filter((el) => !el.closest("[hidden]"))
      .map((el) => ({ nom: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
  );
  expect(petites).toEqual([]);
}

// Un seul lien magique par exécution : la demande de lien est limitée par adresse, les tests suivants rejouent le cookie.
let cookiesSession: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>> | null = null;

async function connecter(page: Page, serveur: ServeurLocal) {
  if (cookiesSession) {
    await page.context().addCookies(cookiesSession);
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await hydrate(page);
    return;
  }
  await page.goto(`${serveur.url}/connexion`);
  await hydrate(page);
  await page.getByLabel("Ton adresse e-mail").fill(EMAIL);
  await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible();
  await page.goto(await serveur.lienMagique(EMAIL));
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await hydrate(page);
  cookiesSession = await page.context().cookies();
}

// Appel RPC d'une Astro Action depuis le navigateur connecté (cookie de session et en-tête Origin d'origine).
async function action<T>(page: Page, nom: string, corps: unknown = {}): Promise<T> {
  return page.evaluate(
    async ([chemin, donnees]) => {
      const reponse = await fetch(`/_actions/${chemin}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donnees) });
      return reponse.json();
    },
    [nom, corps] as const,
  ) as Promise<T>;
}

test.describe("tableau de bord de l'animateur (vraie session)", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    cookiesSession = null;
    serveur = await lancerServeur(20);
  });
  test.afterAll(() => arreterTout());

  test("non connecté : redirection vers la connexion avec retour", async ({ page }) => {
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await expect(page).toHaveURL(/\/connexion\?retour=%2Ftableau-de-bord/);
  });

  test("première visite (k2) : Partir de zéro, trois modèles, axe propre ; un modèle crée un quiz", async ({ page }) => {
    await connecter(page, serveur);
    await expect(page.getByRole("heading", { level: 1, name: /TON 1ER/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Partir de zéro" })).toHaveAttribute("href", "/quiz/nouveau");
    const modeles = page.getByRole("list").filter({ has: page.getByRole("button", { name: /questions/ }) }).getByRole("button");
    await expect(modeles).toHaveCount(3);
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k2-vide");

    await modeles.first().click();
    await expect(page).toHaveURL(/\/quiz\/[\w-]+$/);
  });

  test("liste (k1) : statut calculé, menu, duplication, suppression confirmée", async ({ page }) => {
    await connecter(page, serveur);
    // Le premier test a créé un quiz depuis un modèle : la page n'est plus en première visite.
    await expect(page.getByRole("heading", { level: 1, name: "TES QUIZ" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Mes quiz (1)" })).toBeVisible();
    await expect(page.getByText("Prêt à jouer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Lancer" })).toBeVisible();

    await action(page, "quiz.creer", { title: "Les paraboles" });
    await page.reload();
    await hydrate(page);
    await expect(page.getByRole("tab", { name: "Mes quiz (2)" })).toBeVisible();
    await expect(page.getByText(/Brouillon - aucune question/)).toBeVisible();

    const carte = page.getByRole("listitem").filter({ hasText: "Les paraboles" }).first();
    await carte.getByRole("button", { name: /Plus d'actions pour Les paraboles/ }).click();
    await expect(carte.getByRole("link", { name: "Modifier" })).toBeVisible();
    await expect(carte.getByRole("link", { name: "Essayer comme un joueur" })).toHaveAttribute("href", /\/quiz\/[\w-]+\/apercu$/);
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k1-menu-ouvert");

    // Rechargement silencieux : aucun squelette entre la duplication et la nouvelle liste.
    let squeletteVu = false;
    await page.exposeFunction("signalerSquelette", () => {
      squeletteVu = true;
    });
    await page.evaluate(() => {
      new MutationObserver(() => {
        if (document.querySelector('[aria-busy="true"]')) (window as unknown as { signalerSquelette: () => void }).signalerSquelette();
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await carte.getByRole("button", { name: "Dupliquer" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Quiz dupliqué." })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Mes quiz (3)" })).toBeVisible();
    // Le focus suit la nouvelle carte, pas body.
    const menuCopie = page.getByRole("button", { name: /^Plus d'actions pour Les paraboles \(copie\)$/ });
    await expect(menuCopie).toBeFocused();
    expect(squeletteVu).toBe(false);

    await menuCopie.click();
    await page.getByRole("button", { name: "Supprimer" }).click();
    const dialogue = page.getByRole("dialog", { name: "Supprimer ce quiz ?" });
    await expect(dialogue).toBeVisible();
    await expect(dialogue).toContainText("Cette action est définitive.");
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k1-confirmation");
    await dialogue.getByRole("button", { name: "Annuler" }).click();
    await expect(page.getByRole("tab", { name: "Mes quiz (3)" })).toBeVisible();
    // La modale rend le focus au « … » visible qui l'a ouverte, pas à l'action masquée du menu.
    await expect(menuCopie).toBeFocused();

    await menuCopie.click();
    await page.getByRole("button", { name: "Supprimer" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
    // Le toast part tout seul au bout de 4 s et s'affiche dans le même rendu que le nouveau compteur : on le lit en premier.
    // Sous charge, attendre d'abord le compteur (jusqu'à 5 s) laissait le toast expirer avant sa propre vérification.
    await expect(page.getByRole("status").filter({ hasText: "Quiz supprimé." })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: "Mes quiz (2)" })).toBeVisible();
    // La copie était en tête de liste : le focus passe à la carte suivante.
    await expect(page.getByRole("button", { name: /^Plus d'actions pour Les paraboles$/ })).toBeFocused();
  });

  test("lancer un quiz incomplet : message serveur et lien vers l'éditeur", async ({ page }) => {
    await connecter(page, serveur);
    const carte = page.getByRole("listitem").filter({ hasText: "Les paraboles" }).first();
    await expect(carte.getByRole("link", { name: "Continuer" })).toHaveAttribute("href", /\/quiz\/[\w-]+$/);
    const menu = carte.getByRole("button", { name: /Plus d'actions pour Les paraboles/ });
    await menu.click();
    await carte.getByRole("button", { name: "Lancer" }).click();
    await expect(carte.getByRole("alert")).toContainText("Le quiz n'est pas prêt");
    await expect(menu).toBeFocused();
    await expect(carte.getByRole("link", { name: "Compléter le quiz" })).toHaveAttribute("href", /\/quiz\/[\w-]+$/);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k1-lancement-incomplet");
  });

  test("lancer un quiz prêt : jeton hôte en sessionStorage puis redirection vers le pilotage", async ({ page }) => {
    await connecter(page, serveur);
    const carte = page.getByRole("listitem").filter({ hasText: "Prêt à jouer" }).first();
    await carte.getByRole("button", { name: "Lancer" }).click();
    await expect(page).toHaveURL(/\/partie\/[\w-]+$/);
    const sessionId = new URL(page.url()).pathname.split("/").pop() ?? "";
    const memorise = await page.evaluate((id) => sessionStorage.getItem(`quizdeszeles:hote:${id}`), sessionId);
    expect(JSON.parse(memorise ?? "null")).toEqual({ code: expect.stringMatching(/^[A-Z0-9]{6}$/), hostToken: expect.any(String) });
  });

  test("parties jouées (k1b) : vide, puis liste avec lien vers le bilan", async ({ page }) => {
    await connecter(page, serveur);
    await page.getByRole("tab", { name: "Parties jouées" }).click();
    await expect(page.getByRole("heading", { name: "Aucune partie jouée" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k10-aucune-partie");

    serveur.sql(
      "INSERT INTO game_sessions (id, code, owner_id, quiz_id, quiz_title, mode, show_correct_answer, shuffle, status, created_at, ended_at) " +
        `SELECT 'partie-test-1', 'ABC234', id, NULL, 'Camp de Pâques', 'together', 1, 0, 'ended', 1793000000000, 1793003600000 FROM user WHERE email = '${EMAIL}'; ` +
        "INSERT INTO session_players (id, session_id, pseudo, score, total_time_ms, rank) VALUES ('j1', 'partie-test-1', 'Grâce', 5, 9000, 1), ('j2', 'partie-test-1', 'Noé', 3, 12000, 2);",
    );
    await page.reload();
    await hydrate(page);
    await page.getByRole("tab", { name: "Parties jouées" }).click();
    await expect(page.getByText("Camp de Pâques")).toBeVisible();
    await expect(page.getByText("2 joueurs")).toBeVisible();
    await expect(page.getByRole("link", { name: /Voir le bilan de Camp de Pâques/ })).toHaveAttribute("href", "/partie/partie-test-1/bilan");
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k1b-parties");
  });

  test("liste lue côté serveur : les cartes sont dans le HTML, sans appel à quiz.lister au chargement", async ({ page }) => {
    await connecter(page, serveur);
    const appels: string[] = [];
    page.on("request", (requete) => {
      if (requete.url().includes("_actions/quiz.lister")) appels.push(requete.url());
    });
    const reponse = await page.request.get(`${serveur.url}/tableau-de-bord`);
    expect(await reponse.text()).toContain("Les paraboles");
    await page.reload();
    await hydrate(page);
    await expect(page.getByRole("tab", { name: /Mes quiz \(\d\)/ })).toBeVisible();
    expect(appels).toEqual([]);
  });

  test("dates : absentes du HTML serveur, formatées dans le fuseau du navigateur après hydratation, sans avertissement", async ({ browser }) => {
    // Fuseau éloigné de l'UTC du serveur : un formatage serveur produirait ici un décalage d'hydratation.
    const contexte = await browser.newContext({ timezoneId: "Pacific/Kiritimati", viewport: { width: 390, height: 844 } });
    const page = await contexte.newPage();
    const avertissements: string[] = [];
    page.on("console", (message) => {
      if (/hydrat|did not match|Minified React error #4(18|25)/i.test(message.text())) avertissements.push(message.text());
    });
    page.on("pageerror", (erreur) => avertissements.push(erreur.message));
    await connecter(page, serveur);
    const html = await (await page.request.get(`${serveur.url}/tableau-de-bord`)).text();
    expect(html).toContain("Les paraboles");
    expect(html).not.toContain("modifié le");
    await page.reload();
    await hydrate(page);
    const carte = page.getByRole("listitem").filter({ hasText: "Les paraboles" }).first();
    const date = carte.locator("time");
    await expect(carte).toContainText(/modifié le \d{1,2} [a-zéû]+\.?/);
    const attendu = await date.evaluate((el) =>
      new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(el.getAttribute("datetime") ?? "")),
    );
    await expect(date).toHaveText(attendu);
    expect(avertissements).toEqual([]);
    await contexte.close();
  });

  test("erreur serveur, puis Réessayer : squelettes annoncés pendant le rechargement, puis la liste", async ({ page }) => {
    await connecter(page, serveur);
    // Panne de lecture : la table des questions disparaît le temps de la panne, la page rend l'état d'erreur.
    serveur.sql("ALTER TABLE questions RENAME TO questions_off");
    try {
      await page.reload();
      await hydrate(page);
      await expect(page.getByRole("alert").filter({ hasText: "Tes quiz sont introuvables" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await capturer(page, "k10-erreur");
    } finally {
      serveur.sql("ALTER TABLE questions_off RENAME TO questions");
    }

    let liberer: () => void = () => {};
    const attente = new Promise<void>((r) => (liberer = r));
    await page.route(/_actions\/quiz\.lister/, async (route) => {
      await attente;
      await route.continue();
    });
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(page.getByText("Chargement de tes quiz")).toBeAttached();
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "k10-chargement");
    liberer();
    await expect(page.getByRole("button", { name: "Lancer" }).first()).toBeVisible();
    await page.unroute(/_actions\/quiz\.lister/);
  });

  test("menu « … » : un clic dans le vide ferme le menu et rend le focus au bouton", async ({ page }) => {
    await connecter(page, serveur);
    const carte = page.getByRole("listitem").filter({ hasText: "Les paraboles" }).first();
    const menu = carte.getByRole("button", { name: /Plus d'actions pour Les paraboles/ });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    // Focus sur une action du menu, puis clic hors du menu, sur une zone non focalisable.
    await page.keyboard.press("Tab");
    await expect(carte.getByRole("link", { name: "Modifier" })).toBeFocused();
    await page.mouse.click(4, 4);
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();

    // Un clic extérieur sur un autre contrôle lui laisse le focus.
    await menu.click();
    await page.getByRole("tab", { name: "Parties jouées" }).click();
    await expect(page.getByRole("tab", { name: "Parties jouées" })).toBeFocused();
  });

  test("compte : le menu affiche le nom et la déconnexion ferme la session", async ({ page }) => {
    await connecter(page, serveur);
    await page.getByRole("button", { name: /Menu du compte/ }).click();
    await expect(page.getByText(EMAIL).last()).toBeVisible();
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(`${serveur.url}/`);
    await page.goto(`${serveur.url}/tableau-de-bord`);
    await expect(page).toHaveURL(/\/connexion/);
  });
});
