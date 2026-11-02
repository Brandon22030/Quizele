import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { arreterTout, lancerServeur, type ServeurLocal } from "./serveur-local";

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

async function violationsAxe(page: Page) {
  const resultat = await new AxeBuilder({ page }).analyze();
  return resultat.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

async function controlesVisuels(page: Page) {
  const petites = await page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input")]
      .map((el) => ({ nom: (el.textContent || el.getAttribute("name") || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
  );
  expect(petites, "cibles de moins de 44 px").toEqual([]);
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(debordement, "débordement horizontal").toBeLessThanOrEqual(0);
}

// Parcourt la page au clavier : chaque élément qui prend le focus doit montrer un indicateur visible.
async function focusToujoursVisible(page: Page, maxTab = 8) {
  const sansIndicateur: string[] = [];
  for (let i = 0; i < maxTab; i += 1) {
    await page.keyboard.press("Tab");
    const etat = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const contour = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const ombre = s.boxShadow !== "none";
      return { nom: (el.textContent || el.getAttribute("name") || el.tagName).trim().slice(0, 30), visible: contour || ombre };
    });
    if (etat && !etat.visible) sansIndicateur.push(etat.nom);
  }
  expect(sansIndicateur, "éléments focalisés sans indicateur").toEqual([]);
}

test.describe("connexion : Google seul", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  test.beforeAll(async () => {
    // Démarrage de wrangler (migrations puis serveur) : plus de 30 s sur une machine chargée.
    test.setTimeout(180_000);
    serveur = await lancerServeur(5, { GOOGLE_CLIENT_ID: "id-factice.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "secret-factice", MAGIC_LINK_ENABLED: "false" });
  });
  test.afterAll(() => arreterTout());

  test("bouton Google seul : formulaire masqué, pas de séparateur « ou », axe, 44 px, focus, pas de débordement", async ({ page }) => {
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await expect(page.getByRole("button", { name: "Continuer avec Google" })).toBeVisible();
    await expect(page.getByLabel("Ton adresse e-mail")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Recevoir un lien par e-mail" })).toHaveCount(0);
    await expect(page.getByText("ou", { exact: true })).toHaveCount(0);
    expect(await violationsAxe(page)).toEqual([]);
    await controlesVisuels(page);
    await focusToujoursVisible(page, 3);
  });

  test("/connexion/verifier sans lien magique actif renvoie au formulaire de connexion", async ({ page }) => {
    await page.goto(`${serveur.url}/connexion/verifier?email=a%40exemple.fr&retour=%2Fquiz%2Fx`);
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fquiz%2Fx$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Connecte-toi");
  });

  test("une erreur de redirection Google refusée s'affiche en français", async ({ page }) => {
    await page.goto(`${serveur.url}/connexion?error=access_denied`);
    await expect(page.getByRole("alert")).toContainText("La connexion avec Google a été refusée");
    await hydrate(page);
    expect(await violationsAxe(page)).toEqual([]);
  });
});

test.describe("connexion : lien magique, comportements du formulaire", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  test.beforeAll(async () => {
    // Démarrage de wrangler (migrations puis serveur) : plus de 30 s sur une machine chargée.
    test.setTimeout(180_000);
    serveur = await lancerServeur(6);
  });
  test.afterAll(() => arreterTout());

  const envoyer = async (page: Page, email: string) => {
    await page.getByLabel("Ton adresse e-mail").fill(email);
    await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
  };

  for (const email of ["", "   ", "a", "a@b", "a b@c.fr", "a@@b.fr", `${"a".repeat(250)}@b.fr`]) {
    test(`adresse invalide ${JSON.stringify(email.slice(0, 12))} : refusée sans appel serveur`, async ({ page }) => {
      let appels = 0;
      await page.route("**/api/auth/**", (route) => {
        appels += 1;
        return route.abort();
      });
      await page.goto(`${serveur.url}/connexion`);
      await hydrate(page);
      await envoyer(page, email);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page).toHaveURL(/\/connexion$/);
      expect(appels).toBe(0);
    });
  }

  test("un double clic et un double Entrée ne provoquent qu'un seul envoi", async ({ page }) => {
    let appels = 0;
    await page.route("**/api/auth/sign-in/magic-link", async (route) => {
      appels += 1;
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({ status: 200, json: { status: true } });
    });
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await page.getByLabel("Ton adresse e-mail").fill("double@exemple.fr");
    await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).dblclick();
    await page.getByLabel("Ton adresse e-mail").press("Enter").catch(() => {});
    await expect(page).toHaveURL(/\/connexion\/verifier/);
    expect(appels).toBe(1);
  });

  test("état de chargement du bouton pendant l'envoi", async ({ page }) => {
    await page.route("**/api/auth/sign-in/magic-link", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 200, json: { status: true } });
    });
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await envoyer(page, "attente@exemple.fr");
    await expect(page.getByRole("button", { name: /Envoi du lien en cours/ })).toHaveAttribute("aria-busy", "true");
  });

  test("429 : message neutre, sans mention du plafond quotidien ; le bouton redevient disponible", async ({ page }) => {
    await page.route("**/api/auth/sign-in/magic-link", (route) => route.fulfill({ status: 429, json: { message: "Daily cap" } }));
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await envoyer(page, "limite@exemple.fr");
    const alerte = page.getByRole("alert");
    await expect(alerte).toContainText("Trop de demandes, réessaie dans une minute.");
    await expect(alerte).not.toContainText(/jour|quotidien|cap/i);
    await expect(page.getByRole("button", { name: "Recevoir un lien par e-mail" })).toBeEnabled();
    expect(await violationsAxe(page)).toEqual([]);
    await controlesVisuels(page);
  });

  test("erreur réseau : message français, aucune trace technique", async ({ page }) => {
    await page.route("**/api/auth/sign-in/magic-link", (route) => route.abort("connectionrefused"));
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await envoyer(page, "reseau@exemple.fr");
    const alerte = page.getByRole("alert");
    await expect(alerte).toContainText("Impossible de joindre le serveur");
    await expect(alerte).not.toContainText(/TypeError|fetch|ERR_|undefined/i);
  });

  for (const statut of [500, 502, 415]) {
    test(`réponse ${statut} : message français générique, sans détail du serveur`, async ({ page }) => {
      await page.route("**/api/auth/sign-in/magic-link", (route) =>
        route.fulfill({ status: statut, json: { message: "Envoi de l'e-mail refusé par Resend, stack at Object.<anonymous>" } }),
      );
      await page.goto(`${serveur.url}/connexion`);
      await hydrate(page);
      await envoyer(page, "erreur@exemple.fr");
      const alerte = page.getByRole("alert");
      await expect(alerte).toContainText("Quelque chose n'a pas fonctionné");
      await expect(alerte).not.toContainText(/Resend|stack|Object/i);
    });
  }

  test("envoi, confirmation, renvoi bloqué 60 s puis réactivé (horloge simulée)", async ({ page }) => {
    await page.clock.install();
    let envois = 0;
    await page.route("**/api/auth/sign-in/magic-link", (route) => {
      envois += 1;
      return route.fulfill({ status: 200, json: { status: true } });
    });
    await page.goto(`${serveur.url}/connexion?retour=%2Fquiz%2Fx`);
    await hydrate(page);
    await envoyer(page, "horloge@exemple.fr");
    await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible();
    await hydrate(page);
    const renvoi = page.getByRole("button", { name: /Renvoyer le lien/ });
    await expect(renvoi).toBeDisabled();
    await page.clock.runFor(30_000);
    await expect(renvoi).toContainText("dans 30 s");
    await expect(renvoi).toBeDisabled();
    await page.clock.runFor(30_500);
    await expect(renvoi).toBeEnabled();
    await renvoi.click();
    await expect(page.getByRole("status")).toHaveText("Un nouveau lien vient de partir.");
    await expect(renvoi).toBeDisabled();
    await expect(renvoi).toContainText("dans 60 s");
    expect(envois).toBe(2);
    expect(await violationsAxe(page)).toEqual([]);
    await controlesVisuels(page);
    await focusToujoursVisible(page, 4);
  });

  test("le renvoi après erreur réseau reste possible (le bouton n'est pas bloqué)", async ({ page }) => {
    await page.clock.install();
    let appel = 0;
    await page.route("**/api/auth/sign-in/magic-link", (route) => {
      appel += 1;
      return appel === 1 ? route.abort() : route.fulfill({ status: 200, json: { status: true } });
    });
    // L'adresse vit en sessionStorage, jamais dans l'URL.
    await page.addInitScript(() => sessionStorage.setItem("quizdeszeles:connexion-email", "renvoi@exemple.fr"));
    await page.goto(`${serveur.url}/connexion/verifier`);
    await hydrate(page);
    await page.clock.runFor(61_000);
    const renvoi = page.getByRole("button", { name: "Renvoyer le lien" });
    await renvoi.click();
    await expect(page.getByRole("alert")).toContainText("Impossible de joindre le serveur");
    await expect(renvoi).toBeEnabled();
    await renvoi.click();
    await expect(page.getByRole("status")).toHaveText("Un nouveau lien vient de partir.");
  });

  test("l'adresse affichée dans la confirmation est échappée (pas d'injection HTML)", async ({ page }) => {
    // Adresse invalide en sessionStorage : ignorée, la page reste sans renvoi (l'adresse n'est plus lue dans l'URL).
    await page.addInitScript(() => sessionStorage.setItem("quizdeszeles:connexion-email", "<img src=x onerror=alert(1)>@exemple.fr"));
    await page.goto(`${serveur.url}/connexion/verifier`);
    await hydrate(page);
    await expect(page.getByRole("button", { name: /Renvoyer le lien/ })).toHaveCount(0);
    expect(await page.locator("img[src='x']").count()).toBe(0);
  });

  const retoursMalveillants = [
    "https%3A%2F%2Fevil.example",
    "%2F%2Fevil.example",
    "%2F%5Cevil.example",
    "%252F%252Fevil.example",
    "javascript%3Aalert(1)",
    `${encodeURIComponent(`/quiz/${"a".repeat(600)}`)}`,
  ];
  for (const retour of retoursMalveillants) {
    test(`retour ${retour.slice(0, 28)} : callbackURL replié sur /tableau-de-bord`, async ({ page }) => {
      let corps: { callbackURL?: string; errorCallbackURL?: string } = {};
      await page.route("**/api/auth/sign-in/magic-link", (route) => {
        corps = route.request().postDataJSON();
        return route.fulfill({ status: 200, json: { status: true } });
      });
      await page.goto(`${serveur.url}/connexion?retour=${retour}`);
      await hydrate(page);
      await envoyer(page, "retour@exemple.fr");
      await expect(page).toHaveURL(/\/connexion\/verifier/);
      expect(corps.callbackURL).toBe("/tableau-de-bord");
      expect(corps.errorCallbackURL).toBe("/connexion?retour=%2Ftableau-de-bord");
      expect(page.url()).not.toContain("evil");
    });
  }

  test("un retour valide (/quiz/x) est transmis et respecté après la session", async ({ page }) => {
    const email = "valide@exemple.fr";
    let corps: { callbackURL?: string } = {};
    await page.route("**/api/auth/sign-in/magic-link", (route) => {
      corps = route.request().postDataJSON();
      return route.continue();
    });
    await page.goto(`${serveur.url}/connexion?retour=%2Fquiz%2Fx`);
    await hydrate(page);
    await envoyer(page, email);
    await expect(page).toHaveURL(/\/connexion\/verifier\?retour=%2Fquiz%2Fx$/);
    expect(corps.callbackURL).toBe("/quiz/x");
    await page.goto(await serveur.lienMagique(email));
    await expect(page).toHaveURL(/\/quiz\/x$/);
  });

  test("déjà connecté : /connexion redirige vers le retour valide, ou vers le tableau de bord si le retour est externe", async ({ page }) => {
    const email = "connecte@exemple.fr";
    const demande = await page.request.post(`${serveur.url}/api/auth/sign-in/magic-link`, {
      headers: { origin: serveur.url, "content-type": "application/json" },
      data: { email, callbackURL: "/tableau-de-bord" },
    });
    expect(demande.status()).toBe(200);
    await page.goto(await serveur.lienMagique(email));
    await page.goto(`${serveur.url}/connexion?retour=%2Fpartie%2Fabc`);
    await expect(page).toHaveURL(/\/partie\/abc$/);
    await page.goto(`${serveur.url}/connexion?retour=https%3A%2F%2Fevil.example`);
    await expect(page).toHaveURL(/\/tableau-de-bord$/);
    await page.goto(`${serveur.url}/connexion?retour=%2F%2Fevil.example`);
    await expect(page).toHaveURL(/\/tableau-de-bord$/);
  });

  test("lien invalide ou expiré : message français sur /connexion, formulaire encore utilisable", async ({ page }) => {
    await page.goto(`${serveur.url}/api/auth/magic-link/verify?token=expire&callbackURL=%2Fquiz%2Fx&errorCallbackURL=%2Fconnexion%3Fretour%3D%252Fquiz%252Fx`);
    await hydrate(page);
    await expect(page.getByRole("alert")).toContainText("Ce lien a expiré ou a déjà servi. Demande-en un nouveau.");
    await expect(page.getByLabel("Ton adresse e-mail")).toBeVisible();
    await controlesVisuels(page);
    expect(await violationsAxe(page)).toEqual([]);
  });

  test("code d'erreur inconnu : message générique français, rien du code brut", async ({ page }) => {
    await page.goto(`${serveur.url}/connexion?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
    const alerte = page.getByRole("alert");
    await expect(alerte).toContainText("La connexion a échoué");
    await expect(alerte).not.toContainText("script");
  });

  test("focus visible et ordre logique dans le formulaire", async ({ page }) => {
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await focusToujoursVisible(page, 4);
  });

  test("404 : statut 404 sur routes inconnues (y compris sous /connexion), style affiche, lien vers l'accueil", async ({ page, request }) => {
    for (const chemin of ["/nexiste-pas", "/connexion/inconnu", "/a/b/c/d", "/quiz-inexistant"]) {
      const reponse = await request.get(`${serveur.url}${chemin}`);
      expect(reponse.status(), chemin).toBe(404);
      const html = await reponse.text();
      expect(html).toContain("Page introuvable");
      expect(html).not.toMatch(/Error:|\bat\s+\S+\s+\(|node_modules/);
    }
    await page.goto(`${serveur.url}/nexiste-pas`);
    await expect(page.getByRole("heading", { level: 1, name: "Page introuvable" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'accueil" })).toHaveAttribute("href", "/");
    await controlesVisuels(page);
    expect(await violationsAxe(page)).toEqual([]);
    await focusToujoursVisible(page, 3);
  });
});

test.describe("500 réel : erreur serveur pendant le rendu", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  test.beforeAll(async () => {
    // Démarrage de wrangler (migrations puis serveur) : plus de 30 s sur une machine chargée.
    test.setTimeout(180_000);
    // Sans secret, résoudre une session (cookie présent) lève une erreur dans le middleware.
    serveur = await lancerServeur(7, { BETTER_AUTH_SECRET: "" });
  });
  test.afterAll(() => arreterTout());

  test("statut 500, page française, ni stack ni message interne", async ({ page, request }) => {
    const reponse = await request.get(`${serveur.url}/connexion`, { headers: { cookie: "better-auth.session_token=x.y" } });
    const html = await reponse.text();
    expect(reponse.status()).toBe(500);
    expect(html).toContain("Oups, un souci de notre côté");
    expect(html).not.toMatch(/BETTER_AUTH|secret|Error:|\bat\s+\S+\s+\(|node_modules|stack/i);

    await page.context().addCookies([{ name: "better-auth.session_token", value: "x.y", url: serveur.url }]);
    await page.goto(`${serveur.url}/connexion`);
    await expect(page.getByRole("heading", { level: 1, name: /souci de notre côté/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'accueil" })).toHaveAttribute("href", "/");
    await controlesVisuels(page);
    expect(await violationsAxe(page)).toEqual([]);
  });
});
